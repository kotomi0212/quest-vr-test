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
  let calibrated = preview, wasImmersive = false, graphicsLost = false, observedSession = null;
  let xrSupport = '確認中', firebaseState = preview ? 'プレビュー（接続なし）' : '準備中';
  const pivot = new THREE.Vector3(0, 0.08, 0);
  const show = message => { document.querySelector('#status').textContent = message; };
  const immersive = () => !!(scene.renderer?.xr.isPresenting &&
    scene.renderer.xr.getSession() && scene.is('vr-mode') && !scene.is('ar-mode'));
  const rendered = () => !!(scene.renderStarted && scene.camera && !graphicsLost);
  const ready = () => rendered() && (preview || immersive());
  function diagnostics() {
    return { instanceId, loaded: !!scene.hasLoaded, renderStarted: rendered(),
      vrButton: !!scene.querySelector('.a-enter-vr-button'), secureContext: isSecureContext,
      xrSupport, immersive: immersive(), calibrated, firebaseState, startupError: window.vrLastError || '' };
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
  function rotate(degrees) {
    const room = scene.querySelector('#visual-world');
    if (!room?.object3D) return;
    room.object3D.rotation.x = THREE.MathUtils.degToRad(degrees);
    const rotated = pivot.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), room.object3D.rotation.x);
    room.object3D.position.copy(pivot).sub(rotated);
  }
  function cancelPending() {
    generation++;
    pending?.abort(); pending = null;
  }
  function finish(reason = 'completed') {
    cancelPending();
    const trial = active;
    active = null; rotate(0);
    if (!trial) return;
    show('停止・終了 (' + reason + ') / 室内は静止表示');
    ack('idle', { lastRunId: trial.cmd.runId, reason });
    if (preview || !root || !user) return;
    const c = trial.cmd;
    const payload = { ...c, reason, startedAtQuestWallClockMs: trial.startedWallMs,
      endedAtQuestWallClockMs: Date.now(), anklePivotM: trial.pivot,
      samples: trial.samples,
      note: 'Approximate modern room, not an exact paper reproduction. Ankle x/z approximate the point below the head. samples=[elapsed_ms,visual_world_rotation_deg]. Quest wall-clock timestamps are not synchronized with external sensors.' };
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
  function parseCsv(content) {
    const points = [];
    for (const line of content.trim().split(/\r?\n/)) {
      const text = line.trim();
      if (!text || text.startsWith('#') || /^time/i.test(text)) continue;
      const cells = text.split(',');
      if (cells.length !== 2 || cells.some(c => !c.trim())) throw Error('CSV行が不正です');
      const [time, angle] = cells.map(Number);
      if (!Number.isFinite(time) || !Number.isFinite(angle) || time < 0 || Math.abs(angle) > 45) throw Error('CSVの値が範囲外です');
      points.push([time, angle]);
    }
    if (points.length < 2) throw Error('CSVには2行以上のデータが必要です');
    if (points.some((p, i) => i && p[0] <= points[i - 1][0])) throw Error('CSV時刻は昇順・重複なしが必要です');
    return points;
  }
  function interpolate(points, time) {
    if (time <= points[0][0]) return points[0][1];
    if (time >= points.at(-1)[0]) return points.at(-1)[1];
    let a = 0, b = points.length - 1;
    while (a + 1 < b) { const m = (a + b) >> 1; if (points[m][0] <= time) a = m; else b = m; }
    return points[a][1] + (time - points[a][0]) / (points[b][0] - points[a][0]) * (points[b][1] - points[a][1]);
  }
  function hashSeed(text) {
    let value = 2166136261;
    for (const char of text) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619); }
    return value >>> 0;
  }
  function seededRandom(seed) {
    let state = seed || 1;
    return () => {
      state = (state + 0x6D2B79F5) | 0;
      let x = state;
      x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61);
      return ((x ^ x >>> 14) >>> 0) / 4294967296;
    };
  }
  // Random-phase Fourier synthesis: component power is proportional to 1/f.
  function makePinkNoise(durationSec, peakDeg, seedText) {
    const df = 1 / durationSec, maxHz = 1;
    const random = seededRandom(hashSeed(seedText));
    const components = [];
    for (let frequency = df; frequency <= maxHz + df / 2; frequency += df) {
      components.push({ frequency, weight: 1 / Math.sqrt(frequency), phase: random() * 2 * Math.PI });
    }
    const raw = time => components.reduce((sum, part) =>
      sum + part.weight * Math.sin(2 * Math.PI * part.frequency * time + part.phase), 0);
    let maxAbs = 0;
    for (let i = 0; i <= Math.ceil(durationSec * 90); i++) maxAbs = Math.max(maxAbs, Math.abs(raw(i / 90)));
    const scale = maxAbs ? peakDeg / maxAbs : 0;
    return { angle: time => raw(time) * scale, seed: hashSeed(seedText), minHz: df,
      maxHz, components: components.length };
  }
  function block(error) { show(error); ack('blocked', { error }); }
  async function command(c) {
    if (!c || !Number.isSafeInteger(c.seq)) return;
    // STOP is always safe, including when a stale PC has not received this instance's status yet.
    if (!preview && c.questInstanceId !== instanceId) {
      if (c.type === 'stop') { finish('stopped'); rotate(0); ack('idle', { commandSeq: c.seq, reason: 'stopped' }); }
      return;
    }
    if (c.seq <= lastSeq) return;
    lastSeq = c.seq; commandSeq = c.seq;
    if (c.type === 'stop') {
      finish('stopped'); rotate(0); ack('idle', { reason: 'stopped' }); return;
    }
    if (!preview && (!Number.isFinite(c.requestedAt) ||
      Math.abs(Date.now() + serverOffset - c.requestedAt) > 15000)) {
      block('古いコマンドです。PCから再送してください'); return;
    }
    syncXR();
    if (!ready()) { block(rendered() ? 'enter VR before START（immersive-vr未開始）' : '3D描画の初期化が未完了です'); return; }
    if (c.type === 'calibrate') {
      if (active || pending) { block('STOPしてから位置合わせしてください'); return; }
      if (!Number.isFinite(c.ankleHeightM) || c.ankleHeightM < 0 || c.ankleHeightM > 0.2) { block('足首の高さが不正です'); return; }
      const head = new THREE.Vector3();
      if (preview) {
        scene.querySelector('a-camera').setAttribute('position', { x: 0, y: c.eyeHeightM || 1.5, z: 0 });
      } else {
        scene.renderer.xr.getCamera(scene.camera).getWorldPosition(head);
      }
      pivot.set(head.x, c.ankleHeightM, head.z);
      calibrated = true; rotate(0); show('位置合わせ完了（足首の前後・左右は頭の真下で近似）');
      ack('ready', { anklePivotM: pivot.toArray() }); return;
    }
    if (c.type !== 'start') return;
    if (!calibrated) { block('PCで立ち位置合わせが必要です'); return; }
    if (!['baseline', 'sine', 'pink', 'csv'].includes(c.mode) || !Number.isFinite(c.durationSec) || c.durationSec < 5 || c.durationSec > 600 ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(c.runId || '') ||
      (c.mode === 'sine' && (!Number.isFinite(c.frequencyHz) || c.frequencyHz <= 0 || c.frequencyHz > 2 ||
        !Number.isFinite(c.amplitudeDeg) || c.amplitudeDeg < 0 || c.amplitudeDeg > 20)) ||
      (c.mode === 'pink' && (!Number.isFinite(c.amplitudeDeg) || c.amplitudeDeg < 0 || c.amplitudeDeg > 20))) {
      block('刺激設定が不正です'); return;
    }
    finish('replaced');
    const token = generation;
    const trial = { cmd: { ...c }, samples: [], pivot: pivot.toArray(), points: null, pink: null,
      startedPerf: null, startedWallMs: null, preludePerf: null };
    if (c.mode === 'pink') {
      trial.pink = makePinkNoise(c.durationSec, c.amplitudeDeg, c.runId);
      Object.assign(trial.cmd, { noiseSeed: trial.pink.seed, noiseMinHz: trial.pink.minHz,
        noiseMaxHz: trial.pink.maxHz, noiseComponents: trial.pink.components,
        spectrum: 'power proportional to 1/f' });
    }
    if (preview) {
      scene.querySelector('a-camera').setAttribute('position', { x: 0, y: c.eyeHeightM || 1.5, z: 0 });
      pivot.set(0, c.ankleHeightM || 0, 0); trial.pivot = pivot.toArray();
    }
    if (c.mode === 'csv') {
      if (!/^[A-Za-z0-9_.-]+\.csv$/.test(c.csvFile || '') || c.csvFile.includes('..')) { block('CSVファイル名が不正です'); return; }
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
    if (token !== generation || !ready() || (!preview && !connected)) return;
    pending = null; trial.preludePerf = performance.now(); active = trial; rotate(0);
    show('開始待機（3秒）: ' + c.mode); ack('countdown', { commandSeq: c.seq, runId: c.runId });
  }
  AFRAME.registerComponent('stimulus-driver', {
    tick() {
      syncXR();
      if (!active) return;
      if (!ready()) { finish('not-ready'); return; }
      const now = performance.now();
      if (active.startedPerf === null) {
        if (now - active.preludePerf < 3000) return;
        active.startedPerf = now; active.startedWallMs = Date.now();
        show('再生中: ' + active.cmd.mode); ack('running', { commandSeq: active.cmd.seq, runId: active.cmd.runId, startedAtQuestWallClockMs: active.startedWallMs });
      }
      const t = (now - active.startedPerf) / 1000, c = active.cmd;
      if (t >= c.durationSec) { finish(); return; }
      const degrees = c.mode === 'sine' ? c.amplitudeDeg * Math.sin(2 * Math.PI * c.frequencyHz * t) :
        c.mode === 'pink' ? active.pink.angle(t) :
        c.mode === 'csv' ? interpolate(active.points, t) : 0;
      rotate(degrees); active.samples.push([Math.round(t * 1000), Math.round(degrees * 100000) / 100000]);
    }
  });
  if (preview) {
    document.querySelector('#info').style.display = 'none';
    scene.setAttribute('xr-mode-ui', 'enabled: false');
    scene.setAttribute('embedded', '');
    window.addEventListener('message', event => {
      if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'stimulus-command') return;
      void command(event.data.command).catch(error => reportStartupError(error.message));
    });
  }
  scene.addEventListener('enter-vr', syncXR);
  scene.addEventListener('exit-vr', () => { calibrated = preview; finish('vr-exited'); syncXR(); });
  scene.addEventListener('loaded', () => { show('室内読込完了。右下の標準VRボタンで開始してください'); updateDiagnostics(); });
  scene.addEventListener('renderstart', () => {
    clearTimeout(startupTimer); document.querySelector('#startup-error').hidden = true;
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
  document.body.appendChild(scene);
  if (!isSecureContext || !navigator.xr) xrSupport = '非対応（HTTPS・Quest Browserを確認）';
  else navigator.xr.isSessionSupported('immersive-vr').then(supported => {
    xrSupport = supported ? '対応' : '非対応'; updateDiagnostics(); ack(ready() ? 'ready' : 'connected');
  }).catch(error => { xrSupport = error.message; updateDiagnostics(); });
  // Poll state even when XR events or a paused render loop arrive in another order.
  setInterval(() => { syncXR(); updateDiagnostics(); }, 250);
  setInterval(() => ack(active ? (active.startedPerf === null ? 'countdown' : 'running') : pending ? 'loading' : ready() ? 'ready' : 'connected',
    active ? { commandSeq: active.cmd.seq, runId: active.cmd.runId } : {}), 5000);
  async function loadScript(src) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = src;
      script.onload = resolve; script.onerror = () => reject(Error('読込失敗: ' + src)); document.head.appendChild(script);
    });
  }
  async function connect() {
    if (preview) return; // Preview never initializes Firebase or changes the shared auth/session/logs.
    await loadScript('firebase-config.js');
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
