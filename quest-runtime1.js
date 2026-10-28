(() => {
  'use strict';
  if (!window.AFRAME) {
    reportStartupError('A-Frameが読み込めません。ネットワークを確認してください。');
    return;
  }
  const THREE = AFRAME.THREE;
  const preview = new URLSearchParams(location.search).has('preview');
  const scene = document.querySelector('#scene-template').content.firstElementChild.cloneNode(true);
  let instanceId = crypto.randomUUID();
  let root, user, connected = false, hadConnection = false, serverOffset = 0;
  let active = null, pending = null, generation = 0, lastSeq = 0, commandSeq = null;
  let calibration = null;
  let calibrated = preview, wasImmersive = false, graphicsLost = false, observedSession = null;
  let xrSupport = '確認中', firebaseState = preview ? 'プレビュー（接続なし）' : '準備中';
  const pivot = new THREE.Vector3(0, 0.088, 0); // 校正原点。motionConfigの固定中心とは独立。
  const patternTextures = new Map();
  let noiseRoomMetadata = null;
  let selectedPattern = StimulusPatterns.defaultPattern;
  let fixationVisible = true;
  let rotationCenter = 'ankle';
  let kiemelConfig=KiemelConfig.clone(KiemelConfig.CONFIG), kiemelModel=null, originInitialized=false;
  const kiemelOrigin=new THREE.Vector3(), kiemelAxis=new THREE.Vector3(1,0,0), kiemelCache=new Map();
  function trackedEyeCenter(target) {
    const camera=scene.renderer.xr.getCamera(scene.camera);
    const eyes=(camera.cameras||[]).map(eye=>eye.matrixWorld?.elements?.slice(12,15)).filter(p=>p?.length===3&&p.every(Number.isFinite));
    if(eyes.length>=2) {
      target.set(...[0,1,2].map(i=>eyes.reduce((sum,p)=>sum+p[i],0)/eyes.length));
      return 'mean XR view world positions; no temporal averaging';
    }
    camera.getWorldPosition(target);return 'XR camera position; stereo matrices unavailable';
  }
  function candidateKiemel(c,bodyRequired=false) {
    const cfg=KiemelConfig.clone(c.kiemel || KiemelConfig.CONFIG);
    cfg.projection ||= KiemelConfig.clone(KiemelConfig.CONFIG.projection);
    if(!Number.isInteger(cfg.projection.resolution)||cfg.projection.resolution<256||cfg.projection.resolution>2048)throw Error('投影解像度は256〜2048の整数が必要です');
    KiemelMotion.validate(cfg,bodyRequired);KiemelEnvironment.walls(cfg.geometry);return cfg;
  }
  function resetKiemel() {
    const el=scene.querySelector('#kiemel-environment');
    if(el) {el.object3D.setRotationFromAxisAngle(kiemelAxis,0);el.object3D.position.copy(kiemelOrigin);const source=el.getObject3D('mesh')?.userData.projection.source;if(source){source.position.set(0,0,0);source.rotation.set(0,0,0);KiemelProjection.request(el.getObject3D('mesh'));}}
  }
  function applyKiemel(pose) {
    const screens=scene.querySelector('#kiemel-environment').getObject3D('mesh'),world=screens.userData.projection.source;
    const center=new THREE.Vector3(...pose.pivot),angle=KiemelMotion.rad(pose.renderAngleDeg);
    world.setRotationFromAxisAngle(kiemelAxis,angle);
    world.position.copy(center).sub(center.clone().applyAxisAngle(kiemelAxis,angle));
    world.position.set(world.position.x,world.position.y,world.position.z+pose.translationZ);
    KiemelProjection.request(screens);
  }
  function tickKiemel(now) {
    const elapsed=(now-active.startedPerf)/1000;
    let pose=KiemelMotion.at(elapsed,active.kiemel,active.cmd.mode==='baseline'),stopComplete=false;
    if(active.returning) {
      const u=Math.min(1,(now-active.returning.at)/2000),factor=1-u*u*(3-2*u);
      pose={...KiemelMotion.pose(active.returning.ankleReferenceDeg*factor,active.kiemel.body,active.kiemel.motion.type),phase:'returning'};
      stopComplete=u===1;
    }
    applyKiemel(pose);active.lastPose=pose;active.actualAngle=pose.angleDeg;
    if(active.lastSamplePerf!==undefined)active.maxIntervalMs=Math.max(active.maxIntervalMs||0,now-active.lastSamplePerf);
    active.lastSamplePerf=now;
    active.samples.push([Math.round(elapsed*1000),pose.angleDeg,active.returning?0:pose.angleDeg,now,performance.timeOrigin+now,
      pose.translationZ,active.returning?0:pose.translationZ,pose.ankleReferenceDeg,pose.eyeLinearZ,pose.eyeExactZ,pose.phase]);
    if(pose.phase!==active.lastPhase) {
      active.lastPhase=pose.phase;show('Kiemel '+pose.phase+' / '+active.kiemel.motion.type);
      ack(pose.phase==='stimulus'?'running':pose.phase,{runId:active.cmd.runId});
    }
    if(stopComplete)finish('stopped');else if(pose.phase==='completed')finish('completed');
  }
  function selectKiemel() {
    if(!originInitialized) {scene.camera?.getWorldPosition?.(kiemelOrigin);originInitialized=true;}
    const p=kiemelConfig.pattern, geometryPattern={...p};delete geometryPattern.fixationPoint;
    const key=JSON.stringify([kiemelConfig.geometry,geometryPattern,kiemelConfig.projection]);
    if(!kiemelCache.has(key)) {
      const model=KiemelEnvironment.generate(kiemelConfig);
      kiemelCache.set(key,{model,group:KiemelProjection.create(THREE,model,p,kiemelConfig.projection.resolution)});
    }
    const entry=kiemelCache.get(key);kiemelModel=entry.model;
    entry.group.userData.projection.source.userData.fixation.visible=p.fixationPoint;
    scene.querySelector('#kiemel-environment').setObject3D('mesh',entry.group);resetKiemel();
  }
  // 配置の原点と運動の回転中心は別。pivotは既存のキャリブレーション結果。
  const axisLength=Math.hypot(motionConfig.rotationAxis.x,motionConfig.rotationAxis.y,motionConfig.rotationAxis.z);
  if (!Number.isFinite(axisLength) || !axisLength) throw Error('motionConfig.rotationAxisが不正です');
  const motionAxis=new THREE.Vector3(motionConfig.rotationAxis.x/axisLength,motionConfig.rotationAxis.y/axisLength,motionConfig.rotationAxis.z/axisLength);
  function rotationPivot() {
    if (!['calibrated','fixed'].includes(motionConfig.pivot.mode)) throw Error('motionConfig.pivot.modeが不正です');
    const calibratedCenter=rotationCenter==='hip' && Number.isFinite(calibration?.manualHipHeightM) ?
      {x:pivot.x,y:calibration.manualHipHeightM,z:pivot.z} : pivot;
    const base=motionConfig.pivot.mode === 'fixed' ? motionConfig.pivot.positionM : calibratedCenter;
    const offset=motionConfig.pivot.offsetM;
    const values=[base.x+offset.x,base.y+offset.y,base.z+offset.z];
    if (!values.every(Number.isFinite)) throw Error('回転中心が不正です');
    return new THREE.Vector3(...values);
  }
  function layoutSettings() {
    if(selectedPattern==='kiemel-triangles')return {profile:'Kiemel',geometry:KiemelConfig.clone(kiemelConfig.geometry),walls:kiemelModel?.walls.map(({id,width,height,center,u,v})=>({id,width,height,center,u,v}))||null,eyeOrigin:kiemelOrigin.toArray(),projection:{method:'fixed-screen-offaxis',referenceEye:kiemelOrigin.toArray(),resolution:kiemelConfig.projection.resolution},coordinateSystem:'fixed eye origin; +X right,+Y up,+Z posterior; positive paper motion = forward (-Z)' };
    return { ...JSON.parse(JSON.stringify(layoutConfig)), anchorOriginM: layoutConfig.anchor === 'calibrated-xz' ? {x:pivot.x,y:0,z:pivot.z} : {x:0,y:0,z:0} };
  }
  function motionSettings() {
    if(selectedPattern==='kiemel-triangles') {
      let dimensions=null;try{dimensions=KiemelMotion.bodyDimensions(kiemelConfig.body);}catch{/* Static display may precede body entry. */}
      return {profile:'Kiemel',...KiemelConfig.clone(kiemelConfig.motion),rotationAxis:[1,0,0],renderAnglePerPaperAngle:-1,positiveDirection:'paper angle positive = forward (-Z); renderer Rx uses negative paper angle',anklePivotLocal:dimensions?[0,-dimensions.H,0]:null,hipPivotLocal:dimensions?[0,-dimensions.l2,0]:null,
        anklePivotWorld:dimensions?[kiemelOrigin.x,kiemelOrigin.y-dimensions.H,kiemelOrigin.z]:null,hipPivotWorld:dimensions?[kiemelOrigin.x,kiemelOrigin.y-dimensions.l2,kiemelOrigin.z]:null,approximationBounds:dimensions?KiemelMotion.bounds(kiemelConfig):null};
    }
    const eyeHeight=calibration?.measuredEyeHeightM ?? calibration?.previewEyeHeightM ?? null;
    const eyeAboveAnkleM=Number.isFinite(eyeHeight)?eyeHeight-pivot.y:null;
    const resolvedPivotM=rotationCenter==='translation'?pivot.toArray():rotationPivot().toArray();
    return { ...JSON.parse(JSON.stringify(motionConfig)), rotationCenter, resolvedPivotM, normalizedAxis:motionAxis.toArray(),
      ...(rotationCenter==='translation'?{translationModel:'Kiemel small-angle equivalence: z=-H*theta',eyeAboveAnkleM,referenceAngle:'ankle-equivalent radians'}:{}) };
  }
  function patternSettings() {
    if(selectedPattern==='kiemel-triangles')return {profile:'Kiemel-user-specification',generatorVersion:'kiemel-environment-v1',...KiemelConfig.clone(kiemelConfig.pattern),fingerprint:kiemelModel?.fingerprint||null,totalCount:kiemelModel?.count||null};
    if(selectedPattern==='grid-room')return {profile:'gray-grid-room',dimensionsM:[8,4,8],gridSpacingM:1,fixationVisible};
    if(selectedPattern==='red-sphere-fore-aft')return {profile:'red-sphere-fore-aft',radiusM:.03,centerDistanceM:1.5,travelAmplitudeM:.5,eyeHeightAligned:true};
    if(['compact-grid-room','grid-floor-only'].includes(selectedPattern)){const bodyHeightM=(calibration?.heightCm||160)/100,roomHeightM=bodyHeightM*1.7;return {profile:selectedPattern,dimensionsM:[6,roomHeightM,6],gridSpacingM:.5,eyeAtVerticalCenter:true,combinedMotion:{translationAmplitudeM:.1}};}
    if(selectedPattern==='noise-room')return {profile:'1-over-f-noise-room',dimensionsM:[8,4,8],fixationVisible,
      texture:noiseRoomMetadata || StimulusPatterns.metadata('noise-1f')};
    return patternTextures.get(selectedPattern)?.metadata || StimulusPatterns.metadata(selectedPattern);
  }
  const show = message => { document.querySelector('#status').textContent = message; };
  const immersive = () => !!(scene.renderer?.xr.isPresenting &&
    scene.renderer.xr.getSession() && !scene.is('ar-mode'));
  const rendered = () => !!(scene.renderStarted && scene.camera && !graphicsLost);
  const ready = () => rendered() && (preview || immersive());
  function diagnostics() {
    return { instanceId, loaded: !!scene.hasLoaded, renderStarted: rendered(),
      vrButton: !!scene.querySelector('.a-enter-vr-button'), secureContext: isSecureContext,
      xrSupport, immersive: immersive(), calibrated, calibration, firebaseState,
      xrPresenting: !!scene.renderer?.xr.isPresenting,
      xrSessionActive: !!scene.renderer?.xr.getSession(),
      aframeVR: scene.is('vr-mode'), client: navigator.userAgent || 'unknown',
      pattern: selectedPattern, patternSettings: patternSettings(), layoutSettings:layoutSettings(), motionSettings:motionSettings(),
      translationZ:active?.lastPose?.translationZ||0,kiemelPhase:active?.lastPose?.phase||null,kiemelCondition:selectedPattern==='kiemel-triangles'?(active?.kiemel||kiemelConfig).motion.type:null,
      elapsedSeconds:active?(performance.now()-active.startedPerf)/1000:0,renderedFrames:active?.samples.length||0,appliedAngleDeg: active?.actualAngle || 0, startupError: window.vrLastError || '' };
  }
  function updateDiagnostics() {
    const d = diagnostics();
    const text =
      `3D: ${d.renderStarted ? '描画中' : '未完了'} / VRボタン: ${d.vrButton ? '生成済み' : '未生成'} / WebXR: ${d.xrSupport} / immersive-vr: ${d.immersive ? '開始済み' : '未開始'} / Firebase: ${d.firebaseState}`;
    const node = document.querySelector('#diagnostics');
    if (node.textContent !== text) node.textContent = text;
  }
  function ack(status, detail = {}) {
    updateDiagnostics();
    if (preview || !root || !user || !connected) return;
    root.child('status').set({ status, commandSeq, ...diagnostics(), ...detail,
      at: firebase.database.ServerValue.TIMESTAMP, questUid: user.uid }).catch(error => {
      firebaseState = '状態送信失敗'; updateDiagnostics(); console.error(error);
    });
  }
  // One visible mesh. Textures are generated once per pattern and reused, never per frame.
  function prepareNoiseRoom() {
    if(noiseRoomMetadata)return;
    const canvas=scene.querySelector('#noise-room-texture');
    if(!canvas)return;
    const result=StimulusPatterns.generate('noise-1f'),ctx=canvas.getContext('2d');
    const image=ctx.createImageData(result.width,result.height);image.data.set(result.rgba);ctx.putImageData(image,0,0);
    noiseRoomMetadata=result.metadata;
    // If A-Frame has already created the canvas-backed maps, upload the new pixels.
    scene.querySelector('#noise-room-pattern')?.object3D?.traverse?.(object=>{if(object.material?.map)object.material.map.needsUpdate=true;});
  }
  function selectPattern(pattern) {
    const definition = StimulusPatterns.get(pattern);
    if (!definition) throw Error('映像パターン不正');
    pattern = StimulusPatterns.resolve(pattern);
    selectedPattern = pattern;
    const isKiemel=pattern==='kiemel-triangles', isGridRoom=pattern==='grid-room', isNoiseRoom=pattern==='noise-room';
    const isSphere=pattern==='red-sphere-fore-aft',isCompact=pattern==='compact-grid-room',isFloorOnly=pattern==='grid-floor-only';
    scene.querySelector('#visual-world').object3D.visible=!isKiemel;
    scene.querySelector('#kiemel-environment').object3D.visible=isKiemel;
    scene.querySelector('#contrast-surround').setAttribute('color',(isKiemel||isSphere)?'#08080a':'#ffffff');
    if(isKiemel) {scene.querySelector('#contrast-surround').object3D.visible=true;selectKiemel();return;}
    if(isNoiseRoom)prepareNoiseRoom();
    const gridRoom=scene.querySelector('#grid-room-pattern'), noiseRoom=scene.querySelector('#noise-room-pattern');
    const fixation=scene.querySelector('#fixation-point'), noiseFixation=scene.querySelector('#noise-fixation-point');
    gridRoom.object3D.visible=isGridRoom;
    noiseRoom.object3D.visible=isNoiseRoom;
    const eyeY=calibration?.measuredEyeHeightM ?? calibration?.previewEyeHeightM ?? 1.5;
    const anchorX=layoutConfig.anchor === 'calibrated-xz' ? pivot.x : 0,anchorZ=layoutConfig.anchor === 'calibrated-xz' ? pivot.z : 0;
    const sphere=scene.querySelector('#red-sphere-fore-aft-pattern'),compact=scene.querySelector('#compact-grid-room-pattern'),floorOnly=scene.querySelector('#grid-floor-only-pattern');
    sphere.object3D.visible=isSphere;compact.object3D.visible=isCompact;floorOnly.object3D.visible=isFloorOnly;
    sphere.object3D.position.set(anchorX,0,anchorZ);scene.querySelector('#red-sphere').setAttribute('position',{x:0,y:eyeY,z:-1.5});
    const bodyHeightM=(calibration?.heightCm||160)/100,roomHeightM=bodyHeightM*1.7,halfHeight=roomHeightM/2;
    compact.object3D.position.set(anchorX,eyeY,anchorZ);
    for(const selector of ['.compact-front','.compact-back','.compact-left','.compact-right'])scene.querySelector(selector).setAttribute('height',roomHeightM);
    scene.querySelector('.compact-floor').setAttribute('position',{x:0,y:-halfHeight,z:0});scene.querySelector('.compact-ceiling').setAttribute('position',{x:0,y:halfHeight,z:0});
    floorOnly.object3D.position.set(anchorX,eyeY-halfHeight,anchorZ);
    gridRoom.object3D.position.set(layoutConfig.anchor === 'calibrated-xz' ? pivot.x : 0,0,layoutConfig.anchor === 'calibrated-xz' ? pivot.z : 0);
    noiseRoom.object3D.position.set(layoutConfig.anchor === 'calibrated-xz' ? pivot.x : 0,0,layoutConfig.anchor === 'calibrated-xz' ? pivot.z : 0);
    fixation.object3D.visible=isGridRoom && fixationVisible;
    noiseFixation.object3D.visible=isNoiseRoom && fixationVisible;
    fixation.object3D.position.set(0,calibration?.measuredEyeHeightM || calibration?.previewEyeHeightM || 1.5,-3.98);
    noiseFixation.object3D.position.set(0,calibration?.measuredEyeHeightM || calibration?.previewEyeHeightM || 1.5,-3.98);
    scene.querySelector('#room-pattern').object3D.visible = pattern === 'room';
    scene.querySelector('#contrast-surround').object3D.visible = !['room','grid-room','noise-room','compact-grid-room','grid-floor-only'].includes(pattern);
    const el = scene.querySelector('#contrast-pattern');
    el.object3D.visible = !['room','grid-room','noise-room','red-sphere-fore-aft','compact-grid-room','grid-floor-only'].includes(pattern);
    if (!['calibrated-xz','world'].includes(layoutConfig.anchor)) throw Error('layoutConfig.anchorが不正です');
    el.object3D.position.set(layoutConfig.anchor === 'calibrated-xz' ? pivot.x : 0, 0, layoutConfig.anchor === 'calibrated-xz' ? pivot.z : 0);
    if (['room','grid-room','noise-room','red-sphere-fore-aft','compact-grid-room','grid-floor-only'].includes(pattern) || el.dataset.pattern === pattern) return;
    el.dataset.pattern = pattern;
    const old = el.getObject3D('mesh');
    if(old) { old.geometry.dispose(); old.material.dispose(); }
    const plane = definition.kind !== 'legacy';
    if (!patternTextures.has(pattern)) {
      const canvas=document.createElement('canvas');
      canvas.width=plane ? definition.width : 1024;
      canvas.height=plane ? definition.height : 2048;
      const ctx=canvas.getContext('2d');
      let statistics;
      if (plane) {
        const result=StimulusPatterns.generate(pattern);
        const image=ctx.createImageData(canvas.width,canvas.height); image.data.set(result.rgba); ctx.putImageData(image,0,0);
        statistics=result.statistics;
      } else Stimulus.drawGrid(ctx, canvas.width, canvas.height);
      const texture=new THREE.CanvasTexture(canvas);
      if (plane) texture.colorSpace=THREE.SRGBColorSpace;
      texture.anisotropy=Math.min(8,scene.renderer?.capabilities.getMaxAnisotropy() || 1);
      patternTextures.set(pattern,{texture,metadata:StimulusPatterns.metadata(pattern,statistics)});
    }
    const surface=plane ? layoutConfig.plane : layoutConfig.cylinder;
    if (!(plane ? [surface.widthM,surface.heightM] : [surface.radiusM,surface.heightM]).every(n=>Number.isFinite(n)&&n>0) ||
      ![...Object.values(surface.positionM),...Object.values(surface.rotationDeg)].every(Number.isFinite)) throw Error('表示面の配置設定が不正です');
    const geometry=plane ? new THREE.PlaneGeometry(surface.widthM,surface.heightM) : new THREE.CylinderGeometry(surface.radiusM,surface.radiusM,surface.heightM,surface.radialSegments,1,true,THREE.MathUtils.degToRad(surface.thetaStartDeg),THREE.MathUtils.degToRad(surface.thetaLengthDeg));
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:patternTextures.get(pattern).texture,side:THREE.DoubleSide,...(plane ? {toneMapped:false} : {})}));
    mesh.position.set(surface.positionM.x,surface.positionM.y,surface.positionM.z);
    mesh.rotation.set(THREE.MathUtils.degToRad(surface.rotationDeg.x),THREE.MathUtils.degToRad(surface.rotationDeg.y),THREE.MathUtils.degToRad(surface.rotationDeg.z));
    el.setObject3D('mesh',mesh);
  }
  function rotate(degrees) {
    const room = scene.querySelector('#visual-world');
    if (!room?.object3D) return;
    // 将来の回転適用を変更する入口。配置の初期姿勢とは別に親全体を動かす。
    const angle=THREE.MathUtils.degToRad(degrees);
    const requestedAmplitude=active?.cmd?.amplitudeDeg||1,unitWave=Math.max(-1,Math.min(1,degrees/requestedAmplitude));
    if(selectedPattern==='red-sphere-fore-aft'){
      room.object3D.setRotationFromAxisAngle(motionAxis,0);room.object3D.position.set(0,0,-.5*unitWave);return -.5*unitWave;
    }
    if(['compact-grid-room','grid-floor-only'].includes(selectedPattern)){
      const eyeY=calibration?.measuredEyeHeightM ?? calibration?.previewEyeHeightM ?? 1.5;
      const center=new THREE.Vector3(pivot.x,eyeY,pivot.z);
      room.object3D.setRotationFromAxisAngle(motionAxis,angle);
      const rotated=center.clone().applyAxisAngle(motionAxis,angle);
      room.object3D.position.copy(center).sub(rotated);room.object3D.position.z-=.1*unitWave;
      return -.1*unitWave;
    }
    if(rotationCenter==='translation') {
      room.object3D.setRotationFromAxisAngle(motionAxis,0);
      if(angle===0){room.object3D.position.set(0,0,0);return 0;}
      const eyeHeight=calibration?.measuredEyeHeightM ?? calibration?.previewEyeHeightM;
      const H=eyeHeight-pivot.y;
      if(!Number.isFinite(H)||H<=0)throw Error('並進換算に必要な眼―足関節間の高さが不正です');
      room.object3D.position.set(0,0,-H*angle);
      return -H*angle;
    }
    const center=rotationPivot();
    room.object3D.setRotationFromAxisAngle(motionAxis,angle);
    const rotated=center.clone().applyAxisAngle(motionAxis,angle);
    room.object3D.position.copy(center).sub(rotated);
    return 0;
  }
  function cancelPending() {
    generation++;
    pending?.abort(); pending = null;
  }
  function finish(reason = 'completed') {
    cancelPending();
    const trial = active;
    active = null; rotate(0);resetKiemel();
    if (!trial) return;
    show('停止・終了 (' + reason + ') / 刺激は静止表示');
    ack('idle', { lastRunId: trial.cmd.runId, reason });
    if (preview || !root || !user) return;
    const c = trial.cmd;
    const payload = { ...c, reason, standbyStartedAtQuestWallClockMs: trial.preludeWallMs,
      standbyDurationMs: trial.preludeMs, startedAtQuestWallClockMs: trial.startedWallMs,
      endedAtQuestWallClockMs: Date.now(), anklePivotM: trial.pivot, calibration: trial.calibration, patternSettings: trial.patternSettings, layoutSettings:trial.layoutSettings, motionSettings:trial.motionSettings, timeOriginMs: performance.timeOrigin, serverOffsetMs: serverOffset, sampleColumns: ['elapsed_ms','applied_deg','commanded_deg','performance_ms','epoch_estimate_ms','translation_z_m'],
      samples: trial.samples,
      note: 'Software transforms, not measured photon output. Quest wall-clock timestamps are not synchronized with external sensors.' };
    if(trial.kiemel) {
      payload.kiemel=trial.kiemel;payload.kiemelCalibration=trial.kiemelCalibration;
      payload.sampleColumns=['elapsed_ms','applied_deg','commanded_deg','performance_ms','epoch_estimate_ms','translation_z_m','commanded_translation_z_m','ankle_reference_deg','eye_linear_z_m','eye_exact_z_m','phase'];
      payload.timingSummary={frameCount:trial.samples.length,meanHz:trial.samples.length>1?(trial.samples.length-1)*1000/(trial.samples.at(-1)[3]-trial.samples[0][3]):null,maxIntervalMs:trial.maxIntervalMs||0,nominalXRHz:trial.nominalXRHz||null,paperDisplayHz:60};
    }
    // Saving a completed log must not block STOP or a new command.
    root.child('logs/' + user.uid + '/' + c.runId).set(payload).catch(error => {
      console.error(error); ack('log-error', { commandSeq: c.seq, lastRunId: c.runId, error: error.message });
    });
  }
  function syncXR() {
    const current = immersive();
    const session = current ? scene.renderer.xr.getSession() : null;
    if (session && session !== observedSession) {
      observedSession = session;
      session.addEventListener('visibilitychange', () => {
        if (session.visibilityState !== 'visible') { finish('xr-not-visible'); ack(ready() ? 'ready' : 'connected'); }
      });
      session.addEventListener('end', () => { calibrated = preview; finish('vr-exited'); syncXR(); });
    }
    if (current !== wasImmersive) {
      wasImmersive = current;
      calibrated = preview;
      if (!current) finish('vr-exited');
      document.querySelector('#info').style.display = preview || current ? 'none' : 'block';
      show(current ? 'VR開始済み。PCで立ち位置を合わせてください' : 'VR未開始。右下の標準VRボタンで開始してください');
      ack(current && rendered() ? 'ready' : 'connected');
    }
  }
  const parseCsv = Stimulus.parseCsv;
  function block(error) { show(error); ack('blocked', { error }); }
  async function command(c) {
    if (!c || !Number.isSafeInteger(c.seq)) return;
    // STOP is always safe, including when a stale PC has not received this instance's status yet.
    if (!preview && c.questInstanceId !== instanceId) {
      if (c.type === 'stop' || c.type === 'emergency') { finish('stopped'); rotate(0); ack('idle', { commandSeq: c.seq, reason: 'stopped' }); }
      return;
    }
    if (c.seq <= lastSeq) return;
    lastSeq = c.seq; commandSeq = c.seq;
    if (c.type === 'return') {
      cancelPending();
      if (active && active.startedPerf !== null) { active.returning ||= { at: performance.now(), angle: active.actualAngle || 0,ankleReferenceDeg:active.lastPose?.ankleReferenceDeg||0 }; ack('returning'); }
      else { finish('stopped'); ack('idle'); }
      return;
    }
    if (c.type === 'stop' || c.type === 'emergency') {
      finish('stopped'); rotate(0); ack('idle', { reason: 'stopped' }); return;
    }
    if (!preview && (!Number.isFinite(c.requestedAt) ||
      Math.abs(Date.now() + serverOffset - c.requestedAt) > 15000)) {
      block('古いコマンドです。PCから再送してください'); return;
    }
    syncXR();
    if (c.type === 'configure') {
      if (!rendered()) { block('3D描画の初期化が未完了です'); return; }
      if (active || pending) { block('映像変更はSTOP後に行ってください'); return; }
      if (!StimulusPatterns.get(c.pattern)) { block('映像パターン不正'); return; }
      if(c.pattern==='kiemel-triangles') {try{kiemelConfig=candidateKiemel(c);}catch(e){block(e.message);return;}}
      else {fixationVisible=c.fixationVisible !== false;if(['ankle','hip','translation'].includes(c.rotationCenter))rotationCenter=c.rotationCenter;}
      selectPattern(c.pattern); ack(ready() ? 'ready' : 'connected', { configured: true }); return;
    }
    if (!ready()) { block(rendered() ? 'enter VR before START（immersive-vr未開始）' : '3D描画の初期化が未完了です'); return; }
    if (c.type === 'calibrate') {
      if (active || pending) { block('STOPしてから位置合わせしてください'); return; }
      if(c.protocol==='kiemel') {
        let cfg;try{cfg=candidateKiemel(c,true);}catch(e){block(e.message);return;}
        const head=new THREE.Vector3();let eyeReference='PC preview only';
        if(preview) {head.set(0,cfg.body.eyeHeight,0);scene.querySelector('a-camera').setAttribute('position',{x:0,y:head.y,z:0});}
        else eyeReference=trackedEyeCenter(head);
        kiemelConfig=cfg;kiemelOrigin.copy(head);originInitialized=true;
        const dimensions=KiemelMotion.bodyDimensions(cfg.body);
        calibration={measuredEyeHeightM:preview?null:head.y,manualAnkleHeightM:cfg.body.ankleHeight,calibratedAtMs:Date.now(),kiemel:{body:KiemelConfig.clone(cfg.body),origin:head.toArray(),eyeReference,...dimensions,inputEyeMinusTrackedEyeM:preview?null:cfg.body.eyeHeight-head.y}};
        calibrated=true;rotate(0);selectPattern('kiemel-triangles');
        show('Kiemel位置合わせ完了。眼基準原点を固定しました');ack('ready',{calibration});return;
      }
      if (!Number.isFinite(c.heightCm) || c.heightCm < 100 || c.heightCm > 220) { block('身長が範囲外です'); return; }
      if (!Number.isFinite(c.ankleHeightM) || c.ankleHeightM < 0 || c.ankleHeightM > 0.2) { block('足首の高さが不正です'); return; }
      if (!Number.isFinite(c.hipHeightM) || c.hipHeightM < 0.4 || c.hipHeightM > 1.4 || c.hipHeightM <= c.ankleHeightM) { block('股関節の高さが不正です'); return; }
      if (!['ankle','hip','translation'].includes(c.rotationCenter)) { block('運動条件が不正です'); return; }
      if (c.pattern && !StimulusPatterns.get(c.pattern)) { block('映像パターン不正'); return; }
      const head = new THREE.Vector3();
      if (preview) {
        scene.querySelector('a-camera').setAttribute('position', { x: 0, y: c.eyeHeightM || 1.5, z: 0 });
      } else {
        scene.renderer.xr.getCamera(scene.camera).getWorldPosition(head);
      }
      pivot.set(head.x, c.ankleHeightM, head.z);
      fixationVisible=c.fixationVisible !== false;rotationCenter=c.rotationCenter;
      calibration = { heightCm: c.heightCm || null, measuredEyeHeightM: preview ? null : head.y, previewEyeHeightM: preview ? (c.eyeHeightM || 1.5) : null, estimatedAnkleHeightM: (c.heightCm || 160)/100*.039, manualAnkleHeightM: c.ankleHeightM, manualHipHeightM:c.hipHeightM, rotationCenter, referenceSpace: 'local-floor requested; verify floor on device', calibratedAtMs: Date.now() };
      calibrated = true; rotate(0); show('位置合わせ完了（足首の前後・左右は頭の真下で近似）');
      selectPattern(c.pattern || 'room');
      ack('ready', { anklePivotM: pivot.toArray(), calibration }); return;
    }
    if (c.type !== 'start') return;
    if (!calibrated) { block('PCで立ち位置合わせが必要です'); return; }
    if(c.protocol==='kiemel') {
      if(active||pending){block('STOP後に次の条件を開始してください');return;}
      let cfg;try{cfg=candidateKiemel(c,true);}catch(e){block(e.message);return;}
      if(!['kiemel','baseline'].includes(c.mode)||!/^[A-Za-z0-9_-]{1,100}$/.test(c.runId||'')){block('Kiemel開始指令が不正です');return;}
      if(!calibration?.kiemel||['ankleHeight','hipHeight','eyeHeight'].some(key=>calibration.kiemel.body[key]!==cfg.body[key])){block('身体寸法を入力しKiemelの位置合わせをしてください');return;}
      kiemelConfig=cfg;selectPattern('kiemel-triangles');
      const now=performance.now();active={cmd:{...c,pattern:'kiemel-triangles'},kiemel:cfg,kiemelCalibration:KiemelConfig.clone(calibration.kiemel),samples:[],pivot:pivot.toArray(),calibration,patternSettings:patternSettings(),layoutSettings:layoutSettings(),motionSettings:motionSettings(),startedPerf:now,startedWallMs:Date.now(),actualAngle:0,lastPhase:'pre-static',nominalXRHz:scene.renderer.xr.getSession()?.frameRate||null};
      resetKiemel();ack('pre-static',{runId:c.runId});return;
    }
    if(c.mode==='kiemel'||c.pattern==='kiemel-triangles'){block('Kiemelのプロトコル指令が必要です');return;}
    if (!['baseline', 'sine', 'multi3', 'multi10', 'csv'].includes(c.mode) || !Number.isFinite(c.durationSec) || c.durationSec < 5 || c.durationSec > 600 ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(c.runId || '') ||
      (c.mode === 'sine' && (!Number.isFinite(c.frequencyHz) || c.frequencyHz <= 0 || c.frequencyHz > 2 ||
        !Number.isFinite(c.amplitudeDeg) || c.amplitudeDeg < 0 || c.amplitudeDeg > 4)) ||
      (['multi3','multi10'].includes(c.mode) && (!Number.isFinite(c.amplitudePpDeg) || c.amplitudePpDeg < .1 || c.amplitudePpDeg > 8)) ||
      !['ankle','hip','translation'].includes(c.rotationCenter)) {
      block('刺激設定が不正です'); return;
    }
    if (active || pending) { block('STOP後に次の条件を開始してください'); return; }
    if (c.mode === 'sine' && 2*Math.PI*c.frequencyHz*c.amplitudeDeg > Stimulus.limits.velocity) { block('角速度上限30°/sを超えます'); return; }
    if (c.pattern && !StimulusPatterns.get(c.pattern)) { block('映像パターン不正'); return; }
    finish('replaced');
    fixationVisible=c.fixationVisible !== false;rotationCenter=c.rotationCenter;
    selectPattern(c.pattern || 'room');
    const token = generation;
    const trial = { cmd: { ...c, pattern:selectedPattern }, patternSettings:patternSettings(), layoutSettings:layoutSettings(), motionSettings:motionSettings(), samples: [], pivot: pivot.toArray(), points: null, calibration,
      startedPerf: null, startedWallMs: null, preludePerf: null, preludeWallMs: null, preludeMs: c.mode === 'multi3' ? 30000 : 3000 };
    if (preview) {
      scene.querySelector('a-camera').setAttribute('position', { x: 0, y: c.eyeHeightM || 1.5, z: 0 });
      pivot.set(0, c.ankleHeightM || 0, 0); trial.pivot = pivot.toArray();
    }
    if (c.mode === 'csv') {
      if (!/^[A-Za-z0-9_.-]+\.csv$/.test(c.csvFile || '') || c.csvFile.includes('..')) { block('CSVファイル名が不正です'); return; }
      if (c.csvPoints) { try { trial.points = parseCsv(c.csvPoints.map(p=>p.join(',')).join('\n')); } catch(e) { block(e.message); return; } }
      else {
      pending = new AbortController(); ack('loading', { runId: c.runId });
      try {
        const response = await fetch('./' + c.csvFile, { cache: 'no-store', signal: pending.signal });
        if (!response.ok) throw Error('HTTP ' + response.status);
        trial.points = parseCsv(await response.text());
      } catch (error) {
        if (token === generation) { pending = null; block('CSV読込エラー: ' + error.message); }
        return;
      }
    }
    }
    if (token !== generation || !ready() || (!preview && !connected)) return;
    pending = null; trial.preludePerf = performance.now(); trial.preludeWallMs = Date.now(); active = trial; rotate(0);
    show(`開始待機（${trial.preludeMs / 1000}秒・静止表示）: ${c.mode}`); ack('countdown', { commandSeq: c.seq, runId: c.runId, standbyStartedAtQuestWallClockMs: trial.preludeWallMs, standbyDurationMs: trial.preludeMs });
  }
  AFRAME.registerComponent('stimulus-driver', {
    tick() {
      syncXR();
      if (!active) return;
      if (!ready()) { finish('not-ready'); return; }
      const now = performance.now();
      if(active.kiemel){tickKiemel(now);return;}
      if (active.startedPerf === null) {
        if (now - active.preludePerf < active.preludeMs) return;
        active.startedPerf = now; active.startedWallMs = Date.now();
        show('再生中: ' + active.cmd.mode); ack('running', { commandSeq: active.cmd.seq, runId: active.cmd.runId, startedAtQuestWallClockMs: active.startedWallMs });
      }
      if (active.returning) {
        const u=Math.min(1,(now-active.returning.at)/2000);
        const deg=active.returning.angle*(1-u*u*(3-2*u)),translationZ=rotate(deg);
        active.samples.push([(now-active.startedPerf),deg,0,now,performance.timeOrigin+now,translationZ]);
        if(u===1) finish('stopped'); return;
      }
      const t = (now - active.startedPerf) / 1000, c = active.cmd;
      if (t >= c.durationSec) { finish(); return; }
      const commanded = Stimulus.angle(c, t, active.points);
      const dt = Math.max(0, Math.min((now - (active.lastFrame ?? now)) / 1000, .1));
      const previous = active.actualAngle || 0;
      const target = commanded * Math.min(1, t / 1.5, Math.max(0, (c.durationSec - t) / 1.5));
      const degrees = previous + Math.max(-30 * dt, Math.min(30 * dt, target - previous));
      active.lastFrame = now; active.actualAngle = degrees;
      const translationZ=rotate(degrees); active.samples.push([Math.round(t * 1000), Math.round(degrees * 100000) / 100000, commanded, now,performance.timeOrigin + now,translationZ]);
    }
  });
  if (preview) {
    document.querySelector('#info').style.display = 'none';
    scene.setAttribute('xr-mode-ui', 'enabled: false');
    scene.setAttribute('embedded', '');
    scene.style.width='100vw'; scene.style.height='100vh';
    window.addEventListener('message', event => {
      if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'stimulus-command') return;
      void command(event.data.command).catch(error => reportStartupError(error.message));
    });
  }
  scene.addEventListener('enter-vr', syncXR);
  scene.addEventListener('exit-vr', () => { calibrated = preview; finish('vr-exited'); syncXR(); });
  scene.addEventListener('loaded', () => { show('Kiemel読込完了。右下の標準VRボタンで開始してください'); updateDiagnostics(); });
  scene.addEventListener('renderstart', () => {
    clearTimeout(startupTimer); document.querySelector('#startup-error').hidden = true;
    selectPattern(StimulusPatterns.defaultPattern);
    scene.renderer.xr.addEventListener('sessionstart', syncXR);
    scene.renderer.xr.addEventListener('sessionend', () => { calibrated = preview; finish('vr-exited'); syncXR(); });
    scene.canvas.addEventListener('webglcontextlost', () => {
      graphicsLost = true; calibrated = preview; finish('graphics-lost');
      reportStartupError('3D描画が停止しました。再読み込みしてください。'); ack('blocked', { error: window.vrLastError });
    });
    ack(ready() ? 'ready' : 'connected');
    if (preview) parent.postMessage({ type: 'stimulus-preview-ready' }, location.origin);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !preview) { finish('page-hidden'); ack(ready() ? 'ready' : 'connected'); }
  });
  window.addEventListener('pagehide', () => { finish('page-hidden'); });
  const startupTimer = setTimeout(() => {
    if (!rendered()) { reportStartupError('3D空間の初期化が未完了です。' + window.vrLastError); ack('blocked', { error: window.vrLastError }); }
  }, 12000);
  scene.addEventListener('loaded',()=>{
    const beforeSceneRender=scene.object3D.onBeforeRender;
    scene.object3D.onBeforeRender=function(renderer,...args){
      beforeSceneRender?.call(this,renderer,...args);
      if(selectedPattern==='kiemel-triangles')KiemelProjection.renderPending(renderer,scene.querySelector('#kiemel-environment').getObject3D('mesh'));
    };
  });
  document.body.appendChild(scene);
  if (!isSecureContext || !navigator.xr) xrSupport = '非対応（HTTPS・Quest Browserを確認）';
  else navigator.xr.isSessionSupported('immersive-vr').then(supported => {
    xrSupport = supported ? '対応' : '非対応'; updateDiagnostics(); ack(ready() ? 'ready' : 'connected');
  }).catch(error => { xrSupport = error.message; updateDiagnostics(); });
  // Poll state even when XR events or a paused render loop arrive in another order.
  setInterval(() => { syncXR(); updateDiagnostics(); }, 250);
  setInterval(() => ack(active ? (active.returning ? 'returning' : active.kiemel ? active.lastPose?.phase==='stimulus'?'running':active.lastPose?.phase||'pre-static' : active.startedPerf === null ? 'countdown' : 'running') : pending ? 'loading' : ready() ? 'ready' : 'connected',
    active ? { commandSeq: active.cmd.seq, runId: active.cmd.runId } : {}), 5000);
  async function loadScript(src) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = src;
      script.onload = resolve; script.onerror = () => reject(Error('読込失敗: ' + src)); document.head.appendChild(script);
    });
  }
  async function connect() {
    if (preview) return; // Preview never initializes Firebase or changes the shared auth/session/logs.
    await loadScript('firebase-config1.js');
    for (const name of ['app', 'auth', 'database']) await loadScript(`https://www.gstatic.com/firebasejs/10.12.2/firebase-${name}-compat.js`);
    const config = window.VR_REMOTE_CONFIG;
    const app = firebase.initializeApp(config.firebase, 'quest-' + instanceId);
    // Keep anonymous Quest auth in memory, isolated from the operator's persisted login.
    const auth = app.auth(); await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
    user = (await auth.signInAnonymously()).user;
    const db = app.database(); root = db.ref('sessions/' + config.sessionId);
    db.ref('.info/serverTimeOffset').on('value', snap => { serverOffset = snap.val() || 0; });
    db.ref('.info/connected').on('value', snap => {
      connected = snap.val() === true;
      firebaseState = connected ? '接続済み' : '未接続';
      if (!connected) { calibrated = preview; finish('connection-lost'); }
      else {
        // A new recipient ID rejects commands queued while offline, without relying
        // on ordering between the connection event and the first command snapshot.
        if (hadConnection) { instanceId = crypto.randomUUID(); lastSeq = 0; }
        hadConnection = true;
        ack(ready() ? 'ready' : 'connected');
      }
      updateDiagnostics();
    });
    root.child('command').on('value', snap => {
      const c = snap.val();
      if (!connected) return;
      void command(c).catch(error => { console.error(error); block(error.message); });
    }, error => { firebaseState = '購読失敗'; finish('subscription-failed'); block(error.message); });
  }
  function startFirebase() {
    void connect().catch(error => { firebaseState = '接続エラー: ' + error.message; updateDiagnostics(); show('Firebase ' + firebaseState + '。標準VRボタンは使用できます。'); });
  }
  // A-Frame 1.7 waits for readyState=complete before initializing custom elements.
  // Dynamic SDK scripts inserted earlier hold that state open and stall the scene.
  if (document.readyState === 'complete') startFirebase();
  else window.addEventListener('load', startFirebase, { once: true });
})();


