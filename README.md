# Quest remote visual stimulus pilot

## 2026-10-14 update

`gridfix1`: Fixed the production animation loop (TrapV dispatch and an undefined log variable), changed the semicylinder to thin black grid lines on white, and added a white surround. Operator selectors now offer TrapV/sin and grid/room, with a separate Baseline button. Run `node tests/runtime_checks.js` and `node tests/operator_checks.js` as well as the math checks. These execute the actual runtime/operator scripts with simulated DOM/XR/GPU/Firebase boundaries without opening a browser.

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

## 自分で調整するための部品分け（feature/pattern-layout-config）

初期値は従来と同じです。正面3 m・6×4 m・中心高さ1.6 mの平面、512×512 pxの模様、縦縞24組（幅6 mなら1組25 cm）、既存の足首近似の位置合わせとX軸回転を維持します。依存ライブラリの追加、部屋全体の作り替え、股関節の自動推定は行っていません。

### どこを編集するか

| やりたいこと | ファイル・編集箇所 |
| --- | --- |
| 1. 模様を生成する | `stimulus-patterns.js` の `generate(id)`。画像生成だけで、配置・カメラ・運動は読み込まない |
| 2. 模様の値を調整する | `pattern-config.js` の `patternConfig.patterns` |
| 3. 表示面の配置を変える | `layout-config.js` の `layoutConfig.plane` |
| 4. 壁の位置・寸法・距離・向きを変える | `positionM`、`widthM` / `heightM`、`rotationDeg`。正面距離は `positionM.z` の負値 |
| 5. 表示する模様を切り替える | PCの「映像パターン」→「反映」。初期の選択肢は `patternConfig.defaultPattern`（選択後の反映が必要） |
| 6. 回転軸・足関節／股関節の中心を指定する | `motion-config.js` の `motionConfig.rotationAxis` と `pivot`。実際の適用入口は `quest-runtime.js` の `rotationPivot()` / `rotate()` |

波形（TrapV / sin / Baseline / 既存CSV）は `stimulus-engine.js`、運動の時間制御・開始終了ランプ・速度制限・STOPは `quest-runtime.js` の `stimulus-driver.tick()` です。これらは今回作り替えていません。設定ファイル編集後はPCとQuestを再読み込みしてください。キャッシュが残る場合はページのキャッシュも更新してください。

### patternConfig：画像そのもの

`width` / `height` は**ピクセル数**です。VR空間で何mの面に貼るかとは別です。

| 共通／種類 | 設定 | 意味 |
| --- | --- | --- |
| 共通 | `width`, `height` | 2～1024 px。ノイズは各辺2の累乗。横長画像にも対応 |
| 共通 | `brightness` | 平均線形輝度の目標値、0～1 |
| 共通 | `contrast` | 0～1。縞ではMichelsonコントラスト、ノイズではpeak正規化場の変調量 |
| ノイズ | `spectralSlope` | 振幅が `f^spectralSlope`。−1なら1/f、パワーは1/f² |
| ノイズ | `spectralAspect` | 画像の周波数座標の横/縦比。初期値1.5。配置変更では変わらない |
| ノイズ | `seed` | 0～4294967295の整数。同じ値なら同じ静止画像 |
| 縞 | `orientation` | 度。0=縦縞、90=横縞。斜めも指定可能 |
| 縞 | `stripeCount` | 明暗1組の数。0度なら幅方向、90度なら高さ方向 |

輝度は `L=brightness*(1+contrast*模様)` です。ノイズは平均0・絶対最大値1に線形正規化した場、縞は±1を使います。意図しない白飛びを避けるため `brightness*(1+contrast)≤1` が必要で、範囲外はエラーにします。初期の高コントラストは0/1、低は0.45/0.55。8-bit sRGB量子化後の低コントラストは約10.094%です。実機の測光値ではありません。

例：`pattern-config.js` 内の `noise-1f` を `width: 512, height: 256, spectralSlope: -1.2, brightness: 0.4, contrast: 0.8, seed: 42` にすると、横長で指数・明るさ・コントラストを変えた静止画像になります。`stripes-low` の `orientation: 90, stripeCount: 12` は横縞12組です。

