(()=>{
let profiles=[],c=null,t=0,playing=false,last=null;
const view=document.querySelector('#view'),select=document.querySelector('#profile'),slider=document.querySelector('#time'),button=document.querySelector('#play');
function draw(){if(!c)return;slider.value=t;document.querySelector('#elapsed').textContent=t.toFixed(2)+' / '+c.duration_s+' s';view.contentWindow.postMessage({type:'visual-set',config:c,time_s:t},location.origin);}
function choose(){playing=false;button.textContent='再生';c=profiles[select.selectedIndex];t=0;slider.max=c.duration_s;button.disabled=!c.enabled;document.querySelector('#info').textContent='定常解析区間 '+c.analysis_interval_s.join('–')+'秒 ／ 成分加速度振幅 '+c.acceleration_component_m_s2.toFixed(8)+' m/s²\n'+(c.enabled?'暫定上限内（人体安全性の検証済みという意味ではありません）':'上限超過：計測アプリでも開始できません');draw();}
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===view.contentWindow&&e.data.type==='visual-ready')draw();});view.addEventListener('load',draw);
select.onchange=choose;slider.oninput=()=>{playing=false;button.textContent='再生';t=Number(slider.value);draw();};document.querySelector('#reset').onclick=choose;
button.onclick=()=>{if(t>=c.duration_s)t=0;playing=!playing;button.textContent=playing?'一時停止':'再生';last=null;};
function tick(now){if(playing&&c){if(last!==null)t=Math.min(c.duration_s,t+(now-last)/1000);if(t>=c.duration_s){playing=false;button.textContent='再生';}draw();}last=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);
fetch('pilot_profiles/index.json').then(r=>r.json()).then(data=>{profiles=data;for(const p of data){const option=document.createElement('option');option.textContent=p.condition+(p.enabled?'':'（開始不可）');select.appendChild(option);const row=document.createElement('tr');for(const value of [p.condition,p.acceleration_component_m_s2.toFixed(6),...['displacement_m','velocity_m_s','acceleration_m_s2'].map(k=>p.maxima[k].value.toFixed(4)),p.enabled?'可':'不可']){const td=document.createElement('td');td.textContent=value;row.appendChild(td);}document.querySelector('#rows').appendChild(row);}choose();}).catch(e=>document.querySelector('#info').textContent=e.message);
})();
