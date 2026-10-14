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
  const pivot = new THREE.Vector3(0, 0.088, 0);
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
      appliedAngleDeg: active?.actualAngle || 0, startupError: window.vrLastError || '' };
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
  // One static mipmapped texture and one mesh; no per-frame texture regeneration.
  function selectPattern(pattern) {
    // Old clients used checker/stripes; both now resolve to the requested grid.
    pattern = pattern === 'room' ? 'room' : 'grid';
    scene.querySelector('#room-pattern').object3D.visible = pattern === 'room';
    scene.querySelector('#contrast-surround').object3D.visible = pattern !== 'room';
    const el = scene.querySelector('#contrast-pattern');
    el.object3D.visible = pattern !== 'room';
    el.object3D.position.set(pivot.x, 0, pivot.z);
    if (pattern === 'room' || el.dataset.pattern === pattern) return;
    el.dataset.pattern = pattern;
    const old = el.getObject3D('mesh');
    if(old) { old.geometry.dispose(); old.material.map.dispose(); old.material.dispose(); }
    const canvas=document.createElement('canvas'); canvas.width=1024; canvas.height=2048;
    const ctx=canvas.getContext('2d');
    Stimulus.drawGrid(ctx, canvas.width, canvas.height);
    const texture=new THREE.CanvasTexture(canvas); texture.anisotropy=Math.min(8,scene.renderer?.capabilities.getMaxAnisotropy() || 1);
    const geometry=new THREE.CylinderGeometry(1,1,6,96,1,true,Math.PI/2,Math.PI);
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
    mesh.position.y=2; el.setObject3D('mesh',mesh);
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
      endedAtQuestWallClockMs: Date.now(), anklePivotM: trial.pivot, calibration: trial.calibration, timeOriginMs: performance.timeOrigin, serverOffsetMs: serverOffset, sampleColumns: ['elapsed_ms','applied_deg','commanded_deg','performance_ms','epoch_estimate_ms'],
      samples: trial.samples,
      note: 'Applied angle is software transform, not measured photon output. Approximate modern room, not an exact paper reproduction. Ankle x/z approximate the point below the head. samples=[elapsed_ms,visual_world_rotation_deg]. Quest wall-clock timestamps are not synchronized with external sensors.' };
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
      if (active && active.startedPerf !== null) { active.returning ||= { at: performance.now(), angle: active.actualAngle || 0 }; ack('returning'); }
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
      if (!['room','grid','checker','stripes'].includes(c.pattern)) { block('映像パターン不正'); return; }
      selectPattern(c.pattern); ack(ready() ? 'ready' : 'connected', { pattern: c.pattern, configured: true }); return;
    }
    if (!ready()) { block(rendered() ? 'enter VR before START（immersive-vr未開始）' : '3D描画の初期化が未完了です'); return; }
    if (c.type === 'calibrate') {
      if (active || pending) { block('STOPしてから位置合わせしてください'); return; }
      if (!Number.isFinite(c.heightCm) || c.heightCm < 100 || c.heightCm > 220) { block('身長が範囲外です'); return; }
      if (!Number.isFinite(c.ankleHeightM) || c.ankleHeightM < 0 || c.ankleHeightM > 0.2) { block('足首の高さが不正です'); return; }
      const head = new THREE.Vector3();
      if (preview) {
        scene.querySelector('a-camera').setAttribute('position', { x: 0, y: c.eyeHeightM || 1.5, z: 0 });
      } else {
        scene.renderer.xr.getCamera(scene.camera).getWorldPosition(head);
      }
      pivot.set(head.x, c.ankleHeightM, head.z);
      calibration = { heightCm: c.heightCm || null, measuredEyeHeightM: preview ? null : head.y, estimatedAnkleHeightM: (c.heightCm || 160)/100*.039, manualAnkleHeightM: c.ankleHeightM, referenceSpace: 'local-floor requested; verify floor on device', calibratedAtMs: Date.now() };
      calibrated = true; rotate(0); show('位置合わせ完了（足首の前後・左右は頭の真下で近似）');
      selectPattern(c.pattern || 'room');
      ack('ready', { anklePivotM: pivot.toArray(), calibration }); return;
    }
    if (c.type !== 'start') return;
    if (!calibrated) { block('PCで立ち位置合わせが必要です'); return; }
    if (!['baseline', 'sine', 'csv', 'trapv'].includes(c.mode) || !Number.isFinite(c.durationSec) || c.durationSec < 5 || c.durationSec > 600 ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(c.runId || '') ||
      (c.mode === 'sine' && (!Number.isFinite(c.frequencyHz) || c.frequencyHz <= 0 || c.frequencyHz > 2 ||
        !Number.isFinite(c.amplitudeDeg) || c.amplitudeDeg < 0 || c.amplitudeDeg > 20))) {
      block('刺激設定が不正です'); return;
    }
    if (active || pending) { block('STOP後に次の条件を開始してください'); return; }
    if (c.mode === 'trapv') { try { Stimulus.trap(c); } catch(e) { block(e.message); return; } }
    if (c.mode === 'sine' && 2*Math.PI*c.frequencyHz*c.amplitudeDeg > Stimulus.limits.velocity) { block('角速度上限30°/sを超えます'); return; }
    if (c.pattern && !['room','grid','checker','stripes'].includes(c.pattern)) { block('映像パターン不正'); return; }
    finish('replaced');
    selectPattern(c.pattern || 'room');
    const token = generation;
    const trial = { cmd: { ...c }, samples: [], pivot: pivot.toArray(), points: null, calibration,
      startedPerf: null, startedWallMs: null, preludePerf: null };
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
      if (active.returning) {
        const u=Math.min(1,(now-active.returning.at)/2000);
        const deg=active.returning.angle*(1-u*u*(3-2*u)); rotate(deg);
        active.samples.push([(now-active.startedPerf),deg,0,now,performance.timeOrigin+now]);
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
      rotate(degrees); active.samples.push([Math.round(t * 1000), Math.round(degrees * 100000) / 100000, commanded, now, performance.timeOrigin + now]);
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
  setInterval(() => ack(active ? (active.returning ? 'returning' : active.startedPerf === null ? 'countdown' : 'running') : pending ? 'loading' : ready() ? 'ready' : 'connected',
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
