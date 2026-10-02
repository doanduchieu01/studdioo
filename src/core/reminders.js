import { needsReview } from "./activity.js";
export const REMINDER_KEY="studioReminders",REMINDER_ALARM="studio-reminders";
const bounded=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
export function normalizeReminders(raw){
  const s=raw?.settings??{};
  return {version:1,settings:{enabled:s.enabled===true,blocks:s.blocks!==false,deadlines:s.deadlines!==false,phases:s.phases!==false,review:typeof s.review==="boolean"?s.review:Boolean(raw),
    leadMinutes:bounded(s.leadMinutes,5,0,60),deadlineMinutes:bounded(s.deadlineMinutes,60,5,1440),
    quietStart:/^([01]\d|2[0-3]):[0-5]\d$/.test(s.quietStart)?s.quietStart:"22:00",quietEnd:/^([01]\d|2[0-3]):[0-5]\d$/.test(s.quietEnd)?s.quietEnd:"08:00"},
    delivered:Array.isArray(raw?.delivered)?raw.delivered.slice(-500):[],snoozes:Array.isArray(raw?.snoozes)?raw.snoozes.slice(-50):[],
    inbox:Array.isArray(raw?.inbox)?raw.inbox.slice(-50):[],lastCheckedAt:Number(raw?.lastCheckedAt)||0,error:typeof raw?.error==="string"?raw.error.slice(0,200):""};
}
export function quietNow(settings,now){
  const time=`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  return settings.quietStart===settings.quietEnd?false:settings.quietStart<settings.quietEnd?time>=settings.quietStart&&time<settings.quietEnd:time>=settings.quietStart||time<settings.quietEnd;
}
export function reminderEvents(app,activity,settings,now=new Date()){
  const events=[],vi=app.preferences.language==="vi";
  if(settings.blocks)for(const block of app.schedule){
    const task=app.tasks.find(t=>t.id===block.taskId);if(!task||["done","archived"].includes(task.status)||block.status!=="planned"||app.focus.blockId===block.id&&["running","paused","ready"].includes(app.focus.status))continue;
    events.push({id:`block:${block.id}:${block.startAt}`,at:new Date(block.startAt).getTime()-settings.leadMinutes*60000,expires:new Date(block.endAt).getTime(),title:vi?"Sắp đến phiên đã lên lịch":"Scheduled block",message:task.title,view:"plan",taskId:task.id,blockId:block.id});
  }
  if(settings.deadlines)for(const task of app.tasks){if(!task.dueAt||["done","archived"].includes(task.status))continue;
    events.push({id:`due:${task.id}:${task.dueAt}`,at:new Date(task.dueAt).getTime()-settings.deadlineMinutes*60000,expires:new Date(task.dueAt).getTime()+86400000,title:new Date(task.dueAt)<=now?(vi?"Đã quá hạn":"Deadline passed"):(vi?"Sắp đến hạn":"Deadline approaching"),message:task.title,view:"plan",taskId:task.id});}
  if(settings.phases&&["ready","complete"].includes(app.focus.status)){
    const f=app.focus;
    const eventType=f.status==="complete"?"timer_closed":f.phase==="focus"?"break_completed":"focus_completed";
    const event=[...(app.events??[])].reverse().find(e=>e.type===eventType);
    const ended=new Date(event?.at??f.lastSummary?.endedAt??app.sessions.at(-1)?.endedAt??0).getTime();
    const id=`phase:${f.pomodoroId??app.sessions.at(-1)?.id??"timer"}:${f.completedCycles}:${f.phase}:${f.status}`;
    events.push({id,at:ended,expires:ended+86400000,title:vi?"Đã hết phiên":"Timer phase finished",message:vi?"Mở Stuđiô để chọn bước tiếp theo.":"Open Stuđiô to choose the next phase.",view:"today"});
  }
  if(settings.review&&activity.sessions.some(needsReview)){
    const date=`${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`,at=new Date(now);at.setHours(18,0,0,0);
    events.push({id:`review:${date}`,at:at.getTime(),expires:at.getTime()+12*3600000,title:vi?"Rà soát hoạt động (tùy chọn)":"Optional activity review",message:vi?"Có liên kết đã lưu mâu thuẫn nhau. Có thể kiểm tra khi thuận tiện.":"Some saved associations conflict. Review whenever useful.",view:"activity"});
  }return events;
}
