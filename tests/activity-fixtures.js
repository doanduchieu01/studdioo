import { createDefaultState } from "../src/core/state.js";
import { normalizeActivity } from "../src/core/activity.js";

export const NOW = new Date(2026, 8, 29, 10, 0).getTime();
export const MIN = 60000;
export const at = minute => new Date(NOW + minute * MIN).toISOString();
export function appFixture() {
  const app = createDefaultState(new Date(NOW));
  app.tasks = [
    { id:"task-a", title:"Read neural networks", durationMinutes:50, status:"planned", priority:"high", dueAt:at(360), createdAt:at(-1440) },
    { id:"task-b", title:"Write research report", durationMinutes:25, status:"inbox", priority:"normal", dueAt:null, createdAt:at(-1440) }
  ];
  app.preferences.dayStart="08:00"; app.preferences.dayEnd="18:00";
  return app;
}
export function sessionFixture(id="session-a", start=-20, end=-1, extra={}) {
  return {id,revision:1,closed:true,segments:[{startAt:at(start),endAt:at(end),host:"study.example",resource:"https://study.example/chapter",title:"Neural networks chapter",kind:"reading",uncertain:true,reasons:["visible_no_input","long_no_input"]}],...extra};
}
export function activityFixture(extra={}) {
  return normalizeActivity({settings:{enabled:true,details:true,aiEnabled:true},sessions:[sessionFixture()],...extra},NOW);
}
export function chromeFixture() {
  const local=new Map(),session=new Map(),alarms=new Map(),notifications=new Map(),scripts=new Map();
  const control={now:NOW,granted:true,failWrite:false,idle:"active",focused:true,tab:{id:7,url:"https://study.example/chapter?secret=abc",title:"Neural networks chapter",incognito:false,audible:false},created:[],opened:[]};
  const area=store=>({async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>store.has(k)).map(k=>[k,structuredClone(store.get(k))]));},async set(value){if(control.failWrite)throw new Error("Storage full");for(const [k,v] of Object.entries(value))store.set(k,structuredClone(v));},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])store.delete(k);}});
  const api={runtime:{id:"studio-test",getURL:path=>`chrome-extension://studio-test/${path}`},storage:{local:area(local),session:area(session)},
    extension:{inIncognitoContext:false},permissions:{async contains(){return control.granted;}},
    tabs:{async query(query){return query.audible&&!control.tab.audible?[]:[structuredClone(control.tab)];},async get(){return structuredClone(control.tab);},async create(value){control.opened.push(value);}},
    windows:{async getLastFocused(){return {id:1,focused:control.focused,state:"normal",incognito:false};}},idle:{async queryState(){return control.idle;}},
    alarms:{async get(id){return alarms.get(id);},async create(id,value){alarms.set(id,value);},async clear(id){return alarms.delete(id);}},
    notifications:{async create(id,value){notifications.set(id,value);control.created.push(id);},async clear(id){return notifications.delete(id);}},
    scripting:{async getRegisteredContentScripts(){return [...scripts.values()];},async registerContentScripts(values){for(const v of values)scripts.set(v.id,v);},async unregisterContentScripts({ids}){ids.forEach(id=>scripts.delete(id));},async executeScript(){}}
  };
  return {api,control,local,session,alarms,notifications,scripts};
}
