import { atLocalClock, localDateKey, roundUpTime } from "./utils.js";
import { normalizeBlock } from "./state.js";
import { dailyBudget } from "./time-management.js";
import { newId } from "./activity.js";
export const RECOVERY_KEY="studioRecovery";
const ms=value=>new Date(value).getTime();
const overlaps=(a,b,c,d)=>a<d&&c<b;
export function delayedBlocks(state,now=new Date()){
  return state.schedule.filter(b=>b.status==="planned"&&ms(b.endAt)<now.getTime()&&
    state.tasks.some(t=>t.id===b.taskId&&!["done","archived"].includes(t.status))&&
    !(state.focus.taskId===b.taskId&&["running","paused","ready"].includes(state.focus.status)));
}
export function recoveryFingerprint(state){
  const p=state.preferences;
  return JSON.stringify({schedule:state.schedule,tasks:state.tasks.map(t=>[t.id,t.status,t.dueAt,t.durationMinutes]),preferences:[p.focusMinutes,p.breakMinutes,p.longBreakMinutes,p.longBreakEvery,p.bufferMinutes,p.dayStart,p.dayEnd,p.dailyBudgetMinutes,p.autoDailyBudget],dayPlans:state.dayPlans,
    sessions:state.sessions.map(s=>[s.id,s.focusedSeconds,s.endedAt]),focus:state.focus});
}
function budgetFits(state,blocks,now){
  // An overnight work window can touch two calendar budgets.
  const days=new Map();
  for(const block of blocks){
    const day=new Date(block.startAt);day.setHours(0,0,0,0);
    while(day.getTime()<ms(block.endAt)){days.set(localDateKey(day),new Date(day));day.setDate(day.getDate()+1);}
  }
  for(const day of days.values()){
    const sameDay=localDateKey(day)===localDateKey(now);
    const copy={...state,schedule:[...state.schedule,...blocks],dayPlans:state.dayPlans.map(p=>({...p,taskIds:[]})),
      focus:sameDay?state.focus:{status:"idle",phase:"focus",mode:"single"}};
    if(dailyBudget(copy,sameDay?now:day).spareMinutes < -0.01)return false;
  }
  return true;
}
export function proposeRecovery(state,choices,now=new Date()){
  const delayed=delayedBlocks(state,now);
  if(!Array.isArray(choices)||!choices.length||choices.length>20)throw new Error("Choose up to 20 delayed tasks.");
  const taskIds=new Set();
  const selected=choices.map(choice=>{
    if(taskIds.has(choice.taskId))throw new Error("Choose each task once.");taskIds.add(choice.taskId);
    const task=state.tasks.find(t=>t.id===choice.taskId),blocks=delayed.filter(b=>b.taskId===choice.taskId);
    const remaining=Number(choice.remainingMinutes);
    if(!task||!blocks.length||!Number.isInteger(remaining)||remaining<5||remaining>480)throw new Error("Confirm 5–480 remaining minutes for each delayed task.");
    return {task,blocks,remaining};
  }).sort((a,b)=>(a.task.dueAt?ms(a.task.dueAt):Infinity)-(b.task.dueAt?ms(b.task.dueAt):Infinity)||({high:0,normal:1,low:2}[a.task.priority]-{high:0,normal:1,low:2}[b.task.priority]));
  const oldIds=new Set(selected.flatMap(x=>x.blocks.map(b=>b.id)));
  const base={...state,schedule:state.schedule.filter(b=>!oldIds.has(b.id))};
  const blocks=[],unscheduled=[],replaced=[];
  const buffer=state.preferences.bufferMinutes*60000;
  const findSlot=(task,minutes,proposed)=>{
    const earlier=[...blocks,...proposed],last=earlier.at(-1);
    const rounds=last?earlier.filter(b=>localDateKey(new Date(b.startAt))===localDateKey(new Date(last.startAt))).length:0;
    const rest=rounds&&rounds%state.preferences.longBreakEvery===0?state.preferences.longBreakMinutes:state.preferences.breakMinutes;
    const earliest=last?ms(last.endAt)+Math.max(state.preferences.bufferMinutes,rest)*60000:now.getTime();
    for(let offset=0;offset<7;offset++){
      const day=new Date(now);day.setDate(day.getDate()+offset);day.setHours(0,0,0,0);
      const begin=atLocalClock(day,state.preferences.dayStart),end=atLocalClock(day,state.preferences.dayEnd);if(end<=begin)end.setDate(end.getDate()+1);
      let cursor=roundUpTime(new Date(Math.max(begin.getTime(),now.getTime(),earliest)),5);
      for(;cursor.getTime()+minutes*60000<=end.getTime();cursor=new Date(cursor.getTime()+5*60000)){
        const finish=new Date(cursor.getTime()+minutes*60000);
        if(task.dueAt&&finish>new Date(task.dueAt))break;
        const occupied=[...base.schedule,...blocks,...proposed].filter(b=>!["done","skipped"].includes(b.status));
        if(state.focus.status==="running"&&ms(state.focus.endsAt)>now.getTime())occupied.push({startAt:now.toISOString(),endAt:state.focus.endsAt});
        if(occupied.some(b=>overlaps(cursor.getTime(),finish.getTime()+buffer,ms(b.startAt),ms(b.endAt)+buffer)))continue;
        const block=normalizeBlock({id:newId("recovery-block"),taskId:task.id,startAt:cursor.toISOString(),endAt:finish.toISOString(),status:"planned",source:"proposal",createdAt:now.toISOString(),proposalId:null});
        if(!budgetFits(base,[...blocks,...proposed,block],now))continue;
        return block;
      }
    }return null;
  };
  for(const item of selected){
    const proposed=[];let left=item.remaining;
    while(left>0){const duration=Math.min(left,state.preferences.focusMinutes);const block=findSlot(item.task,duration,proposed);if(!block)break;proposed.push(block);left-=duration;}
    if(left>0)unscheduled.push({taskId:item.task.id,reason:"No space within the deadline, workday and daily budget."});
    else{blocks.push(...proposed);replaced.push(...item.blocks);}
  }
  return {id:newId("recovery"),createdAt:now.toISOString(),fingerprint:recoveryFingerprint(state),blocks,replaced,
    remaining:selected.map(x=>({taskId:x.task.id,minutes:x.remaining})),unscheduled,status:"pending"};
}
export function applyRecovery(state,proposal,now=new Date()){
  if(!proposal||proposal.status!=="pending"||proposal.fingerprint!==recoveryFingerprint(state))throw new Error("The plan changed. Create a fresh recovery proposal.");
  if(!proposal.blocks.length)throw new Error("No feasible recovery blocks.");
  if(proposal.blocks.some(b=>ms(b.startAt)<now.getTime()))throw new Error("The proposed start time passed. Create a fresh recovery proposal.");
  const next=structuredClone(state),ids=new Set(proposal.replaced.map(b=>b.id));
  next.schedule=next.schedule.map(b=>ids.has(b.id)?{...b,status:"skipped"}:b).concat(proposal.blocks).sort((a,b)=>a.startAt.localeCompare(b.startAt));
  next.schedulingRevision=(state.schedulingRevision||0)+1;
  return {state:next,history:{id:proposal.id,before:proposal.replaced,added:proposal.blocks,afterFingerprint:recoveryFingerprint(next),at:now.toISOString()}};
}
export function undoRecovery(state,history){
  if(!history||history.afterFingerprint!==recoveryFingerprint(state))throw new Error("The schedule changed. Undo is no longer available.");
  const next=structuredClone(state),added=new Set(history.added.map(b=>b.id));
  next.schedule=next.schedule.filter(b=>!added.has(b.id)).map(b=>history.before.find(x=>x.id===b.id)??b);
  next.schedulingRevision=(state.schedulingRevision||0)+1;return next;
}
