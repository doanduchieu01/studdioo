import {REMINDER_KEY,REMINDER_ALARM,normalizeReminders,quietNow,reminderEvents} from "./core/reminders.js";
export function createReminderController(api,{readApp,readActivity,clock=()=>Date.now()}){
  let writes=Promise.resolve();const queue=fn=>{const result=writes.then(fn);writes=result.catch(()=>{});return result;};
  const read=async()=>normalizeReminders((await api.storage.local.get(REMINDER_KEY))[REMINDER_KEY]);
  const write=async state=>{await api.storage.local.set({[REMINDER_KEY]:state});return state;};
  const permission=async()=>Boolean(api.notifications?.create&&await api.permissions?.contains?.({permissions:["notifications"]}));
  async function tick(){return queue(async()=>{
    const state=await read(),now=clock();
    if(!state.settings.enabled){await api.alarms.clear(REMINDER_ALARM);return state;}
    if(!await permission()){state.settings.enabled=false;state.error="Notification access is unavailable.";await api.alarms.clear(REMINDER_ALARM);return write(state);}
    if(!await api.alarms.get?.(REMINDER_ALARM))await api.alarms.create(REMINDER_ALARM,{periodInMinutes:1});
    const app=await readApp(),events=reminderEvents(app,await readActivity(),state.settings,new Date(now));
    state.snoozes=state.snoozes.filter(s=>events.some(e=>e.id===s.id));
    if(quietNow(state.settings,new Date(now))||["running","paused"].includes(app.focus.status)&&app.focus.phase==="focus")return state;
    const candidate=events.filter(e=>e.at<=now&&e.expires>now&&(!state.delivered.some(d=>d.id===e.id)||state.snoozes.some(s=>s.id===e.id&&s.until<=now)))
      .filter(e=>!state.snoozes.some(s=>s.id===e.id&&s.until>now));
    const fresh=candidate.filter(e=>e.at>=state.lastCheckedAt||state.snoozes.some(s=>s.id===e.id));
    const late=candidate.filter(e=>e.at<state.lastCheckedAt);
    const selected=[...fresh,...late].slice(0,5);
    if(selected.length){
      const vi=app.preferences.language==="vi";
      const event=selected.length===1?selected[0]:{id:`summary:${selected.map(e=>e.id).join("|").slice(0,220)}`,title:vi?"Nhắc việc":"Reminders",message:vi?`${selected.length} mục đang chờ. Mở Stuđiô để xem.`:`${selected.length} items are waiting. Open Stuđiô to review.`,view:"plan",group:selected.map(e=>e.id)};
      const notificationId=`studio-reminder:${event.id}`;
      try{
        await api.notifications.create(notificationId,{type:"basic",iconUrl:api.runtime.getURL("icons/icon128.png"),title:event.title,message:event.message,
          buttons:[{title:vi?"Mở":"Open"},{title:vi?"Nhắc sau 10 phút":"Snooze 10 min"}]});
        for(const e of selected){state.delivered=state.delivered.filter(d=>d.id!==e.id);state.delivered.push({id:e.id,at:now});state.snoozes=state.snoozes.filter(s=>s.id!==e.id);}
        state.inbox.push({...event,notificationId,at:now});state.error="";
      }catch(error){state.error=String(error.message).slice(0,200);}
    }
    state.lastCheckedAt=now;return write(normalizeReminders(state));
  });}
  async function act(action,options={}){return queue(async()=>{
    const state=await read();
    if(action==="settings"){
      if(options.enabled===true&&!await permission())throw new Error("Allow notifications first.");
      for(const key of Object.keys(state.settings))if(options[key]!==undefined)state.settings[key]=options[key];
      if(options.enabled===false){await api.alarms.clear(REMINDER_ALARM);for(const item of state.inbox)await api.notifications?.clear?.(item.notificationId);}
      state.lastCheckedAt=clock();return write(normalizeReminders(state));
    }
    if(action==="clear"){await api.alarms.clear(REMINDER_ALARM);for(const item of state.inbox)await api.notifications?.clear?.(item.notificationId);return write(normalizeReminders(null));}
    if(action==="snooze"){
      const item=state.inbox.find(x=>x.notificationId===options.notificationId);if(item)for(const id of item.group??[item.id]){state.snoozes=state.snoozes.filter(s=>s.id!==id);state.snoozes.push({id,until:clock()+600000});}
      return write(state);
    }throw new Error("Unknown reminder action.");
  });}
  async function click(notificationId,index=0){
    const state=await read(),item=state.inbox.find(x=>x.notificationId===notificationId);if(!item)return;
    if(index===1)await act("snooze",{notificationId});
    else await api.tabs.create({url:api.runtime.getURL(`src/sidepanel.html?view=${item.view??"plan"}`)});
    await api.notifications.clear(notificationId);
  }
  return {read,tick,act,click};
}
