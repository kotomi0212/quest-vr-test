(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const tell = text => { $('log').textContent = text; };
  const config = window.VR_REMOTE_CONFIG;
  if (!window.firebase || !config?.firebase) { $('authState').textContent = 'Firebaseの読み込みに失敗しました。再読み込みしてください。'; return; }
  firebase.initializeApp(config.firebase);
  const auth = firebase.auth(), db = firebase.database(), root = db.ref('sessions/' + config.sessionId);
  let quest = null, lastSeq = 0, awaiting = null, subscribed = false, serverOffset = 0;
  let previewReady = false, csvPoints = null;
  db.ref('.info/connected').on('value', snap => { $('pcConnection').textContent = snap.val() ? 'PC Firebase: 接続済み' : 'PC Firebase: 切断'; });
  $('retry').onclick = () => location.reload();
  $('estimateAnkle').onclick = () => { $('ankleCm').value = (Number($('heightCm').value)*.039).toFixed(2); };
  $('csvUpload').onchange = async () => { try { csvPoints=Stimulus.parseCsv(await $('csvUpload').files[0].text()); drawWave(); } catch(e) { csvPoints=null; $('waveError').textContent=e.message; } };
  function drawWave() {
    try {
      const c={mode:$('mode').value,amplitudeDeg:Number($('amp').value),frequencyHz:Number($('freq').value),velocityDegSec:Number($('velocity').value),rampSec:Number($('ramp').value),holdSec:Number($('hold').value)};
      const ctx=$('waveform').getContext('2d'); ctx.clearRect(0,0,640,160);ctx.beginPath();
      const duration=Number($('duration').value);
      for(let i=0;i<=640;i++){const a=Stimulus.angle(c,i/640*duration,csvPoints || [[0,0],[duration,0]]); const y=80-a*3; if(i)ctx.lineTo(i,y);else ctx.moveTo(i,y);}
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
    $('state').textContent = v ? v.status + ' / ' + (v.runId || v.lastRunId || '-') : 'Quest未接続';
    $('questDiagnostics').textContent = v ?
      `3D: ${v.renderStarted ? '描画中' : '未完了'} / VRボタン: ${v.vrButton ? '生成済み' : '未生成'} / WebXR: ${v.xrSupport || '不明'} / immersive-vr: ${v.immersive ? '開始済み' : '未開始'} / 位置合わせ: ${v.calibrated ? '完了' : '未完了'} / Firebase: ${v.firebaseState || '不明'}${v.startupError ? ' / 起動エラー: ' + v.startupError : ''}` : '';
    if (!awaiting || v?.commandSeq !== awaiting.seq) return;
    const messages = {
      loading: 'QuestがSTARTを受信：CSV読込中', countdown: 'QuestがSTARTを受信：3秒の待機中',
      running: 'Questで刺激を再生中', idle: 'Questで停止・終了しました',
      blocked: 'Questで開始・位置合わせができません：' + (v.error || '状態を確認してください'),
      'log-error': 'Questのログ保存に失敗しました：' + (v.error || ''),
      ready: v.calibrated ? '✓ Questの位置合わせが完了しました' : 'QuestでVR開始済み。立ち位置を合わせてください'
    };
    if (v.status === 'ready' && awaiting.type !== 'calibrate') return;
    if (messages[v.status]) { awaiting.received = true; tell(messages[v.status]); }
  }
  auth.onAuthStateChanged(user => {
    const signedIn = user && !user.isAnonymous;
    $('login').style.display = signedIn ? 'none' : 'block'; $('control').style.display = signedIn ? 'block' : 'none';
    if (!signedIn) {
      if (subscribed) root.child('status').off('value', receive);
      subscribed = false; quest = null; previewReady = false; $('preview').removeAttribute('src'); return;
    }
    if (!$('preview').getAttribute('src')) $('preview').src = 'quest.html?preview=1';
    if (!subscribed) { subscribed = true; root.child('status').on('value', receive, error => tell('Quest状態の購読エラー: ' + error.message)); }
  });
  setInterval(() => {
    if (quest && !freshQuest()) $('state').textContent = 'Questの状態更新が途絶えています。接続・画面を確認してください';
  }, 2000);
  async function dispatch(type) {
    const safe = ['stop','return','emergency'].includes(type);
    const button = $(type === 'emergency' ? 'emergency' : type === 'start' ? 'start' : type === 'calibrate' ? 'calibrate' : 'stop');
    const original = button.textContent;
    tell(type === 'start' ? '▶ STARTを押しました' : type === 'stop' ? '■ STOPを押しました' : '位置合わせを押しました');
    button.disabled = true; button.textContent = '送信中…';
    let attempt;
    try {
      if (!freshQuest() && !safe) { tell('Questの接続確認待ちです。Questの画面を確認してください'); return; }
      if (!safe && quest.firebaseState !== '接続済み') { tell('QuestのFirebase接続を確認してください'); return; }
      if (!safe && (!quest.immersive || !quest.renderStarted)) {
        tell('Questでimmersive-vrが開始していません。標準VRボタンと起動状態を確認してください'); return;
      }
      if (type === 'start' && !quest.calibrated) { tell('PCで立ち位置を合わせてください'); return; }
      const durationSec = Number($('duration').value), frequencyHz = Number($('freq').value), amplitudeDeg = Number($('amp').value);
      const heightCm = Number($('heightCm').value), eyeHeightM = Number($('eyeCm').value) / 100, ankleHeightM = Number($('ankleCm').value) / 100;
      const mode = $('mode').value;
      if (!safe && (!Number.isFinite(ankleHeightM) || ankleHeightM < 0 || ankleHeightM > .2 ||
        !Number.isFinite(eyeHeightM) || eyeHeightM < .8 || eyeHeightM > 2.1 || !Number.isFinite(heightCm) || heightCm < 100 || heightCm > 220)) { tell('身長・目・足首の高さが範囲外です'); return; }
      if (type === 'start' && (!Number.isFinite(durationSec) || durationSec < 5 || durationSec > 600 ||
        (mode === 'sine' && (!Number.isFinite(frequencyHz) || frequencyHz <= 0 || frequencyHz > 2 || !Number.isFinite(amplitudeDeg) || amplitudeDeg < 0 || amplitudeDeg > 20)))) { tell('刺激設定が範囲外です'); return; }
      const trapSettings = { amplitudeDeg, velocityDegSec:Number($('velocity').value), rampSec:Number($('ramp').value), holdSec:Number($('hold').value) };
      if(type==='start' && mode==='trapv') Stimulus.trap(trapSettings);
      const seq = lastSeq = Math.max(Date.now(), lastSeq + 1);
      const command = { type, seq, questInstanceId: quest?.instanceId || null,
        runId: 'trial-' + crypto.randomUUID(), requestedAt: firebase.database.ServerValue.TIMESTAMP };
      if (!safe) Object.assign(command, { heightCm, eyeHeightM, ankleHeightM, mode, frequencyHz, amplitudeDeg, durationSec, csvFile: $('csvFile').value.trim(), pattern:$('pattern').value, ...trapSettings, ...(mode==='csv' && csvPoints ? {csvPoints} : {}) });
      attempt = { seq, type, received: false }; awaiting = attempt;
      // set() queues writes offline. A reconnect may deliver this later; Quest rejects stale START/calibrate.
      await root.child('command').set(command);
      sendPreview(command);
      if (awaiting === attempt && !attempt.received) tell(`✓ ${type === 'calibrate' ? '位置合わせ' : (type === 'return' ? 'STOP' : type.toUpperCase())}送信済み・Questの受信確認待ち`);
    } catch (error) {
      if (awaiting === attempt) tell('送信エラー: ' + error.message);
    } finally { button.disabled = false; button.textContent = original; }
  }
  $('calibrate').onclick = () => dispatch('calibrate'); $('start').onclick = () => dispatch('start'); $('stop').onclick = () => dispatch('return');
  $('emergency').onclick = () => dispatch('emergency');
  $('baseline').onclick = () => { $('mode').value='baseline'; drawWave(); dispatch('start'); };
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
