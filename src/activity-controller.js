import { ACTIVITY_KEY, ACTIVITY_ALARM, normalizeActivity, advanceActivity, activityAction, resourceIdentity, buildActivityRequest, validateActivityResponse, applyActivitySuggestions } from "./core/activity.js";
const SESSION_KEY="studioActivityBrowserSession", SIGNALS_KEY="studioActivitySignals", SCRIPT_ID="studio-activity-signals";
const permission={permissions:["tabs","idle"]};
const localDay=now=>new Date(now).toLocaleDateString("en-CA");

export function createActivityController(api,{readApp,requestAI,clock=()=>Date.now()}={}) {
  let writes=Promise.resolve(),aiRun=null;
  const queue=operation=>{const result=writes.then(operation);writes=result.catch(()=>{});return result;};
  const read=async()=>normalizeActivity((await api.storage.local.get(ACTIVITY_KEY))[ACTIVITY_KEY],clock());
  const write=async next=>{await api.storage.local.set({[ACTIVITY_KEY]:next});return next;};
  const permitted=async()=>Boolean(api.tabs?.query&&api.windows?.getLastFocused&&api.idle?.queryState&&await api.permissions?.contains?.(permission));
  async function sessionId(){const old=(await api.storage.session.get(SESSION_KEY))[SESSION_KEY];if(old)return old;const id=crypto.randomUUID();await api.storage.session.set({[SESSION_KEY]:id});return id;}
  async function signals(){return (await api.storage.session.get(SIGNALS_KEY))[SIGNALS_KEY] ?? {};}
  async function mediaSignal(tab,settings){
    const identity=resourceIdentity(tab?.url);if(!identity||!settings.signalOrigins.includes(identity.origin))return null;
    const signal=(await signals())[tab.id];
    if(!signal||clock()-signal.at>45000||signal.resource!==identity.key||!await api.permissions.contains({origins:[`${identity.origin}/*`]}))return null;
    return signal;
  }
  async function snapshot(settings){
    const idle=await api.idle.queryState(60);
    if(idle==="locked"||api.extension?.inIncognitoContext)return null;
    const window=await api.windows.getLastFocused({windowTypes:["normal"]});
    if(window?.incognito)return null;
    let [tab]=await api.tabs.query({active:true,windowId:window.id});
    let focused=Boolean(window.focused&&window.state!=="minimized");
    if(!focused&&settings.backgroundMedia){
      const candidates=await api.tabs.query({audible:true});
      for(const candidate of candidates){if(!candidate.incognito&&!candidate.discarded&&(await mediaSignal(candidate,settings))?.playing){tab=candidate;break;}}
    }
    if(!tab||tab.incognito||tab.discarded)return null;
    const identity=resourceIdentity(tab.url);if(!identity)return null;
    const signal=await mediaSignal(tab,settings);
    if(signal&&!signal.visible&&!signal.pip)focused=false;
    return {...identity,resource:identity.key,title:tab.title,idle:idle==="idle",locked:false,focused,
      media:Boolean(signal?.playing&&(focused||tab.audible&&!tab.mutedInfo?.muted)),tabId:tab.id};
  }
  async function syncScripts(){
    if(!api.scripting?.getRegisteredContentScripts)return;
    const state=await read();const matches=[];
    if(state.settings.enabled)for(const origin of state.settings.signalOrigins)if(await api.permissions.contains({origins:[`${origin}/*`],permissions:["scripting"]}))matches.push(`${origin}/*`);
    const registered=await api.scripting.getRegisteredContentScripts({ids:[SCRIPT_ID]});
    if(registered.length&&JSON.stringify([...registered[0].matches].sort())===JSON.stringify([...matches].sort()))return;
    if(registered.length)await api.scripting.unregisterContentScripts({ids:[SCRIPT_ID]});
    if(matches.length)await api.scripting.registerContentScripts([{id:SCRIPT_ID,matches,js:["src/activity-signal.js"],runAt:"document_idle",allFrames:false,persistAcrossSessions:true}]);
    if(matches.length&&api.scripting.executeScript)for(const tab of await api.tabs.query({})){
      const origin=resourceIdentity(tab.url)?.origin;
      if(!tab.incognito&&origin&&matches.includes(`${origin}/*`))await api.scripting.executeScript({target:{tabId:tab.id},files:["src/activity-signal.js"]}).catch(()=>{});
    }
  }
  async function tick(){return queue(async()=>{
    const old=await read();
    if(!old.settings.enabled){await api.alarms.clear(ACTIVITY_ALARM);return old;}
    if(!await permitted()){old.settings.enabled=false;old.cursor=null;await api.alarms.clear(ACTIVITY_ALARM);return write(old);}
    if(!await api.alarms.get?.(ACTIVITY_ALARM))await api.alarms.create(ACTIVITY_ALARM,{periodInMinutes:1});
    let sample;
    try{sample=await snapshot(old.settings);}catch{old.cursor=null;return write(old);}
    const next=advanceActivity(old,sample,clock(),await sessionId(),await readApp());
    return write(next);
  });}
  async function act(action,options={}){
    const result=await queue(async()=>{
      let current=await read();
      if(action==="clear"){
        await api.alarms.clear(ACTIVITY_ALARM);
        const empty=normalizeActivity(null,clock());empty.quota=current.quota;return write(empty);
      }
      if(action==="restore"){
        if(options.backup?.format!=="studio-activity-backup"||options.backup.version!==1)throw new Error("This is not an activity backup.");
        const restored=normalizeActivity(options.backup.activity,clock());
        restored.settings.enabled=false;restored.settings.aiEnabled=false;restored.settings.signalOrigins=[];restored.cursor=null;restored.undo=[];restored.quota=current.quota;
        restored.revision=current.revision+1;return write(restored);
      }
      if(action==="site"){
        const origin=resourceIdentity(options.origin)?.origin;
        if(!origin||!await api.permissions.contains({origins:[`${origin}/*`],permissions:["scripting"]}))throw new Error("Allow access to this site first.");
        current.settings.signalOrigins=[...new Set([...current.settings.signalOrigins,origin])].slice(0,30);current.revision++;return write(current);
      }
      if(action==="site-remove"){
        current.settings.signalOrigins=current.settings.signalOrigins.filter(x=>x!==options.origin);current.revision++;return write(current);
      }
      if(action==="settings"&&options.enabled===true&&!await permitted())throw new Error("Allow tab and idle access to enable tracking.");
      if(action==="settings"&&options.aiEnabled===true&&!current.settings.details)throw new Error("Enable titles and resource IDs before AI suggestions.");
      return write(activityAction(current,action,options,await readApp(),clock()));
    });
    if(["settings","site","site-remove","clear","restore"].includes(action))await syncScripts().catch(()=>{});
    return result;
  }
  async function recordSignal(request,sender){
    const state=await read(),identity=resourceIdentity(sender.url);
    if(sender.id!==api.runtime.id||!sender.tab||sender.tab.incognito||sender.frameId!==0||!identity||!state.settings.enabled||!state.settings.signalOrigins.includes(identity.origin)||!await api.permissions.contains({origins:[`${identity.origin}/*`]}))return {allowed:false};
    const tab=await api.tabs.get(sender.tab.id);
    if(tab.incognito||resourceIdentity(tab.url)?.key!==identity.key)return {allowed:false};
    if(request.type==="activity:signal"){
      const saved=await signals();
      // Frame metadata is evidence only; it never supplies task IDs, time ranges or settings.
      saved[tab.id]={resource:identity.key,at:clock(),playing:request.playing===true,visible:request.visible===true,pip:request.pip===true};
      const fresh=Object.fromEntries(Object.entries(saved).filter(([,s])=>clock()-s.at<90000).slice(-60));
      await api.storage.session.set({[SIGNALS_KEY]:fresh});
    }
    return {allowed:true};
  }
  async function ai(manual=false){
    if(aiRun)return aiRun;
    aiRun=(async()=>{
      const claim=await queue(async()=>{
        const current=await read(),now=clock(),date=localDay(now);
        if(!current.settings.aiEnabled||!current.settings.details||!manual&&!current.settings.enabled)return null;
        if(current.quota.date!==date)current.quota={date,attempts:0,lastAt:0};
        if(current.quota.attempts>=3){if(manual)throw new Error("Daily activity AI limit reached (3 requests).");return null;}
        if(!manual&&now-current.quota.lastAt<30*60000)return null;
        const batch=current.sessions.filter(s=>s.closed&&!s.locked&&!s.excluded&&s.assignment.source==="unknown"&&(manual||s.aiFingerprint!==String(s.revision))).slice(-8);
        if(!batch.length)return null;
        current.quota.attempts++;current.quota.lastAt=now;
        for(const s of batch)s.aiFingerprint=String(s.revision);
        await write(current);
        const app=await readApp(),request=buildActivityRequest(current,app,batch);
        return {batch:structuredClone(batch),request,settings:JSON.stringify(current.settings),catalog:JSON.stringify([current.projects,current.tags,current.rules])};
      });
      if(!claim)return read();
      try{
        const decisions=await requestAI(claim.request,value=>validateActivityResponse(value,claim.request));
        return await queue(async()=>{
          const current=await read(),app=await readApp();if(JSON.stringify(current.settings)!==claim.settings||JSON.stringify([current.projects,current.tags,current.rules])!==claim.catalog)return current;
          if(claim.request.context.tasks.some(t=>!app.tasks.some(x=>x.id===t.id&&x.title===t.title&&!["done","archived"].includes(x.status))))return current;
          const next=applyActivitySuggestions(current,claim.batch,decisions,app,clock());next.lastError="";return write(next);
        });
      }catch(error){return queue(async()=>{const current=await read();if(current.settings.aiEnabled){current.lastError=String(error.message).slice(0,300);await write(current);}return current;});}
    })().finally(()=>{aiRun=null;});
    return aiRun;
  }
  return {read,tick,act,ai,recordSignal,syncScripts};
}
