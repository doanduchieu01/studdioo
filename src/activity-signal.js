// Runs only on sites explicitly enabled for media signals. No content or key values.
(() => {
  if(globalThis.__studioSignals){globalThis.__studioSignals.start();return;}
  const previous=new WeakMap();
  let enabled=true,busy=false;
  async function report(){
    if(!enabled||busy)return;busy=true;
    try{
      const media=[...document.querySelectorAll("video,audio")];
      let playing=false;
      for(const item of media){
        const old=previous.get(item);previous.set(item,item.currentTime);
        if(!item.paused&&!item.ended&&item.readyState>=3&&(old===undefined||item.currentTime>old))playing=true;
      }
      const response=await chrome.runtime.sendMessage({type:"activity:signal",visible:document.visibilityState==="visible",pip:Boolean(document.pictureInPictureElement),playing});
      if(!response?.ok||!response.data?.allowed){enabled=false;clearInterval(interval);}
    }catch{enabled=false;clearInterval(interval);}finally{busy=false;}
  }
  let interval=setInterval(report,20000);
  globalThis.__studioSignals={start(){enabled=true;clearInterval(interval);interval=setInterval(report,20000);void report();}};
  for(const event of ["playing","pause","ended","waiting","visibilitychange"])document.addEventListener(event,report,true);
  void report();
})();
