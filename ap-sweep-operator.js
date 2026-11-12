(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const defaults = AP_SWEEP_CONFIG;
  const fields = {
    startFrequencyHz: 'startFrequency',
    endFrequencyHz: 'endFrequency',
    durationSec: 'duration',
    velocityAmplitudeMps: 'velocityAmplitude',
    roomSizeM: 'roomSize',
    gridSpacingM: 'gridSpacing'
  };
  for (const [key, id] of Object.entries(fields)) $(id).value = defaults[key];

  const tell = text => { $('message').textContent = text; };
  let quest = null;
  let root = null;
  let app = null;
  let sequence = 0;
  let serverOffsetMs = 0;
  let previewReady = false;

  function readSettings() {
    const values = {};
    for (const [key, id] of Object.entries(fields)) values[key] = Number($(id).value);
    return APSweepStimulus.validate({ ...defaults, ...values });
  }

  function updateSummary() {
    try {
      const c = readSettings();
      const k = APSweepStimulus.sweepRate(c);
      const cycles = c.startFrequencyHz * Math.expm1(k * c.durationSec) / k;
      $('summary').textContent = `高周波→低周波の対数スイープ：約${cycles.toFixed(2)}周期。速度振幅は全区間で±${c.velocityAmplitudeMps} m/s、位置は速度の時間積分です。`;
    } catch (error) { $('summary').textContent = error.message; }
  }
  $('control').addEventListener('input', updateSummary);
  updateSummary();

  function command(type, extra = {}) {
    const safe = ['stop', 'emergency'].includes(type);
    return {
      type,
      sequence: sequence = Math.max(Date.now(), sequence + 1),
      questInstanceId: quest?.instanceId || null,
      requestedAt: firebase.database.ServerValue.TIMESTAMP,
      ...(safe ? {} : readSettings()),
      ...extra
    };
  }

  function sendPreview(value) {
    if (previewReady) $('preview').contentWindow.postMessage({ type: 'ap-sweep-command', command: { ...value, requestedAt: Date.now() } }, location.origin);
  }

  async function dispatch(type, extra = {}) {
    let value;
    try { value = command(type, extra); }
    catch (error) { tell(error.message); return; }
    sendPreview(value);
    if (!root) { tell('Firebaseログインと接続を確認してください'); return; }
    const safe = ['stop', 'emergency'].includes(type);
    const freshQuest = quest?.instanceId && Number.isFinite(quest.at) && Math.abs(Date.now() + serverOffsetMs - quest.at) < 15000;
    if (!freshQuest && !safe) { tell('Questの状態更新が途絶えています。接続と画面を確認してください'); return; }
    if (['start', 'calibrate'].includes(type) && !quest.immersive) { tell('Questで標準VRボタンを押してimmersive-vrを開始してください'); return; }
    if (type === 'start' && !quest.calibrated) { tell('先に「立ち位置を合わせる」を押してください'); return; }
    try {
      await root.child('command').set(value);
      tell(type === 'start' ? 'STARTを送信しました' : `${type.toUpperCase()}を送信しました`);
    } catch (error) { tell('送信エラー: ' + error.message); }
  }

  function receiveStatus(snapshot) {
    quest = snapshot.val();
    if (!quest) { $('state').textContent = '未接続'; return; }
    const f = quest.instantaneousFrequencyHz;
    $('state').textContent = `${quest.status || '不明'} / ${quest.activeMode || '-'} / 位置 ${Number(quest.apPositionM || 0).toFixed(4)} m / 速度 ${Number(quest.apVelocityMps || 0).toFixed(4)} m/s${Number.isFinite(f) ? ` / ${f.toFixed(4)} Hz` : ''}`;
    $('diagnostics').textContent = `3D: ${quest.renderStarted ? '描画中' : '未完了'} / immersive-vr: ${quest.immersive ? '開始済み' : '未開始'} / 位置合わせ: ${quest.calibrated ? '完了' : '未完了'} / Firebase: ${quest.firebaseState || '不明'} / 接続ID: ${quest.instanceId}`;
    const messages = {
      countdown: 'Questが受信しました。3秒後に開始します。',
      running: 'Questで提示中です。',
      returning: 'Questの部屋を原点へ戻しています。',
      idle: '停止・終了しました。',
      blocked: 'Questで拒否されました: ' + (quest.error || '状態を確認してください'),
      'log-error': 'ログ保存エラー: ' + (quest.error || '')
    };
    if (messages[quest.status]) tell(messages[quest.status]);
  }

  async function downloadLogs(format) {
    if (!root) { tell('先にログインしてください'); return; }
    try {
      const logs = (await root.child('logs').get()).val() || {};
      if (format === 'json') {
        download(new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' }), 'ap-sweep-logs.json');
        return;
      }
      const entries = [];
      for (const userLogs of Object.values(logs)) for (const [runId, log] of Object.entries(userLogs)) entries.push({ runId, log });
      const columns = [...new Set(entries.flatMap(entry => entry.log.sampleColumns || []))];
      const rows = [['run_id', 'mode', ...columns, 'metadata_json']];
      for (const { runId, log } of entries) {
        const own = log.sampleColumns || [];
        const { samples, ...metadata } = log;
        for (const sample of samples || []) rows.push([runId, log.mode, ...columns.map(name => {
          const index = own.indexOf(name);
          return index < 0 ? '' : sample[index];
        }), JSON.stringify(metadata)]);
      }
      const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
      download(new Blob([csv], { type: 'text/csv' }), 'ap-sweep-logs.csv');
    } catch (error) { tell('ログ取得エラー: ' + error.message); }
  }

  function download(blob, filename) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  $('signIn').onclick = async () => {
    try {
      await app.auth().signInWithEmailAndPassword($('email').value, $('password').value);
      $('authState').textContent = 'ログインしました';
    } catch (error) { $('authState').textContent = 'エラー: ' + error.message; }
  };
  $('configure').onclick = () => dispatch('configure');
  $('calibrate').onclick = () => dispatch('calibrate');
  $('start').onclick = () => dispatch('start', { mode: 'sweep', runId: 'sweep-' + crypto.randomUUID() });
  $('baseline').onclick = () => dispatch('start', { mode: 'baseline', runId: 'baseline-' + crypto.randomUUID() });
  $('stop').onclick = () => dispatch('stop');
  $('emergency').onclick = () => dispatch('emergency');
  $('csvDownload').onclick = () => downloadLogs('csv');
  $('jsonDownload').onclick = () => downloadLogs('json');
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== $('preview').contentWindow || event.data?.type !== 'ap-sweep-preview-ready') return;
    previewReady = true;
    sendPreview(command('configure'));
  });

  if (!window.firebase || !window.VR_REMOTE_CONFIG?.firebase) {
    $('authState').textContent = 'Firebase設定を読み込めません';
    return;
  }
  app = firebase.initializeApp(window.VR_REMOTE_CONFIG.firebase, 'ap-sweep-operator');
  const database = app.database();
  root = database.ref(`sessions/${window.VR_REMOTE_CONFIG.sessionId}/ap-sweep`);
  database.ref('.info/serverTimeOffset').on('value', snap => { serverOffsetMs = snap.val() || 0; });
  app.auth().onAuthStateChanged(user => {
    const signedIn = !!(user && !user.isAnonymous);
    $('login').hidden = signedIn;
    $('control').hidden = !signedIn;
    if (!signedIn) return;
    root.child('status').on('value', receiveStatus);
    if (!$('preview').getAttribute('src')) $('preview').src = 'quest3.html?preview=1&v=1';
  });
})();
