(() => {
let config=null,time=0;
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.source!==parent||event.data.type!=='visual-set')return;
 if(event.data.config)config=event.data.config;
 if(Number.isFinite(event.data.time_s))time=event.data.time_s;
});
AFRAME.registerComponent('visual-preview-driver',{
 tick(){if(!config)return;const s=ResearchWaveform.evaluate(time,config);document.querySelector('#world').object3D.position.z=-s.x;parent.postMessage({type:'visual-state',state:s},location.origin);}
});
parent.postMessage({type:'visual-ready'},location.origin);
})();