画像生成だけを使う場合は、`pattern-config.js` → `stimulus-patterns.js` の順に読み込み、`StimulusPatterns.generate('noise-1f')` を呼びます。戻り値は `{width, height, rgba, statistics, metadata}`。Canvasの `ImageData` へそのまま渡せるRGBA配列で、A-Frameは不要です。

### layoutConfig：どこに貼るか

`layout-config.js` の例：

```js
plane: {
  widthM: 6, heightM: 4,
  positionM: { x: 0, y: 1.6, z: -3 },
  rotationDeg: { x: 0, y: 0, z: 0 }
}
```

単位はm／度。+Xが右、+Yが上、−Zが前です。`positionM` は面の中心で、幅や高さはVR上の実寸です。`rotationDeg` は貼る面自体の初期姿勢で、刺激運動の回転軸とは別です。正面5 mに置くなら `z: -5`、幅8 mなら `widthM: 8` を変更します。

`anchor: 'calibrated-xz'` では、位置合わせした頭の真下のX/Zを配置原点にし、Yは床基準です。`anchor: 'world'` ならアプリのワールド原点を使います。カメラに追従するHUDではありません。床と追跡原点の精度は実機で確認してください。

配置を変えても生成画像のRGBA値は変わりません。逆に、画像のピクセル数を変えても表示面のm寸法は変わりません。ただし面を拡大・縮小すると物理的な縞の間隔や視角・空間周波数は変わります。ノイズの `spectralAspect` は画像側に固定してあるため、面だけ違う縦横比にすると模様も引き伸ばされます。

互換用の半円筒は `layoutConfig.cylinder`、既存の家具・壁の部屋は `quest.html` の `#room-pattern` に残しています。今回、部屋全体を設定システムへ移す大きな変更はしていません。

### motionConfig：最小限の軸・中心

```js
rotationAxis: { x: 1, y: 0, z: 0 },
pivot: {
  mode: 'calibrated',
  positionM: { x: 0, y: 0.088, z: 0 },
  offsetM: { x: 0, y: 0, z: 0 }
}
```

`rotationAxis` は軸の方向（実行時に正規化）。Xは前後傾斜、Yは鉛直軸周り、Zは左右傾斜です。ゼロベクトルは使えません。`pivot.mode: 'calibrated'` は既存のPC位置合わせ結果、`'fixed'` は `positionM` の固定点を回転中心にします。どちらにも `offsetM` を加えます。固定点の単位・原点はアプリのワールド座標です。

例：手動で決めた中心 `(0, 1.0, 0)` の周りで回したければ `mode: 'fixed', positionM: {x:0,y:1.0,z:0}`。これは股関節位置の測定・推定ではありません。校正した点から高さだけをずらすなら `mode: 'calibrated'` と `offsetM.y` を使います。軸の設定値と配置の基準点は独立しており、中心を変えても配置原点は変更しません。

将来、実測した足関節や股関節座標を使う場合は、`rotationPivot()` に測定点を渡す処理を追加するのが入口です。`rotate()` が軸・中心に基づく親ノードの変換を適用します。自動推定や新しい運動モデルは今回は追加していません。既存の足首X/Zを頭の真下で近似する制限は残っています。

### 保存・検証

各試行には `patternSettings`（画像）、`layoutSettings`（配置と配置原点）、`motionSettings`（軸・中心と解決済み座標）を分けて記録します。従来の角度サンプル列は維持します。JSONログとCSVの `metadata_json` に含まれます。画像キャッシュはページ内で再利用し、設定の編集は再読み込み時に反映します。

```sh
node tests/pattern_checks.js
node tests/stimulus_checks.js
node tests/runtime_checks.js
node tests/operator_checks.js
python3 tests/pattern_browser_checks.py
```

ブラウザ検証には既存のPython Playwright／Chromiumを使います。公式A-Frame 1.7.0バンドルをTLS検証付きで取得します。取得済みの検証済みバンドルは `AFRAME_BUNDLE_PATH=/path/to/aframe.min.js` で指定可能です。画像調整、矩形ノイズ、配置変更で画像が変わらないこと、任意の固定中心とY軸回転、従来の初期値・停止処理・PC操作を確認します。FirebaseとXR境界は模擬であり、本番データには書き込みません。Quest実機の動作・表示タイミング・輝度は未検証です。

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
