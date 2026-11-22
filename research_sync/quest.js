(() => {
const token=new URLSearchParams(location.hash.slice(1)).get('token')||sessionStorage.getItem('vr-sync-token');
if(!token){location.replace('/q');return;}
sessionStorage.setItem('vr-sync-token',token);
const url=(location.protocol==='https:'?'wss:':'ws:')+'//localhost:'+(window.controlWsPort||8765);
let ws=null,retry=null,attempt=0,config=null,active=null,lastPong=-Infinity,lastFrame=null;
let pendingStart=false,lastUi=-Infinity,pendingEnded=null,returning=null,reservation=null;
const probes=[];
const now=()=>performance.now()/1000;
const scene=()=>document.querySelector('a-scene');
const send=m=>{if(ws?.readyState===1){ws.send(JSON.stringify(m));return true;}return false;};
const immersed=()=>!!scene().renderer?.xr?.isPresenting;
const visible=()=>!document.hidden&&scene().renderer?.xr?.getSession?.()?.visibilityState!=='hidden';
function model(){
  if(probes.length<8)return null;
  const sorted=[...probes].sort((a,b)=>a.rtt-b.rtt).slice(0,Math.max(4,Math.floor(probes.length/2)));
  return sorted.reduce((s,p)=>s+p.offset,0)/sorted.length;
}
function ready(){return !!config&&ws?.readyState===1&&now()-lastPong<2&&model()!==null&&immersed()&&visible()&&!returning&&lastFrame!==null&&now()-lastFrame<.25;}
function applyScene(s={roomHeightM:3,roomSizeM:6,frontWallDistanceM:3,gridSpacingM:.5}){
  const w=s.roomSizeM,h=s.roomHeightM,d=s.frontWallDistanceM,g=s.gridSpacingM,z=w/2-d;
  for(const [id,width,height,position,rotation] of [
    ['front',w,h,`0 ${h/2} ${-d}`,'0 0 0'],['back',w,h,`0 ${h/2} ${w-d}`,'0 180 0'],
    ['left',w,h,`${-w/2} ${h/2} ${z}`,'0 90 0'],['right',w,h,`${w/2} ${h/2} ${z}`,'0 -90 0'],
    ['floor',w,w,`0 0 ${z}`,'-90 0 0'],['ceiling',w,w,`0 ${h} ${z}`,'90 0 0']]){
    const el=document.querySelector('#scene-'+id);if(!el)continue;
    el.setAttribute('width',width);el.setAttribute('height',height);el.setAttribute('position',position);el.setAttribute('rotation',rotation);
    el.setAttribute('material','repeat',`${width/g} ${height/g}`);
  }
}
function ui(force=false){
  const q=now();if(!force&&q-lastUi<.25)return;lastUi=q;
  let text,japanese;
  if(reservation){const off=model();const left=off===null?reservation.fallbackExpiry-q:reservation.scheduled_pc_s-(q+off);text='START IN '+Math.max(0,Math.ceil(left));japanese='PCから開始予約を受信しました。開始まで約'+Math.max(0,Math.ceil(left))+'秒';}
  else if(active){const t=q-active.q_start_s,T=config.duration_s;text='RUNNING '+Math.floor(t)+' / '+T+' s';japanese='刺激中 '+Math.floor(t)+' / '+T+'秒';}
  else if(ws?.readyState!==1){text='RECONNECTING - please wait';japanese='自動再接続中です。そのままお待ちください。';}
  else if(!immersed()){text='Enter VR to continue';japanese='初回はVRボタンで入ってください。試行の開始・停止はPCで操作します。';}
  else if(returning){text='STOPPING - please wait';japanese='停止位置へ戻しています。';}
  else if(!ready()){text='SYNCING '+Math.min(8,probes.length)+' / 8';japanese='時計を同期中です…';}
  else {text='READY - PC control';japanese='準備完了。PCの計測ソフトから開始を予約できます。';}
  document.querySelector('#status').textContent=japanese;
  document.querySelector('#vr-status')?.setAttribute('text','value',text);
  document.querySelector('#vr-menu')?.setAttribute('visible',!active);
  document.querySelector('#vr-stop')?.setAttribute('visible',!!active);
  document.querySelector('#vr-start')?.setAttribute('material','color',ready()&&!pendingStart?'#227345':'#59636b');
}
function finish(reason,cancelReservation=true){
  const target=active||(cancelReservation?reservation:null);
  if(target){
    const event={type:'ended',trial_id:target.trial_id,q_s:now(),reason};
    if(!send(event))pendingEnded=event;
    if(active&&reason!=='complete'){
      const z=document.querySelector('#world').object3D.position.z;
      returning={at:now(),z};
    }
  }
  active=null;if(cancelReservation)reservation=null;pendingStart=false;ui(true);
}
function invalidate(reason,preserveReservation=false){finish(reason,!preserveReservation);probes.length=0;lastPong=-Infinity;ui(true);}
function checkReservation(activate){
  if(!reservation)return;
  const offset=model(),q=now(),late=offset===null?q-reservation.fallbackExpiry:q+offset-reservation.scheduled_pc_s;
  if(late>.15||(late>=0&&!ready())){
    const id=reservation.trial_id;reservation=null;pendingStart=false;
    send({type:'blocked',trial_id:id,message:'予約時刻にQuestのVR描画・時計同期が未準備です。装着して再予約してください。'});ui(true);return;
  }
  if(activate&&late>=0&&ready()){
    active={...reservation,q_start_s:reservation.scheduled_pc_s-offset,offset};reservation=null;ui(true);
  }
}
function requestStart(){
  if(active||reservation||pendingStart||!ready())return;
  pendingStart=send({type:'start'});
}
function stop(){finish('quest-stop');send({type:'stop'});}
function onMessage(event){
  const m=JSON.parse(event.data);
  if(m.type==='config'){
    config=m.stimulus;applyScene(config.scene);
    window.FixationTarget?.configure(scene(),config.fixation);
    send({type:'setup',q_s:now(),reference:'fixed local-floor origin',ap_positive:'world -Z',wall_distance_m:3,wall_width_m:6,wall_height_m:3,grid_spacing_m:.5,alignment_required:false});
    if(pendingEnded){send(pendingEnded);pendingEnded=null;}
  }
  if(m.type==='capture_height'){
    try{
      if(active||reservation||returning)throw new Error('試行中・予約中は高さを変更できません');
      if(!immersed()||!visible()||lastFrame===null||now()-lastFrame>.25)throw new Error('Questを装着してVR表示に入ってください');
      const height=window.FixationTarget.captureHeight(scene());
      send({type:'height_result',request_id:m.request_id,ok:true,height_m:height,q_s:now()});
    }catch(error){send({type:'height_result',request_id:m.request_id,ok:false,message:error.message,q_s:now()});}
  }
  if(m.type==='pong'){
    const q4=now(),rtt=q4-m.q1-(m.p3-m.p2),offset=(m.p2+m.p3-m.q1-q4)/2;
    if(rtt>=-.0001){probes.push({rtt,offset});if(probes.length>240)probes.shift();lastPong=q4;}
    send({type:'probe',q1:m.q1,p2:m.p2,p3:m.p3,q4});ui();
  }
  if(m.type==='start'){
    pendingStart=false;
    send({type:'received',trial_id:m.trial_id,q_receive_s:now(),scheduled_pc_s:m.scheduled_pc_s});
    if(active||reservation||!config){
      send({type:'blocked',trial_id:m.trial_id,message:'Already active or missing stimulus configuration'});return;
    }
    reservation={...m,fallbackExpiry:now()+Math.max(0,m.scheduled_pc_s-(m.pc_sent_s??m.scheduled_pc_s-3))};ui(true);
  }
  if(m.type==='stop')finish('remote-stop');
  if(m.type==='error'){pendingStart=false;ui(true);}
}
function connect(){
  if(ws&&(ws.readyState===0||ws.readyState===1))return;
  if(retry!==null){clearTimeout(retry);retry=null;}
  const socket=new WebSocket(url);ws=socket;probes.length=0;lastPong=-Infinity;config=null;
  socket.onopen=()=>{
    if(ws!==socket)return;attempt=0;
    send({role:'quest',token,user_agent:navigator.userAgent,client_version:'pc-control-v3'});
    send({type:'capabilities',secure_context:window.isSecureContext,xr_available:!!navigator.xr,user_agent:navigator.userAgent});ui(true);
  };
  socket.onmessage=e=>{if(ws===socket)onMessage(e);};
  socket.onclose=()=>{
    if(ws!==socket)return;invalidate('disconnect');
    retry=setTimeout(()=>{retry=null;connect();},Math.min(5000,500*2**attempt++));
  };
  socket.onerror=()=>socket.close();
}
setInterval(()=>{
  checkReservation(false);
  // XR frames can stop on headset removal while page timers and sockets keep
  // running. Detect this here too, without waiting for another XR tick.
  if(active&&lastFrame!==null&&now()-lastFrame>2)invalidate('frame-suspension');
  if(ws?.readyState===1){
    if(Number.isFinite(lastPong)&&now()-lastPong>3){invalidate('heartbeat-lost');ws.close();}
    else send({type:'ping',q1:now(),xr_presenting:immersed(),visible:visible(),rendering:lastFrame!==null&&now()-lastFrame<.25});
  }else if(retry===null)connect();
  ui();
},250);
document.addEventListener('visibilitychange',()=>{
  invalidate(document.hidden?'hidden':'visible-again',true);
  if(!document.hidden)connect();
});
scene().addEventListener('exit-vr',()=>{window.FixationTarget?.clearHeight();send({type:'height_invalidated'});invalidate('xr-exited',true);});
scene().addEventListener('enter-vr',()=>{probes.length=0;lastPong=-Infinity;connect();ui(true);});
document.querySelector('#vr-start')?.addEventListener('click',requestStart);
document.querySelector('#vr-stop')?.addEventListener('click',stop);
AFRAME.registerComponent('research-driver',{
  tick(){
    const q=now(),world=document.querySelector('#world').object3D;
    if(active&&lastFrame!==null&&q-lastFrame>2)invalidate('frame-suspension');
    lastFrame=q;
    window.FixationTarget?.tick(scene(),active?Math.max(0,q-active.q_start_s):0);
    checkReservation(true);
    if(active&&(!immersed()||!visible()||q-lastPong>2))invalidate('xr-or-heartbeat-lost');
    if(!active){
      if(returning){const u=Math.min(1,(q-returning.at)/2);world.position.z=returning.z*(1-u*u*(3-2*u));if(u>=1)returning=null;}
      ui();return;
    }
    const t=q-active.q_start_s;
    if(t<0){ui();return;}
    if(t>=config.duration_s){world.position.z=0;finish('complete');return;}
    const s=ResearchWaveform.evaluate(t,config);world.position.z=-s.x;
    send({type:'frame',trial_id:active.trial_id,q_apply_s:q,pc_estimate_s:q+active.offset,
      condition:config.condition||'multicosine',fixation_anchor:window.FixationTarget?.position(),elapsed_s:t,ap_m:s.x,ap_m_s:s.v,ap_m_s2:s.a,state:'software-transform',
      timing_kind:'A-Frame tick performance.now; not predicted display time or photons'});ui();
  }
});
connect();
})();
