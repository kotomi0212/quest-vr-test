# Quest remote visual stimulus pilot

## 2026-10-14 update

See [日本語の改修結果・操作手順・検証限界](IMPLEMENTATION-ja.md) for the current behavior. The default operator stimulus is now a configurable TrapV-like velocity profile, with a high-contrast front semicylinder and the existing room available as scene options. These are alternatives, not verified reproductions of Ghiasi/Train. Normal STOP returns to zero over two seconds; the separate emergency button resets immediately. Stop before changing trial conditions. Run `node tests/stimulus_checks.js` for the dependency-free math/path checks. The older sections below describe the original implementation; current logging includes commanded and applied software angles and monotonic timestamps, but external sensor synchronization remains unimplemented.

`operator.html` controls `quest.html` through Firebase Realtime Database. GitHub Pages publishes `main`. Use the existing URLs; the Quest URL needs no query string.

## Headset check

1. Reload `https://kotomi0212.github.io/quest-vr-test/quest.html` in Quest Browser. Confirm the furnished room and the standard VR button appear. Press the standard button once.
2. Reload the PC operator page and sign in with the existing experimenter account. Confirm **3D: 描画中**, **immersive-vr: 開始済み**, and **Firebase: 接続済み**. Use **立ち位置を合わせる** while standing upright in the experiment position.
3. Start a short sine trial, then press STOP. The room should become static while the headset remains in VR. Start another trial without leaving VR. Download the Quest JSON log if needed.

If initialization fails, report the visible startup error and the PC diagnostic line. Do not infer an immersive session from fullscreen alone. After exiting/reentering VR or reconnecting Firebase, calibrate again before START.

## Initialization and experiment behavior

A-Frame 1.7.0 waits for `document.readyState === 'complete'` before initializing its elements. Firebase SDK downloads begin only after this state so slow or failed Firebase loading cannot stall scene initialization or standard `xr-mode-ui` creation. The scene component and events are registered before inserting the template into the document.

Readiness requires a rendered scene, `renderer.xr.isPresenting`, a non-null XR session, and A-Frame's VR state (excluding AR). The application checks current state on events, frames, and a short interval; an `enter-vr` event or desktop fullscreen alone cannot permit START. The cloud regression suite simulates only the XR boundary, so it does not establish success on a physical headset.

The PC preview uses the same scene through an internally configured iframe. It receives origin- and source-checked messages from the operator page. It never loads Firebase configuration/SDKs, initializes auth, subscribes to commands, writes headset status, or uploads logs. Preview timing and camera direction are illustrative and do not measure the headset presentation. Quest anonymous authentication uses a named app and in-memory persistence to avoid replacing the operator's persisted login.

Commands target the current Quest load/connection ID. Old START/calibrate commands, commands older than 15 seconds using the Firebase server time offset, and duplicate sequence numbers are rejected. STOP remains available from a stale PC. Pending CSV reads and countdowns are cancelled on STOP, replacement, VR exit, graphics loss, visibility loss, or disconnect. Uploading a completed log does not delay stopping or replacing a trial. A 5-second status heartbeat lets the PC detect stale connectivity.

The furnished room is an approximation inspired by the modern room in Ghiasi Noughaby 2026, not an exact reproduction. Rotation is around the global x axis in the sagittal plane about the calibrated ankle pivot. Ankle x/z approximate the point beneath the tracked head, not a measured anatomical ankle location. Height is recorded, eye height controls the PC preview, and ankle height controls the pivot. STOP returns the room to zero rotation and does not end the VR session. Wall-clock timestamps are not synchronized with external sensors.

## Local development and validation

No production package installation or build is required. Serve the checkout with Python 3:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Desktop localhost supports development; a headset needs the published HTTPS site or another trusted HTTPS origin.

The regression suite requires Python Playwright and Chromium. Install Playwright into a development virtual environment if needed, and set `CHROMIUM_PATH` if Chromium is not at `/usr/bin/chromium`:

```sh
node --check quest-runtime.js
node --check operator.js
python3 tests/browser_checks.py
```

The suite fetches the pinned official A-Frame 1.7.0 bundle with TLS verification, runs its real scene and WebGL renderer using Chromium/SwiftShader, and uses test-only Firebase and XR state boundaries. No real Firebase experiment commands, authentication requests, or status/log writes are sent. It covers rendering, standard VR UI, delayed/failed Firebase loading, XR event order, reentry/calibration, sine/baseline/CSV playback and logs, pivot geometry, CSV cancellation, stale commands/reloads/reconnects, duplicates, graphics loss, nonblocking log upload, and preview isolation/PC feedback.

Real Quest WebXR entry, controller interaction, tracking accuracy, actual Firebase permissions, stimulus timing, and research validity still require device/backend checks. Do not treat software WebGL or mocked XR results as a physical headset result.
