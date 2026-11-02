(() => {
  'use strict';
  if(!window.AFRAME){reportStartupError('A-Frameが読み込めません');return;}
  const T=AFRAME.THREE, preview=new URLSearchParams(location.search).has('preview');
  const scene=document.querySelector('#scene-template').content.firstElementChild.cloneNode(true);
  const info=document.querySelector('#info'), status=document.querySelector('#status');
  let root,user,connected=false,hadConnection=false,offset=0,instanceId=crypto.randomUUID();
  let seq=0,commandSeq=null,active=null,calibration=null,wasVR=false,observedSession=null,lost=false;
  let settings=ManiStimulus.validate(), cloud=null, points=[], firebaseState=preview?'プレビュー（Firebaseなし）':'準備中';
  const logs=[], matrix=new T.Matrix4();
  const fixation=new T.Mesh(new T.PlaneGeometry(.1,.1),new T.MeshBasicMaterial({color:'#ff0000',toneMapped:false,depthTest:false}));
  fixation.position.set(0,0,-15);fixation.renderOrder=10;
  const immersive=()=>!!(scene.renderer?.xr.isPresenting&&scene.renderer.xr.getSession()&&!scene.is('ar-mode'));
  const rendered=()=>!!(scene.renderStarted&&scene.camera&&!lost);
  const ready=()=>rendered()&&(preview||immersive());
  function diagnostics(){return {instanceId,protocol:'mani-2022',renderStarted:rendered(),immersive:immersive(),
    calibrated:!!calibration,calibration,firebaseState,settings,stimulusVersion:ManiStimulus.version,fidelity:ManiStimulus.fidelity,
    elapsedSec:active?.started!==null&&active?(performance.now()-active.started)/1000:0,
    renderedFrames:active?.samples.length||0,startupError:window.vrLastError||''};}
  function ack(state,extra={}) {
    document.querySelector('#diagnostics').textContent=`3D: ${rendered()} / VR: ${immersive()} / Firebase: ${firebaseState}`;
    if(preview||!root||!user||!connected)return;
    root.child('status').set({status:state,commandSeq,...diagnostics(),...extra,at:firebase.database.ServerValue.TIMESTAMP,questUid:user.uid})
      .catch(e=>{firebaseState='状態送信失敗';reportStartupError(e.message);});
  }
  function build(c) {
    settings=c;points=ManiStimulus.generate(c);
    if(cloud){scene.querySelector('#cloud').removeObject3D('mesh');cloud.geometry.dispose();cloud.material.dispose();}
    // Clip fragments in each XR eye's view space; no sphere can leak over the horizontal boundary.
    const material=new T.ShaderMaterial({uniforms:{field:{value:{full:0,upper:1,lower:2,none:3}[c.condition]},elapsed:{value:0},speed:{value:c.speedMps},nearDepth:{value:c.nearM},depthSpan:{value:c.farM-c.nearM}},
      vertexShader:'uniform float elapsed; uniform float speed; uniform float nearDepth; uniform float depthSpan; varying float viewY; varying float cloudDepth; void main(){vec4 center=instanceMatrix*vec4(0.0,0.0,0.0,1.0);center.z=-(nearDepth+mod(-center.z-nearDepth-speed*elapsed,depthSpan));vec4 local=center+vec4(position,0.0);cloudDepth=-local.z;vec4 p=modelViewMatrix*local;viewY=p.y;gl_Position=projectionMatrix*p;}',
      fragmentShader:'uniform int field; uniform float nearDepth; varying float viewY; varying float cloudDepth; void main(){if(cloudDepth<nearDepth||field==3||(field==1&&viewY<=0.0)||(field==2&&viewY>=0.0))discard;gl_FragColor=vec4(1.0);}',
      toneMapped:false});
    const geometry=new T.SphereGeometry(c.radiusM,8,6);
    cloud=new T.InstancedMesh(geometry,material,points.length);cloud.frustumCulled=false;
    for(let i=0;i<points.length;i++){const p=points[i];matrix.makeTranslation(p[0],p[1],-p[2]);cloud.setMatrixAt(i,matrix);}
    cloud.instanceMatrix.needsUpdate=true;
    scene.querySelector('#cloud').setObject3D('mesh',cloud);updateCloud(0);cloud.visible=false;
  }
  function updateCloud(t) {
    cloud.count=points.length;
    cloud.material.uniforms.elapsed.value=t;
  }
  function finish(reason='completed') {
    const trial=active;active=null;if(cloud)cloud.visible=false;
    if(!trial)return;
    const log={protocol:'mani-2022',doi:ManiStimulus.doi,fidelity:ManiStimulus.fidelity,
      command:trial.command,settings:trial.settings,calibration:trial.calibration,reason,
      fixation:ManiStimulus.fixation,assumptions:ManiStimulus.assumptions,analysisWindowSec:[10,40],stimulusVersion:ManiStimulus.version,
      paperReferenceSphereTotal:trial.settings.durationSec*trial.settings.emissionRate,
      particlePoolSize:trial.settings.condition==='none'?0:points.length,
      lastSubmittedSphereCount:trial.settings.condition==='none'?0:cloud.count,
      countdownStartedWallMs:trial.countdownWall,startedWallMs:trial.startedWall,endedWallMs:Date.now(),
      serverOffsetMs:offset,timeOriginMs:performance.timeOrigin,
      sampleColumns:['elapsed_ms','performance_ms','epoch_estimate_ms','head_x_m','head_y_m','head_z_m','qx','qy','qz','qw'],
      samples:trial.samples,nominalXRHz:trial.nominalXRHz,
      note:'Software frame/pose timestamps, not measured photon output or force-plate synchronization.'};
    logs.push(log);status.textContent='停止・終了: '+reason;ack('idle',{reason,lastRunId:trial.command.runId});
    if(!preview&&root&&user)root.child('logs/'+user.uid+'/'+trial.command.runId).set(log).catch(e=>ack('log-error',{error:e.message}));
  }
  function syncXR() {
    const vr=immersive(),session=vr?scene.renderer.xr.getSession():null;
    if(vr!==wasVR){wasVR=vr;calibration=null;if(!vr)finish('vr-exited');info.style.display=preview||vr?'none':'block';ack('connected');}
    if(session&&session!==observedSession){observedSession=session;
      session.addEventListener('end',()=>{calibration=null;finish('vr-exited');});
      session.addEventListener('visibilitychange',()=>{if(session.visibilityState!=='visible'){calibration=null;finish('xr-not-visible');}});
    }
  }
  const head=new T.Vector3(),quaternion=new T.Quaternion();
  function pose(){const camera=preview?scene.camera:scene.renderer.xr.getCamera(scene.camera);camera.getWorldPosition(head);camera.getWorldQuaternion(quaternion);}
  function command(c) {
    if(!c||!Number.isSafeInteger(c.seq))return;
    if(['stop','emergency'].includes(c.type)) {finish('stopped');ack('idle',{commandSeq:c.seq,reason:'stopped'});return;}
    if(!preview&&(c.questInstanceId!==instanceId||!Number.isFinite(c.requestedAt)||Math.abs(Date.now()+offset-c.requestedAt)>15000))return;
    if(c.seq<=seq)return;seq=c.seq;commandSeq=c.seq;syncXR();
    try {
      if(!rendered())throw Error('3D描画の完了を待ってください');
      if(active)throw Error('STOPしてから条件を変更してください');
      if(c.type==='configure'){build(ManiStimulus.validate(c.settings));ack('configured');return;}
      if(!ready())throw Error('QuestでVRを開始してください');
      if(c.type==='calibrate') {
        pose();const el=scene.querySelector('#cloud');el.object3D.position.copy(head);el.object3D.quaternion.copy(quaternion);
        calibration={position:head.toArray(),quaternion:quaternion.toArray(),at:Date.now(),
          reference:'cloud fixed at calibrated head pose; mask in current per-eye view coordinates; no gaze tracking'};
        ack('ready');return;
      }
      if(c.type!=='start')return;
      if(!calibration)throw Error('PCで正面位置合わせをしてください');
      if(!/^trial-[A-Za-z0-9_-]{1,100}$/.test(c.runId||''))throw Error('runIdが不正です');
      const next=ManiStimulus.validate(c.settings);build(next);
      active={command:c,settings:next,calibration:JSON.parse(JSON.stringify(calibration)),
        countdown:performance.now(),countdownWall:Date.now(),started:null,startedWall:null,samples:[],
        nominalXRHz:scene.renderer.xr.getSession()?.frameRate||null};
      ack('countdown',{runId:c.runId});
    }catch(e){status.textContent=e.message;ack('blocked',{error:e.message});}
  }
  AFRAME.registerComponent('mani-driver',{tick(){
    syncXR();if(!active)return;
    if(!ready()||(!preview&&!connected)){finish('not-ready');return;}
    const now=performance.now();
    if(active.started===null){if(now-active.countdown<settings.countdownSec*1000)return;
      active.started=now;active.startedWall=Date.now();cloud.visible=settings.condition!=='none';ack('running',{runId:active.command.runId});}
    const t=(now-active.started)/1000;
    if(t>=settings.durationSec){finish();return;}
    updateCloud(t);pose();active.samples.push([t*1000,now,performance.timeOrigin+now,...head.toArray(),...quaternion.toArray()]);
  }});
  if(preview){info.style.display='none';scene.setAttribute('xr-mode-ui','enabled: false');scene.setAttribute('embedded','');
    window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===parent&&e.data?.type==='mani-command')command(e.data.command);});}
  scene.addEventListener('renderstart',()=>{
    scene.querySelector('#cloud').setObject3D('fixation',fixation);
    pose();scene.querySelector('#cloud').object3D.position.copy(head);scene.querySelector('#cloud').object3D.quaternion.copy(quaternion);
    build(settings);ack('connected');
    scene.canvas.addEventListener('webglcontextlost',()=>{lost=true;calibration=null;finish('graphics-lost');reportStartupError('描画停止。再読込してください');});
    if(preview)parent.postMessage({type:'mani-preview-ready'},location.origin);
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&!preview){calibration=null;finish('page-hidden');}});
  window.addEventListener('pagehide',()=>finish('page-hidden'));
  document.querySelector('#download').onclick=()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(logs,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='mani-quest-logs.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  document.body.appendChild(scene);
  setInterval(()=>{syncXR();ack(active?(active.started===null?'countdown':'running'):'idle');},2000);
  async function script(src){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(Error('読込失敗: '+src));document.head.appendChild(s);});}
  async function connect(){
    if(preview)return;
    await script('firebase-config.js');
    for(const name of ['app','auth','database'])await script(`https://www.gstatic.com/firebasejs/10.12.2/firebase-${name}-compat.js`);
    const config=window.VR_REMOTE_CONFIG,app=firebase.initializeApp(config.firebase,'mani-quest-'+instanceId);
    const auth=app.auth();await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);user=(await auth.signInAnonymously()).user;
    const db=app.database();root=db.ref('sessions/'+config.sessionId+'-mani');
    db.ref('.info/serverTimeOffset').on('value',s=>{offset=s.val()||0;});
    db.ref('.info/connected').on('value',s=>{
      connected=s.val()===true;firebaseState=connected?'接続済み':'切断';
      if(!connected){calibration=null;finish('connection-lost');}
      else {if(hadConnection){instanceId=crypto.randomUUID();seq=0;}hadConnection=true;ack('connected');}
    });
    root.child('command').on('value',s=>{if(connected)command(s.val());},e=>{finish('subscription-failed');reportStartupError(e.message);});
  }
  const start=()=>connect().catch(e=>{firebaseState='接続エラー';reportStartupError(e.message);});
  if(document.readyState==='complete')start();else window.addEventListener('load',start,{once:true});
})();
