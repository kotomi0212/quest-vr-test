(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const scene = $('#scene');
  const room = $('#sweep-room');
  const preview = new URLSearchParams(location.search).has('preview');
  const defaults = AP_SWEEP_CONFIG;
  let settings = { ...defaults };
  let calibration = preview ? { anchorX: 0, anchorZ: 0, eyeHeightM: defaults.previewEyeHeightM, source: 'preview' } : null;
  let active = null;
  let root = null;
  let user = null;
  let connected = false;
  let serverOffsetMs = 0;
  let lastSequence = 0;
  let commandSequence = null;
  let instanceId = crypto.randomUUID();
  let rendered = false;
  let firebaseState = preview ? 'プレビュー（Firebaseなし）' : '準備中';
  let lastStatusPerf = 0;

  const show = text => { $('#status').textContent = text; };
  const showError = text => { $('#error').textContent = text || ''; };
  const immersive = () => !!(scene.renderer?.xr.isPresenting && scene.renderer.xr.getSession() && !scene.is('ar-mode'));
  const ready = () => rendered && (preview || immersive());

  function commandSettings(command) {
    return APSweepStimulus.validate({
      startFrequencyHz: Number(command.startFrequencyHz),
      endFrequencyHz: Number(command.endFrequencyHz),
      durationSec: Number(command.durationSec),
      velocityAmplitudeMps: Number(command.velocityAmplitudeMps),
      roomSizeM: Number(command.roomSizeM),
      roomHeightM: Number(command.roomHeightM),
      gridSpacingM: Number(command.gridSpacingM),
      integrationStepSec: defaults.integrationStepSec,
      countdownSec: defaults.countdownSec,
      returnDurationSec: defaults.returnDurationSec,
      previewEyeHeightM: defaults.previewEyeHeightM
    });
  }

  function configureRoom(config = settings) {
    const size = config.roomSizeM;
    const height = config.roomHeightM;
    const half = size / 2;
    const floorRepeat = size / config.gridSpacingM;
    const wallRepeat = height / config.gridSpacingM;
    const surface = (selector, width, surfaceHeight, repeatX, repeatY) => {
      const plane = $(selector);
      plane.setAttribute('width', width);
      plane.setAttribute('height', surfaceHeight);
      plane.setAttribute('material', `src: url(grid.svg); shader: flat; side: double; repeat: ${repeatX} ${repeatY}`);
    };
    surface('.room-floor', size, size, floorRepeat, floorRepeat);
    surface('.room-ceiling', size, size, floorRepeat, floorRepeat);
    for (const selector of ['.room-front', '.room-back', '.room-left', '.room-right']) {
      surface(selector, size, height, floorRepeat, wallRepeat);
    }
    $('.room-floor').setAttribute('position', '0 0 0');
    $('.room-ceiling').setAttribute('position', `0 ${height} 0`);
    $('.room-front').setAttribute('position', `0 ${height / 2} ${-half}`);
    $('.room-back').setAttribute('position', `0 ${height / 2} ${half}`);
    $('.room-left').setAttribute('position', `${-half} ${height / 2} 0`);
    $('.room-right').setAttribute('position', `${half} ${height / 2} 0`);
    const fixationHeight = Math.min(calibration?.eyeHeightM || defaults.previewEyeHeightM, height - 0.1);
    $('#fixation').setAttribute('position', `0 ${fixationHeight} ${-half + 0.01}`);
    applyPosition(0);
  }

  function applyPosition(apPositionM) {
    const anchorX = calibration?.anchorX || 0;
    const anchorZ = calibration?.anchorZ || 0;
    // Positive AP is forward. A-Frame forward is negative Z.
    room.object3D.position.set(anchorX, 0, anchorZ - apPositionM);
    return -apPositionM;
  }

  function diagnostics() {
    return {
      instanceId,
      renderStarted: rendered,
      immersive: immersive(),
      calibrated: !!calibration,
      calibration,
      firebaseState,
      activeMode: active?.mode || null,
      runId: active?.command.runId || null,
      apPositionM: active?.current?.positionM || 0,
      apVelocityMps: active?.current?.velocityMps || 0,
      instantaneousFrequencyHz: active?.current?.frequencyHz ?? null,
      roomSettings: {
        roomSizeM: settings.roomSizeM,
        roomHeightM: settings.roomHeightM,
        gridSpacingM: settings.gridSpacingM
      }
    };
  }

  function updateDiagnostics() {
    $('#diagnostics').textContent = `3D: ${rendered ? '描画中' : '準備中'} / immersive-vr: ${immersive() ? '開始済み' : '未開始'} / Firebase: ${firebaseState}`;
  }

  function acknowledge(status, detail = {}) {
    updateDiagnostics();
    if (preview || !root || !user || !connected) return;
    root.child('status').set({
      status,
      commandSequence,
      ...diagnostics(),
      ...detail,
      at: firebase.database.ServerValue.TIMESTAMP,
      questUid: user.uid
    }).catch(error => {
      firebaseState = '状態送信失敗';
      showError(error.message);
    });
  }

  function sampleRow(elapsedSec, state, phase) {
    const now = performance.now();
    return [
      Math.round(elapsedSec * 1000),
      state.frequencyHz,
      state.positionM,
      state.velocityMps,
      -state.positionM,
      now,
      performance.timeOrigin + now,
      phase
    ];
  }

  function saveAndReset(reason) {
    const trial = active;
    active = null;
    applyPosition(0);
    if (!trial) return;
    show(`停止・終了（${reason}）`);
    acknowledge('idle', { lastRunId: trial.command.runId, reason });
    if (preview || !root || !user) return;
    const payload = {
      runId: trial.command.runId,
      mode: trial.mode,
      reason,
      startedAtQuestWallClockMs: trial.startedWallMs,
      endedAtQuestWallClockMs: Date.now(),
      settings: trial.config,
      calibration: trial.calibration,
      coordinateSystem: 'AP position/velocity positive forward; A-Frame forward is -Z',
      sampleColumns: ['elapsed_ms', 'instantaneous_frequency_hz', 'ap_position_m', 'ap_velocity_m_s', 'translation_z_m', 'performance_ms', 'epoch_estimate_ms', 'phase'],
      samples: trial.samples,
      note: 'Software-commanded room transform; not measured photon output or externally synchronized time.'
    };
    root.child(`logs/${user.uid}/${trial.command.runId}`).set(payload).catch(error => {
      acknowledge('log-error', { error: error.message, lastRunId: trial.command.runId });
    });
  }

  function beginReturn(reason) {
    if (!active || active.returning) return;
    if (Math.abs(active.current?.positionM || 0) < 1e-12) {
      saveAndReset(reason);
      return;
    }
    active.returning = { startedPerf: performance.now(), startPositionM: active.current.positionM, reason };
    show('原点へ復帰中');
    acknowledge('returning', { runId: active.command.runId });
  }

  function stopImmediately(reason) {
    saveAndReset(reason);
    if (!active) applyPosition(0);
  }

  function tick() {
    if (!active || !ready()) return;
    const now = performance.now();
    if (active.startedPerf === null) {
      if (now - active.countdownStartedPerf < active.config.countdownSec * 1000) return;
      active.startedPerf = now;
      active.startedWallMs = Date.now();
      show(active.mode === 'baseline' ? 'Baseline再生中' : '対数スイープ再生中');
      acknowledge('running', { runId: active.command.runId, startedAtQuestWallClockMs: active.startedWallMs });
    }
    const elapsedSec = (now - active.startedPerf) / 1000;
    if (active.returning) {
      const duration = active.config.returnDurationSec;
      const u = Math.min(1, (now - active.returning.startedPerf) / (duration * 1000));
      const smooth = 1 - 3 * u * u + 2 * u * u * u;
      const derivative = (-6 * u + 6 * u * u) / duration;
      active.current = {
        frequencyHz: null,
        positionM: active.returning.startPositionM * smooth,
        velocityMps: active.returning.startPositionM * derivative
      };
      applyPosition(active.current.positionM);
      active.samples.push(sampleRow(elapsedSec, active.current, 'returning'));
      if (u === 1) saveAndReset(active.returning.reason);
      return;
    }
    if (elapsedSec >= active.config.durationSec) {
      if (active.mode === 'baseline') saveAndReset('completed');
      else {
        const finalState = APSweepStimulus.stateAt(active.trajectory, active.config.durationSec);
        active.current = { frequencyHz: finalState.frequencyHz, positionM: finalState.positionM, velocityMps: finalState.velocityMps };
        applyPosition(active.current.positionM);
        active.samples.push(sampleRow(active.config.durationSec, active.current, 'stimulus'));
        beginReturn('completed');
      }
      return;
    }
    const state = active.mode === 'baseline' ?
      { frequencyHz: null, positionM: 0, velocityMps: 0 } :
      APSweepStimulus.stateAt(active.trajectory, elapsedSec);
    active.current = { frequencyHz: state.frequencyHz, positionM: state.positionM, velocityMps: state.velocityMps };
    applyPosition(state.positionM);
    active.samples.push(sampleRow(elapsedSec, active.current, active.mode === 'baseline' ? 'baseline' : 'stimulus'));
    if (now - lastStatusPerf > 1000) {
      lastStatusPerf = now;
      acknowledge('running', { runId: active.command.runId, elapsedSeconds: elapsedSec });
    }
  }

  async function handleCommand(command) {
    if (!command || !Number.isSafeInteger(command.sequence)) return;
    if (!preview && command.questInstanceId !== instanceId && !['stop', 'emergency'].includes(command.type)) return;
    if (command.sequence <= lastSequence) return;
    lastSequence = command.sequence;
    commandSequence = command.sequence;
    showError('');
    if (command.type === 'emergency') {
      stopImmediately('emergency-stopped');
      acknowledge('idle', { reason: 'emergency-stopped' });
      return;
    }
    if (command.type === 'stop') {
      if (active?.startedPerf !== null) beginReturn('stopped');
      else saveAndReset('stopped');
      return;
    }
    if (!preview && (!Number.isFinite(command.requestedAt) || Math.abs(Date.now() + serverOffsetMs - command.requestedAt) > 15000)) {
      acknowledge('blocked', { error: '古い指令のため拒否しました' });
      return;
    }
    let candidate;
    try { candidate = commandSettings(command); }
    catch (error) { acknowledge('blocked', { error: error.message }); showError(error.message); return; }
    if (command.type === 'configure') {
      if (active) { acknowledge('blocked', { error: 'STOP後に部屋設定を変更してください' }); return; }
      settings = candidate;
      configureRoom();
      show('部屋設定を反映しました');
      acknowledge(ready() ? 'ready' : 'connected', { configured: true });
      return;
    }
    if (!ready()) { acknowledge('blocked', { error: 'Questでimmersive-vrを開始してください' }); return; }
    if (command.type === 'calibrate') {
      if (active) { acknowledge('blocked', { error: 'STOP後に立ち位置を合わせてください' }); return; }
      const head = new AFRAME.THREE.Vector3();
      if (preview) head.set(0, defaults.previewEyeHeightM, 0);
      else scene.renderer.xr.getCamera(scene.camera).getWorldPosition(head);
      calibration = { anchorX: head.x, anchorZ: head.z, eyeHeightM: head.y, source: preview ? 'preview' : 'XR camera world position', calibratedAtMs: Date.now() };
      settings = candidate;
      configureRoom();
      show('立ち位置合わせ完了');
      acknowledge('ready', { calibration });
      return;
    }
    if (command.type !== 'start') return;
    if (!calibration) { acknowledge('blocked', { error: '先に立ち位置を合わせてください' }); return; }
    if (active) { acknowledge('blocked', { error: 'STOP後に次の条件を開始してください' }); return; }
    if (!['sweep', 'baseline'].includes(command.mode) || !/^[A-Za-z0-9_-]{1,100}$/.test(command.runId || '')) {
      acknowledge('blocked', { error: '開始指令が不正です' }); return;
    }
    settings = candidate;
    configureRoom();
    let trajectory = null;
    try { if (command.mode === 'sweep') trajectory = APSweepStimulus.buildTrajectory(candidate); }
    catch (error) { acknowledge('blocked', { error: error.message }); return; }
    active = {
      mode: command.mode,
      command: { ...command },
      config: { ...candidate },
      calibration: { ...calibration },
      trajectory,
      samples: [],
      current: { frequencyHz: command.mode === 'sweep' ? candidate.startFrequencyHz : null, positionM: 0, velocityMps: 0 },
      countdownStartedPerf: performance.now(),
      startedPerf: null,
      startedWallMs: null,
      returning: null
    };
    applyPosition(0);
    show(`開始待機（${candidate.countdownSec}秒）`);
    acknowledge('countdown', { runId: command.runId, countdownSec: candidate.countdownSec });
  }

  AFRAME.registerComponent('ap-sweep-driver', { tick });
  scene.setAttribute('ap-sweep-driver', '');
  configureRoom();

  scene.addEventListener('renderstart', () => {
    rendered = true;
    updateDiagnostics();
    acknowledge(ready() ? 'ready' : 'connected');
  });
  scene.addEventListener('enter-vr', () => {
    calibration = preview ? calibration : null;
    const session = scene.renderer?.xr.getSession();
    session?.addEventListener('visibilitychange', () => {
      if (session.visibilityState !== 'visible') {
        stopImmediately('xr-not-visible');
        acknowledge('connected', { reason: 'xr-not-visible' });
      }
    });
    acknowledge('connected');
  });
  scene.addEventListener('exit-vr', () => { calibration = preview ? calibration : null; stopImmediately('vr-exited'); acknowledge('connected'); });
  window.addEventListener('message', event => {
    if (!preview || event.origin !== location.origin || event.source !== parent || event.data?.type !== 'ap-sweep-command') return;
    void handleCommand(event.data.command);
  });
  if (preview) {
    $('#panel').style.display = 'none';
    scene.setAttribute('xr-mode-ui', 'enabled: false');
    scene.setAttribute('embedded', '');
    parent.postMessage({ type: 'ap-sweep-preview-ready' }, location.origin);
    return;
  }

  async function connectFirebase() {
    try {
      if (!window.firebase || !window.VR_REMOTE_CONFIG?.firebase) throw Error('Firebase設定を読み込めません');
      const app = firebase.initializeApp(window.VR_REMOTE_CONFIG.firebase, 'ap-sweep-quest');
      await app.auth().setPersistence(firebase.auth.Auth.Persistence.NONE);
      const credential = await app.auth().signInAnonymously();
      user = credential.user;
      const database = app.database();
      root = database.ref(`sessions/${window.VR_REMOTE_CONFIG.sessionId}-ap-sweep`);
      database.ref('.info/serverTimeOffset').on('value', snap => { serverOffsetMs = snap.val() || 0; });
      database.ref('.info/connected').on('value', snap => {
        const wasConnected = connected;
        connected = !!snap.val();
        firebaseState = connected ? '接続済み' : '切断';
        updateDiagnostics();
        if (connected) acknowledge(ready() ? 'ready' : 'connected');
        else if (wasConnected && active) stopImmediately('firebase-disconnected');
      });
      root.child('command').on('value', snap => { if (snap.val()) void handleCommand(snap.val()); });
    } catch (error) {
      firebaseState = '接続エラー';
      showError(error.message);
      updateDiagnostics();
    }
  }

  window.addEventListener('load', () => { void connectFirebase(); }, { once: true });
  setInterval(() => acknowledge(active ? (active.returning ? 'returning' : active.startedPerf === null ? 'countdown' : 'running') : ready() ? 'ready' : 'connected'), 5000);
})();
