(() => {
const $=id=>document.getElementById(id);let config=null,verification=null,frameReady=false,sent=false,playing=false,time=0,origin=0;
function render(){
 if(!config)return;
 $('time').value=time;$('elapsed').textContent=time.toFixed(2)+' / '+config.duration_s+' s';
 if(frameReady){const msg={type:'visual-set',time_s:time};if(!sent){msg.config=config;sent=true;}$('view').contentWindow.postMessage(msg,location.origin);}
}
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.source!==$('view').contentWindow)return;
 if(event.data.type==='visual-ready'){frameReady=true;sent=false;render();}
 if(event.data.type==='visual-state'){const s=event.data.state;$('live').textContent=`変位 ${s.x.toFixed(5)} m　速度 ${s.v.toFixed(5)} m/s　加速度 ${s.a.toFixed(5)} m/s²`;}
});
$('view').addEventListener('load',()=>{frameReady=true;sent=false;render();});
$('play').onclick=()=>{if(!config)return;if(time>=config.duration_s)time=0;playing=!playing;origin=performance.now()/1000-time;$('play').textContent=playing?'一時停止':'再生';render();};
$('reset').onclick=()=>{playing=false;time=0;$('play').textContent='再生';render();};
$('time').oninput=()=>{time=Number($('time').value);origin=performance.now()/1000-time;render();};
function tick(){if(playing&&config){time=Math.min(config.duration_s,performance.now()/1000-origin);if(time>=config.duration_s){playing=false;$('play').textContent='再生';}render();}requestAnimationFrame(tick);}requestAnimationFrame(tick);
Promise.all([fetch('data/stimulus.json').then(r=>r.json()),fetch('data/verification.json').then(r=>r.json())]).then(([c,v])=>{
 config=c;verification=v;$('time').max=c.duration_s;
 $('max-v').textContent=v.maxima.velocity_m_s.value.toFixed(8)+' m/s';$('max-x').textContent=v.maxima.displacement_m.value.toFixed(5)+' m';$('component').textContent=v.common_acceleration_amplitude_m_s2.toFixed(8)+' m/s²';
 c.frequencies_hz.forEach((f,i)=>{const cell=document.createElement('div');cell.textContent=f.toFixed(2)+' Hz　'+v.measured_component_amplitudes_m_s2[i].toFixed(8);$('amplitudes').appendChild(cell);});render();
}).catch(e=>$('error').textContent='読込エラー: '+e.message);
})();
