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

## 平面パターンの比較（feature/visual-patterns）

PCの「映像パターン」で次の3条件を選択できます。停止中の選択変更、または「選択した映像をQuestへ反映」で適用します。静止した模様だけを切り替え、TrapV・sin・Baseline・既存CSVの運動計算、足首中心の回転、開始終了ランプ、速度制限、通常STOP・緊急停止は共通です。試行・待機・CSV読込・Baseline復帰中の映像変更は拒否します。

| パターンID | 内容 |
| --- | --- |
| `noise-1f` | 空間周波数に対する振幅1/f（パワー1/f²）。静止したグレースケール画像。乱数シード `20261020` 固定 |
| `stripes-high` | 縦の矩形波ストライプ、Michelsonコントラストの設定値100% |
| `stripes-low` | 同じ向き・間隔・位相・平均線形輝度のストライプ、設定値10% |

3条件とも、キャリブレーションした頭の真下のX/Zを基準に、正面3 m、幅6 m×高さ4 m、中心の床上高さ1.6 mの**同一の平面**へ表示します。画面は実験空間の前方向（−Z）に置かれ、頭の向きに追従するHUDではありません。足首のX/Zを頭の真下で近似する従来の制限は変わりません。縞は白黒1組が25 cm（各帯12.5 cm）。距離や寸法の変更で視角・空間周波数が変わるため、比較時はこれらと運動条件・位置合わせを固定してください。

設定・ラベル・生成処理は **`stimulus-patterns.js`** に集約しています。`screen` が画面配置、`stripePeriodM` が縞の周期、`definitions` が各条件、`textureSize` が画像解像度です。同種の条件追加は `definitions` に追加すればPCの選択肢にも反映されます。別種の模様を追加する場合は同じファイルの `pixels()` も拡張します。運動計算は `stimulus-engine.js` のままです。互換用の `grid`（半円筒）と `room` も残し、初期選択は従来どおり `grid` です。旧 `checker` / `stripes` 指令は従来の `grid` として扱います。

ノイズは512×512の共役対称フーリエ係数にランダム位相と1/f振幅を与え、逆FFTで生成します。周波数は平面のメートル寸法を考慮し、DC成分を除きます。生成場の平均を0、絶対最大値を1に線形正規化してから `L=0.5+0.5×場` とします。クリッピングやヒストグラム変換は行いません。有限解像度の周期画像であり、表示可能な周波数帯域には限りがあります。

ストライプの目標線形輝度は、高が0/1、低が0.45/0.55です。sRGBに符号化したテクスチャと非トーンマップ材質を使い、室内照明に模様のコントラストが左右されないようにしています。8-bit量子化により、低のデジタル値は約0.4508/0.5520、コントラスト約10.094%、平均約0.5014となります。**これらはソフトウェア上の値であり、Questの実測輝度や実測コントラストではありません。** 研究で輝度値を指定する場合は機器での測光・校正が別途必要です。ノイズのRMSコントラストは縞の条件とは一致させていません。

テクスチャは条件ごとに初回だけ生成し、再選択時は同じ画像を再利用します。描画ループでは模様を再生成しません。平面は2三角形で、既存のA-Frame/Three.jsを利用し、依存パッケージの追加はありません。PCプレビューも同じ定義を使用し、Firebaseの認証・状態・ログを書き換えません。

各試行のJSONおよびCSVの `metadata_json` に、パターンIDと `patternSettings` を保存します。設定バージョン、画面寸法、コントラスト・縞周期またはノイズシード・指数、テクスチャ解像度、デジタル輝度統計を記録します。従来の角度サンプル列は変更していません。

追加検証:

```sh
node tests/pattern_checks.js
node tests/stimulus_checks.js
node tests/runtime_checks.js
node tests/operator_checks.js
python3 tests/pattern_browser_checks.py
```

ブラウザテストは従来と同じPython Playwright・Chromiumを使います。公式A-Frame 1.7.0の配布ファイルをTLS検証付きで取得して使用します。既に検証済みの公式バンドルがある場合は `AFRAME_BUNDLE_PATH=/path/to/aframe.min.js` を指定すると、制限されたネットワークでも同じライブラリで実行できます。

数値テストは独立のDFTによる1/f振幅・固定シード・線形コントラストを確認します。ブラウザテストは実A-Frame/WebGLで3条件の平面形状、描画色、共通運動、停止中切替、ログ、PCプレビューを確認します。FirebaseとXRセッション境界は模擬であり、本番データの書き換えは行いません。Quest実機での動作・フレームレート・表示タイミング・測光値は未検証です。

実機確認時は、標準VRボタン → 位置合わせ → 条件選択 → 同じ運動設定でSTART → STOP → 次の条件、の順に比較します。`feature/visual-patterns` の作業だけでは main やGitHub Pagesには反映されません。

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
