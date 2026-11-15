(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const tell = text => { $('log').textContent = text; };
  let operatorKiemel=KiemelConfig.clone(KiemelConfig.CONFIG);
  let legacyMode='sine';
  function populateKiemel() {
    const m=operatorKiemel.motion;
    $('kiemelCondition').value=m.type;$('kiemelScale').value=m.amplitudeScale;
    $('kiemelPre').value=m.preSeconds;$('kiemelDuration').value=m.duration;$('kiemelPost').value=m.postSeconds;
    $('kiemelFixation').checked=operatorKiemel.pattern.fixationPoint;
  }
  function readKiemel(requireBody=false) {
    const cfg=KiemelConfig.clone(operatorKiemel),m=cfg.motion;
    m.type=$('kiemelCondition').value;m.amplitudeScale=Number($('kiemelScale').value);
    m.preSeconds=Number($('kiemelPre').value);m.duration=Number($('kiemelDuration').value);m.postSeconds=Number($('kiemelPost').value);
    cfg.pattern.fixationPoint=!!$('kiemelFixation').checked;
    for(const [name,id] of [['eyeHeight','kiemelEye'],['hipHeight','kiemelHip'],['ankleHeight','kiemelAnkle']])cfg.body[name]=String($(id).value).trim()===''?null:Number($(id).value)/100;
    return KiemelMotion.validate(cfg,requireBody);
  }
  populateKiemel();
  function updateModeLabel() {
    const isK=$('mode').value==='kiemel';$('kiemelControls').hidden=!isK;$('legacyControls').hidden=isK;$('legacyBody').hidden=isK;$('estimateAnkle').hidden=isK;
    $('start').textContent=isK?'START（静止→刺激→静止）':$('mode').value==='multi3'?'START（30秒静止後に開始）':'START（3秒後開始）';
  }
  const patternSelect=$('pattern');
  const visiblePatterns=new Set(['grid-room','noise-room']);
  for (const [id,definition] of Object.entries(StimulusPatterns.definitions)) {
    if(!visiblePatterns.has(id))continue;
    const option=document.createElement('option');option.value=id;option.textContent=definition.label;
    patternSelect.appendChild(option);
  }
  patternSelect.value=StimulusPatterns.defaultPattern;
  function describePattern() {
    const definition=StimulusPatterns.get(patternSelect.value), plane=layoutConfig.plane;
    if(definition.kind==='kiemel') {$('patternDescription').textContent='Kiemel：正面1.07 m、左右各1.52 m。黒背景に各壁500個の白三角形。高さ・奥行きは仮設定。設定元: kiemel-config.js';return;}
    $('patternDescription').textContent=definition.kind === 'legacy' ?
      (patternSelect.value === 'grid-room' ? '8×4×8 mのグレーのグリッド室内全体を、選択した関節軸まわりに回転します。' : patternSelect.value === 'noise-room' ? '同じ8×4×8 m室内の6面すべてに、固定seedの1/f型空間ノイズを表示します。' : patternSelect.value === 'room' ? '既存の部屋：quest.htmlの #room-pattern。' : '既存の半円筒：layout-config.jsのcylinder。') :
      `表示面：幅${plane.widthM} m×高さ${plane.heightM} m、中心(${plane.positionM.x}, ${plane.positionM.y}, ${plane.positionM.z}) m。` +
      `画像：${definition.width}×${definition.height} px、brightness=${definition.brightness}、contrast=${definition.contrast}。` +
      (definition.kind === 'noise' ? `振幅指数${definition.spectralSlope}、seed=${definition.seed}。` : `縞の向き${definition.orientation}°、明暗${definition.stripeCount}組。`) +
      '画像設定: pattern-config.js / 配置: layout-config.js / 回転: motion-config.js';
  }
  updateModeLabel();describePattern();
  const config = window.VR_REMOTE_CONFIG;
  if (!window.firebase || !config?.firebase) { $('authState').textContent = 'Firebaseの読み込みに失敗しました。再読み込みしてください。'; return; }
  firebase.initializeApp(config.firebase);
  const auth = firebase.auth(), db = firebase.database(), root = db.ref('sessions/' + config.sessionId);
  let quest = null, lastSeq = 0, awaiting = null, subscribed = false, serverOffset = 0;
  let syncSamples = [], bestSync = null, pcCommandLogs = [];
  function identificationSettings() { return ExperimentStimulus.validate({
    band:$('idBand').value, amplitudeMode:$('idAmplitudeMode').value, amplitudePreset:$('idAmplitudePreset').value,
    phaseSeed:Number($('idSeed').value), rampSec:Number($('idRamp').value),
    sweepSegments:$('idSegments').value.split(',').map(Number)
  }); }
  let previewReady = false;
  db.ref('.info/connected').on('value', snap => { $('pcConnection').textContent = snap.val() ? 'PC Firebase: 接続済み' : 'PC Firebase: 切断'; });
  $('retry').onclick = () => location.reload();
  $('estimateAnkle').onclick = () => { const h=Number($('heightCm').value);$('ankleCm').value=(h*.039).toFixed(1);$('hipCm').value=(h*.53).toFixed(1); };
  function drawWave() {
    try {
      if($('mode').value==='kiemel') {
        const cfg=readKiemel(true),ctx=$('waveform').getContext('2d'),total=cfg.motion.preSeconds+cfg.motion.duration+cfg.motion.postSeconds;
        ctx.clearRect(0,0,640,160);ctx.beginPath();
        for(let i=0;i<=640;i++){const y=80-KiemelMotion.at(i/640*total,cfg).eyeLinearZ*1000;if(i)ctx.lineTo(i,y);else ctx.moveTo(i,y);}
        ctx.strokeStyle='#165e91';ctx.stroke();$('waveError').textContent='Kiemel：眼位置相当変位（縦軸±8 cm、横軸'+total+'秒）。共通波形から3条件を換算。追加ランプ・速度制限なし。';return;
      }
      if(['id-multicosine','id-sweep'].includes($('mode').value)) { const cfg=identificationSettings(),tr=ExperimentStimulus.build(cfg,$('mode').value==='id-sweep'?'sweep':'multicosine',.005),ctx=$('waveform').getContext('2d');ctx.clearRect(0,0,640,160);ctx.beginPath();for(let i=0;i<=640;i++){const s=ExperimentStimulus.stateAt(tr,i/640*80),y=80-s.positionDeg*45;i?ctx.lineTo(i,y):ctx.moveTo(i,y);}ctx.strokeStyle='#165e91';ctx.stroke();$('waveError').textContent=`固定80秒 / ${cfg.amplitudePreset==='low'?'1':'2'}° pp / peak: 変位${tr.peaks.positionDeg.toFixed(3)}°・速度${tr.peaks.velocityDegS.toFixed(3)}°/s・加速度${tr.peaks.accelerationDegS2.toFixed(3)}°/s² / scale=${tr.scale.toFixed(4)}`;return; }
      const pp=Number($('amp').value),c={mode:$('mode').value,amplitudeDeg:pp/2,amplitudePpDeg:pp,frequencyHz:Number($('freq').value)};
      const ctx=$('waveform').getContext('2d'); ctx.clearRect(0,0,640,160);ctx.beginPath();
      const duration=Number($('duration').value);
      for(let i=0;i<=640;i++){const a=Stimulus.angle(c,i/640*duration); const y=80-a*3; if(i)ctx.lineTo(i,y);else ctx.moveTo(i,y);}
      ctx.strokeStyle='#165e91';ctx.stroke();
      const description=$('mode').value==='multi10'?'速度平滑10周波数: '+Stimulus.multi10Frequencies.map(f=>f.toFixed(3)).join(', ')+` Hz（振幅∝f^-${Stimulus.multi10AmplitudeExponent}）。`:$('mode').value==='multi3'?'3周波数合成: 0.03, 0.1, 0.5 Hz（同振幅・同位相、合成波全体を指定振幅へ正規化）。':'単一sin。';
      $('waveError').textContent=description+'指定 '+pp+'° peak-to-peak。適用時は開始終了ランプ・速度制限あり';
    } catch(e){$('waveError').textContent=e.message;}
  }
  $('control').addEventListener('input',drawWave); drawWave();
  db.ref('.info/serverTimeOffset').on('value', snap => { serverOffset = snap.val() || 0; });
  async function clockSync() {
    if(!freshQuest()) { tell('Quest接続を確認してから時計同期してください'); return; }
    $('clockSync').disabled=true;syncSamples=[];
    try { for(let i=0;i<8;i++){const id=crypto.randomUUID(),ref=root.child('clockSync/requests/'+id),responseRef=root.child('clockSync/responses/'+id),t0Epoch=Date.now(),t0Mono=performance.now();const responsePromise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{responseRef.off('value',handler);reject(Error('同期応答timeout'));},4000),handler=snap=>{const value=snap.val();if(!value)return;clearTimeout(timer);responseRef.off('value',handler);resolve(value);};responseRef.on('value',handler);});await ref.set({id,t0EpochMs:t0Epoch,t0MonotonicMs:t0Mono,questInstanceId:quest.instanceId});const response=await responsePromise;const t3Epoch=Date.now(),t3Mono=performance.now(),rtt=(t3Mono-t0Mono)-(response.t2MonotonicMs-response.t1MonotonicMs),offset=((response.t1EpochMs-t0Epoch)+(response.t2EpochMs-t3Epoch))/2;syncSamples.push({id,questInstanceId:response.questInstanceId,t0EpochMs:t0Epoch,t0MonotonicMs:t0Mono,t1QuestEpochMs:response.t1EpochMs,t1QuestMonotonicMs:response.t1MonotonicMs,t2QuestEpochMs:response.t2EpochMs,t2QuestMonotonicMs:response.t2MonotonicMs,t3EpochMs:t3Epoch,t3MonotonicMs:t3Mono,rttMs:rtt,questMinusPcOffsetMs:offset});await new Promise(resolve=>setTimeout(resolve,80));}bestSync=syncSamples.reduce((a,b)=>!a||b.rttMs<a.rttMs?b:a,null);await root.child('clockSync/estimate').set({...bestSync,estimatedAtPcEpochMs:Date.now(),sampleCount:syncSamples.length});await root.child('clockSync/logs/'+Date.now()).set(syncSamples);$('syncState').textContent=`offset Quest-PC ${bestSync.questMinusPcOffsetMs.toFixed(2)} ms / RTT ${bestSync.rttMs.toFixed(2)} ms（±${(bestSync.rttMs/2).toFixed(2)} ms目安）`;tell('時計同期が完了しました');}catch(e){tell('時計同期エラー: '+e.message);}finally{$('clockSync').disabled=false;}
  }
  $('clockSync').onclick=clockSync;
  const freshQuest = () => quest?.instanceId && Number.isFinite(quest.at) && Math.abs(Date.now() + serverOffset - quest.at) < 15000;
  function sendPreview(command) {
    if (previewReady) $('preview').contentWindow.postMessage({ type: 'stimulus-command', command }, location.origin);
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== $('preview').contentWindow || event.data?.type !== 'stimulus-preview-ready') return;
    previewReady = true;
    // Preview starts static; loading/reloading it never replays an experiment command.
  });
  $('signIn').onclick = async () => {
    try { await auth.signInWithEmailAndPassword($('email').value, $('password').value); $('authState').textContent = 'ログインしました'; }
    catch (error) { $('authState').textContent = 'エラー: ' + error.message; }
  };
  function receive(snap) {
    quest = snap.val();
    const v = quest;
    if(v?.calibration) { $('measuredEye').textContent='Quest目高: '+v.calibration.measuredEyeHeightM+' m / 足関節: '+v.calibration.manualAnkleHeightM+' m / 股関節: '+(v.calibration.manualHipHeightM ?? '-')+' m / 回転中心: '+(v.calibration.rotationCenter || '-')+(v.calibration.kiemel?' / l1='+v.calibration.kiemel.l1+' m / l2='+v.calibration.kiemel.l2+' m / 入力眼高との差='+v.calibration.kiemel.inputEyeMinusTrackedEyeM+' m':''); }
    $('state').textContent = v ? v.status + ' / ' + (v.runId || v.lastRunId || '-') + ' / 適用角度 ' + Number(v.appliedAngleDeg || 0).toFixed(3) + '° / 映像: ' + (StimulusPatterns.get(v.pattern)?.label || v.pattern || '不明')+(v.kiemelCondition?' / '+v.kiemelCondition+' / 前後移動='+Number(v.translationZ||0).toFixed(5)+' m':'')+(v.kiemelPhase?' / '+v.kiemelPhase+' / 経過 '+Number(v.elapsedSeconds||0).toFixed(1)+'秒 / 描画 '+(v.renderedFrames||0)+' frames':'') : 'Quest未接続';
    $('questDiagnostics').textContent = v ?
      `3D: ${v.renderStarted ? '描画中' : '未完了'} / VRボタン: ${v.vrButton ? '生成済み' : '未生成'} / WebXR: ${v.xrSupport || '不明'} / immersive-vr: ${v.immersive ? '開始済み' : '未開始'} / XR描画: ${v.xrPresenting ?? '不明'} / XRセッション: ${v.xrSessionActive ?? '不明'} / A-Frame VR: ${v.aframeVR ?? '不明'} / 位置合わせ: ${v.calibrated ? '完了' : '未完了'} / Firebase: ${v.firebaseState || '不明'} / 受信端末: ${v.client || '不明'} / 接続ID: ${v.instanceId || '-'}${v.startupError ? ' / 起動エラー: ' + v.startupError : ''}` : '';
    if (!awaiting || v?.commandSeq !== awaiting.seq) return;
    if (awaiting.type === 'configure' && v.configured) { awaiting.received = true; tell('Questの映像を切り替えました（刺激は停止中）'); return; }
    const messages = {
      loading: 'QuestがSTARTを受信：CSV読込中', countdown: 'QuestがSTARTを受信：3秒の待機中',
      running: 'Questで刺激を再生中', idle: 'Questで停止・終了しました',
      blocked: 'Questで開始・位置合わせができません：' + (v.error || '状態を確認してください'),
      'log-error': 'Questのログ保存に失敗しました：' + (v.error || ''),
      returning: 'QuestでBaselineへ復帰中',
      'pre-static':'Kiemel：最初の静止映像（初期設定5秒、その後に刺激開始）',
      'post-static':'Kiemel：最後の静止映像',
      ready: awaiting.type === 'configure' ? 'Questの映像を切り替えました' : v.calibrated ? '✓ Questの位置合わせが完了しました' : 'QuestでVR開始済み。立ち位置を合わせてください'
    };
    if (v.status === 'ready' && !['calibrate','configure'].includes(awaiting.type)) return;
    if (messages[v.status]) { awaiting.received = true; tell(messages[v.status]); }
  }
  auth.onAuthStateChanged(user => {
    const signedIn = user && !user.isAnonymous;
    $('login').style.display = signedIn ? 'none' : 'block'; $('control').style.display = signedIn ? 'block' : 'none';
    if (!signedIn) {
      if (subscribed) root.child('status').off('value', receive);
      subscribed = false; quest = null; previewReady = false; $('preview').removeAttribute('src'); return;
    }
    if (!$('preview').getAttribute('src')) $('preview').src = 'quest.html?preview=1&v=20261022-translation2';
    if (!subscribed) { subscribed = true; root.child('status').on('value', receive, error => tell('Quest状態の購読エラー: ' + error.message)); }
  });
  setInterval(() => {
    if (quest && !freshQuest()) $('state').textContent = 'Questの状態更新が途絶えています。接続・画面を確認してください';
  }, 2000);
  async function dispatch(type) {
    const safe = ['stop','return','emergency'].includes(type);
    const button = $(type === 'configure' ? 'applyPattern' : type === 'emergency' ? 'emergency' : type === 'start' ? 'start' : type === 'calibrate' ? 'calibrate' : 'stop');
    const original = button.textContent;
    tell(type === 'start' ? '▶ STARTを押しました' : safe ? '■ 停止を送信中' : type === 'configure' ? '映像を切り替え中' : '位置合わせを押しました');
    button.disabled = true; button.textContent = '送信中…';
    let attempt;
    try {
      const isKiemel=$('mode').value==='kiemel'||$('pattern').value==='kiemel-triangles';
      const kcfg=isKiemel&&!safe?readKiemel(['start','calibrate'].includes(type)):null;
      if (type === 'configure') sendPreview({type,seq:lastSeq=Math.max(Date.now(),lastSeq+1),pattern:$('pattern').value,fixationVisible:$('fixationVisible').checked,rotationCenter:$('rotationCenter').value,...(isKiemel?{protocol:'kiemel',kiemel:kcfg}:{})});
      if (!freshQuest() && !safe) { tell('Questの接続確認待ちです。Questの画面を確認してください'); return; }
      if (!safe && quest.firebaseState !== '接続済み') { tell('QuestのFirebase接続を確認してください'); return; }
      if (!safe && !quest.renderStarted) { tell('Questの3D描画が未完了です。下の起動エラー・描画状態を確認してください'); return; }
      if (['start','calibrate'].includes(type) && !quest.immersive) {
        tell(`Questの実VRセッションを確認できません（XR描画=${quest.xrPresenting ?? '不明'}、XRセッション=${quest.xrSessionActive ?? '不明'}）。VRボタンを押しても続く場合、下の診断情報を確認してください。別のPC・Questタブが同じ接続先へ状態を送っていないかも確認してください。`); return;
      }
      if (type === 'start' && !quest.calibrated) { tell('PCで立ち位置を合わせてください'); return; }
      const mode = type === 'start' && baselineRequest ? 'baseline' : $('mode').value;
      const isIdentification=['id-multicosine','id-sweep'].includes(mode),idSettings=isIdentification&&!safe?identificationSettings():null;
      if(type==='start'&&isIdentification&&(!bestSync||bestSync.questInstanceId!==quest.instanceId)){tell('このQuest接続に対して時計同期を実行してからSTARTしてください');return;}
      const durationSec = isIdentification?80:isKiemel&&!safe?kcfg.motion.preSeconds+kcfg.motion.duration+kcfg.motion.postSeconds:Number($('duration').value), frequencyHz = Number($('freq').value), amplitudePpDeg = Number($('amp').value), amplitudeDeg=amplitudePpDeg/2;
      const heightCm = Number($('heightCm').value), eyeHeightM = Number($('eyeCm').value) / 100, ankleHeightM = Number($('ankleCm').value) / 100, hipHeightM=Number($('hipCm').value)/100, rotationCenter=$('rotationCenter').value;
      if (!isKiemel && !safe && type !== 'configure' && (!Number.isFinite(ankleHeightM) || ankleHeightM < 0 || ankleHeightM > .2 || !Number.isFinite(hipHeightM) || hipHeightM < .4 || hipHeightM > 1.4 || hipHeightM <= ankleHeightM || !['ankle','hip','translation'].includes(rotationCenter) ||
        !Number.isFinite(eyeHeightM) || eyeHeightM < .8 || eyeHeightM > 2.1 || !Number.isFinite(heightCm) || heightCm < 100 || heightCm > 220)) { tell('身長・目・足関節・股関節の高さ、または回転中心が範囲外です'); return; }
      if (!isKiemel && type === 'start' && (!Number.isFinite(durationSec) || durationSec < 5 || durationSec > 600 ||
        (mode === 'sine' && (!Number.isFinite(frequencyHz) || frequencyHz <= 0 || frequencyHz > 2)) || !Number.isFinite(amplitudePpDeg) || amplitudePpDeg < .1 || amplitudePpDeg > 8)) { tell('刺激設定が範囲外です'); return; }
      const seq = lastSeq = Math.max(Date.now(), lastSeq + 1);
      const command = { type, seq, questInstanceId: quest?.instanceId || null,
        runId: 'trial-' + crypto.randomUUID(), requestedAt: firebase.database.ServerValue.TIMESTAMP };
      if (!safe) {
        if(isKiemel)Object.assign(command,{protocol:'kiemel',mode:baselineRequest?'baseline':'kiemel',pattern:'kiemel-triangles',durationSec,kiemel:kcfg});
        else Object.assign(command, { heightCm, eyeHeightM, ankleHeightM, hipHeightM, rotationCenter, mode, frequencyHz, amplitudeDeg, amplitudePpDeg, durationSec, pattern:$('pattern').value, fixationVisible:$('fixationVisible').checked },isIdentification?{identificationSettings:idSettings,startAtPcEpochMs:Date.now()+5000,clockSync:bestSync}:{});
      }
      attempt = { seq, type, received: false }; awaiting = attempt;
      // set() queues writes offline. A reconnect may deliver this later; Quest rejects stale START/calibrate.
      await root.child('command').set(command);
      if(type==='start'&&isIdentification){const tr=ExperimentStimulus.build(idSettings,mode==='id-sweep'?'sweep':'multicosine',.005);pcCommandLogs=[];for(let i=0;i<=8000;i++){const elapsed=i/100,s=ExperimentStimulus.stateAt(tr,elapsed),epoch=command.startAtPcEpochMs+elapsed*1000;pcCommandLogs.push([command.runId,new Date(epoch).toISOString(),epoch,performance.now(),elapsed,mode,s.positionDeg,s.velocityDegS,s.accelerationDegS2,s.frequencyHz]);}await root.child('commandLogs/'+command.runId).set({trialId:command.runId,startAtPcEpochMs:command.startAtPcEpochMs,mode,settings:idSettings,createdAtPcEpochMs:Date.now()});}
      sendPreview(command);
      if (awaiting === attempt && !attempt.received) tell(`✓ ${type === 'calibrate' ? '位置合わせ' : (type === 'return' ? 'STOP' : type.toUpperCase())}送信済み・Questの受信確認待ち`);
    } catch (error) {
      tell('送信エラー: ' + error.message);
    } finally { button.disabled = false; button.textContent = original; }
  }
  $('calibrate').onclick = () => dispatch('calibrate'); $('start').onclick = () => dispatch('start'); $('stop').onclick = () => dispatch('return');
  $('emergency').onclick = () => dispatch('emergency');
  let baselineRequest = false;
  $('baseline').onclick = async () => { baselineRequest = true; try { await dispatch('start'); } finally { baselineRequest = false; } };
  $('mode').onchange = () => {
    const isK=$('mode').value==='kiemel';$('kiemelControls').hidden=!isK;$('legacyControls').hidden=isK;$('legacyBody').hidden=isK;$('estimateAnkle').hidden=isK;
    if(!isK)legacyMode=$('mode').value;
    if($('mode').value==='multi10' && Number($('duration').value)===60)$('duration').value=125;
    if($('mode').value==='multi3' && [60,125].includes(Number($('duration').value)))$('duration').value=100;
    if(isK)$('pattern').value='kiemel-triangles';else if($('pattern').value==='kiemel-triangles')$('pattern').value='grid';
    $('identificationControls').hidden=!['id-multicosine','id-sweep'].includes($('mode').value);$('duration').disabled=['id-multicosine','id-sweep'].includes($('mode').value);updateModeLabel();describePattern();drawWave();return dispatch('configure');
  };
  $('pattern').onchange = () => {
    if($('pattern').value==='kiemel-triangles'){$('mode').value='kiemel';$('kiemelControls').hidden=false;}
    else if($('mode').value==='kiemel'){$('mode').value=legacyMode;$('kiemelControls').hidden=true;}
    updateModeLabel();describePattern();drawWave();return dispatch('configure');
  };
  $('kiemelShort').onclick = () => {$('kiemelDuration').value=operatorKiemel.motion.shortDuration;drawWave();};
  $('kiemelRestore').onclick = () => {operatorKiemel=KiemelConfig.restore();populateKiemel();$('mode').value='kiemel';$('pattern').value='kiemel-triangles';updateModeLabel();describePattern();drawWave();return dispatch('configure');};
  $('applyPattern').onclick = () => dispatch('configure');
  $('fixationVisible').onchange = () => dispatch('configure');
  $('ampPreset').onchange = () => {$('amp').value=$('ampPreset').value;drawWave();};
  $('csvDownload').onclick = async () => { try {
    const logs=(await root.child('logs').get()).val()||{},entries=[];
    for(const user of Object.values(logs))for(const [id,log] of Object.entries(user))entries.push({id,log,columns:log.sampleColumns||((log.samples?.[0]?.length||0)<=2?['elapsed_ms','applied_deg']:['elapsed_ms','applied_deg','commanded_deg','performance_ms','epoch_estimate_ms'])});
    const columns=[...new Set(entries.flatMap(e=>e.columns))],rows=[['run_id','mode','pattern',...columns,'metadata_json']];
    for(const {id,log,columns:own} of entries){const {samples,...metadata}=log;for(const s of samples||[])rows.push([id,log.mode,log.pattern||'room',...columns.map(name=>{const i=own.indexOf(name);return i<0?'':s[i];}),JSON.stringify(metadata)]);}
    const text=rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n'),a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob(['\uFEFF'+text],{type:'text/csv'}));a.download='quest-logs.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }catch(e){tell(e.message);} };
  $('syncDownload').onclick=()=>{const columns=['id','t0EpochMs','t0MonotonicMs','t1QuestEpochMs','t1QuestMonotonicMs','t2QuestEpochMs','t2QuestMonotonicMs','t3EpochMs','t3MonotonicMs','rttMs','questMinusPcOffsetMs'],rows=[columns,...syncSamples.map(x=>columns.map(k=>x[k]))],a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.join(',')).join('\r\n')],{type:'text/csv'}));a.download='clock-sync.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  $('pcDownload').onclick=()=>{const rows=[['trial_id','pc_time_iso','pc_epoch_ms','pc_monotonic_ms','elapsed_time_s','stimulus_type','stimulus_position','stimulus_velocity','stimulus_acceleration','instantaneous_frequency_hz'],...pcCommandLogs],a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\r\n')],{type:'text/csv'}));a.download='pc-command-log.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  $('download').onclick = async () => {
    try {
      const logs = (await root.child('logs').get()).val() || {};
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' }));
      a.download = 'quest-stimulus-logs-' + config.sessionId + '.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000); tell('ログを取得しました。外部センサーとの時刻同期は別途必要です。');
    } catch (error) { tell('取得エラー: ' + error.message); }
  };
})();
