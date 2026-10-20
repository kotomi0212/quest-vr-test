(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const tell = text => { $('log').textContent = text; };
  const patternSelect=$('pattern');
  for (const [id,definition] of Object.entries(StimulusPatterns.definitions)) {
    const option=document.createElement('option');option.value=id;option.textContent=definition.label;
    patternSelect.appendChild(option);
  }
  patternSelect.value=StimulusPatterns.defaultPattern;
  function describePattern() {
    const definition=StimulusPatterns.get(patternSelect.value), screen=StimulusPatterns.screen;
    $('patternDescription').textContent=definition.kind === 'legacy' ?
      (patternSelect.value === 'room' ? '既存の家具のある部屋です。3種類の平面パターン比較とは画面形状が異なります。' : '既存の半円筒：半径1 m・高さ6 m・正面180°、約10 cm間隔の縦横線。') :
      `平面：正面${screen.distanceM} m・幅${screen.widthM} m×高さ${screen.heightM} m・中心高さ${screen.centerHeightM} m。` +
      (definition.kind === 'noise' ? '静止1/f振幅ノイズ（パワー1/f²）、シード固定。' : `縦縞：1周期${StimulusPatterns.stripePeriodM*100} cm・コントラスト${definition.michelsonContrast*100}%。`) +
      '足首中心の運動は全パターン共通。';
  }
  describePattern();
  const config = window.VR_REMOTE_CONFIG;
  if (!window.firebase || !config?.firebase) { $('authState').textContent = 'Firebaseの読み込みに失敗しました。再読み込みしてください。'; return; }
  firebase.initializeApp(config.firebase);
  const auth = firebase.auth(), db = firebase.database(), root = db.ref('sessions/' + config.sessionId);
  let quest = null, lastSeq = 0, awaiting = null, subscribed = false, serverOffset = 0;
  let previewReady = false;
  db.ref('.info/connected').on('value', snap => { $('pcConnection').textContent = snap.val() ? 'PC Firebase: 接続済み' : 'PC Firebase: 切断'; });
  $('retry').onclick = () => location.reload();
  $('estimateAnkle').onclick = () => { $('ankleCm').value = (Number($('heightCm').value)*.039).toFixed(2); };
  function drawWave() {
    try {
      const c={mode:$('mode').value,amplitudeDeg:Number($('amp').value),frequencyHz:Number($('freq').value),velocityDegSec:Number($('velocity').value),rampSec:Number($('ramp').value),holdSec:Number($('hold').value)};
      const ctx=$('waveform').getContext('2d'); ctx.clearRect(0,0,640,160);ctx.beginPath();
      const duration=Number($('duration').value);
      for(let i=0;i<=640;i++){const a=Stimulus.angle(c,i/640*duration); const y=80-a*3; if(i)ctx.lineTo(i,y);else ctx.moveTo(i,y);}
      ctx.strokeStyle='#165e91';ctx.stroke(); $('waveError').textContent='指令角度（時間0～'+duration+'秒、縦軸±26.7°）。適用時は開始終了ランプ・速度制限あり';
    } catch(e){$('waveError').textContent=e.message;}
  }
  $('control').addEventListener('input',drawWave); drawWave();
  db.ref('.info/serverTimeOffset').on('value', snap => { serverOffset = snap.val() || 0; });
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
    if(v?.calibration) { $('measuredEye').textContent='Quest目高: '+v.calibration.measuredEyeHeightM+' m / 足首補正: '+v.calibration.manualAnkleHeightM+' m'; }
    $('state').textContent = v ? v.status + ' / ' + (v.runId || v.lastRunId || '-') + ' / 適用角度 ' + Number(v.appliedAngleDeg || 0).toFixed(3) + '° / 映像: ' + (StimulusPatterns.get(v.pattern)?.label || v.pattern || '不明') : 'Quest未接続';
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
    if (!$('preview').getAttribute('src')) $('preview').src = 'quest.html?preview=1&v=20261020-patterns1';
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
      if (type === 'configure') sendPreview({type,seq:lastSeq=Math.max(Date.now(),lastSeq+1),pattern:$('pattern').value});
      if (!freshQuest() && !safe) { tell('Questの接続確認待ちです。Questの画面を確認してください'); return; }
      if (!safe && quest.firebaseState !== '接続済み') { tell('QuestのFirebase接続を確認してください'); return; }
      if (!safe && !quest.renderStarted) { tell('Questの3D描画が未完了です。下の起動エラー・描画状態を確認してください'); return; }
      if (['start','calibrate'].includes(type) && !quest.immersive) {
        tell(`Questの実VRセッションを確認できません（XR描画=${quest.xrPresenting ?? '不明'}、XRセッション=${quest.xrSessionActive ?? '不明'}）。VRボタンを押しても続く場合、下の診断情報を確認してください。別のPC・Questタブが同じ接続先へ状態を送っていないかも確認してください。`); return;
      }
      if (type === 'start' && !quest.calibrated) { tell('PCで立ち位置を合わせてください'); return; }
      const durationSec = Number($('duration').value), frequencyHz = Number($('freq').value), amplitudeDeg = Number($('amp').value);
      const heightCm = Number($('heightCm').value), eyeHeightM = Number($('eyeCm').value) / 100, ankleHeightM = Number($('ankleCm').value) / 100;
      const mode = type === 'start' && baselineRequest ? 'baseline' : $('mode').value;
      if (!safe && type !== 'configure' && (!Number.isFinite(ankleHeightM) || ankleHeightM < 0 || ankleHeightM > .2 ||
        !Number.isFinite(eyeHeightM) || eyeHeightM < .8 || eyeHeightM > 2.1 || !Number.isFinite(heightCm) || heightCm < 100 || heightCm > 220)) { tell('身長・目・足首の高さが範囲外です'); return; }
      if (type === 'start' && (!Number.isFinite(durationSec) || durationSec < 5 || durationSec > 600 ||
        (mode === 'sine' && (!Number.isFinite(frequencyHz) || frequencyHz <= 0 || frequencyHz > 2 || !Number.isFinite(amplitudeDeg) || amplitudeDeg < 0 || amplitudeDeg > 20)))) { tell('刺激設定が範囲外です'); return; }
      const trapSettings = { amplitudeDeg, velocityDegSec:Number($('velocity').value), rampSec:Number($('ramp').value), holdSec:Number($('hold').value) };
      if(type==='start' && mode==='trapv') Stimulus.trap(trapSettings);
      const seq = lastSeq = Math.max(Date.now(), lastSeq + 1);
      const command = { type, seq, questInstanceId: quest?.instanceId || null,
        runId: 'trial-' + crypto.randomUUID(), requestedAt: firebase.database.ServerValue.TIMESTAMP };
      if (!safe) Object.assign(command, { heightCm, eyeHeightM, ankleHeightM, mode, frequencyHz, amplitudeDeg, durationSec, pattern:$('pattern').value, ...trapSettings });
      attempt = { seq, type, received: false }; awaiting = attempt;
      // set() queues writes offline. A reconnect may deliver this later; Quest rejects stale START/calibrate.
      await root.child('command').set(command);
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
  $('pattern').onchange = () => { describePattern(); return dispatch('configure'); };
  $('applyPattern').onclick = () => dispatch('configure');
  $('csvDownload').onclick = async () => { try { const logs=(await root.child('logs').get()).val() || {}; const rows=[['run_id','mode','pattern','elapsed_ms','applied_deg','commanded_deg','performance_ms','epoch_estimate_ms','metadata_json']]; for(const user of Object.values(logs)) for(const [id,log] of Object.entries(user)) { const {samples,...metadata}=log; for(const s of samples || []) rows.push([id,log.mode,log.pattern || 'room',...s,JSON.stringify(metadata)]); } const text=rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n'); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['\uFEFF'+text],{type:'text/csv'}));a.download='quest-logs.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000); } catch(e){tell(e.message);} };
  $('download').onclick = async () => {
    try {
      const logs = (await root.child('logs').get()).val() || {};
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' }));
      a.download = 'quest-stimulus-logs-' + config.sessionId + '.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000); tell('ログを取得しました。外部センサーとの時刻同期は別途必要です。');
    } catch (error) { tell('取得エラー: ' + error.message); }
  };
})();
