# Quest remote visual stimulus pilot

現在の初期表示はPC・QuestともKiemel（黒背景・白三角形3面）です。TrapVは選択肢・設定欄・再生処理から削除しました。単一sin・Baseline・CSV・既存画像の機能は残しています。旧TrapVコマンドは受け付けません。

START後は最初の5秒が静止です。その後10個の正弦波の和で動きます。元の±5°単一sinより小さい波形で、開始直後は微小な動きです。見やすくするための増幅はしていません。PCには経過秒・phase・適用角度・描画フレーム数を表示します。数値が進むか、画像も動くかを分けて確認してください。実機で動かなかった原因は未確定です。通常のA-Frame描画ループを使うブラウザ検証を追加しています。



## 2026-10-14 update

`gridfix1`: Fixed the production animation loop (TrapV dispatch and an undefined log variable), changed the semicylinder to thin black grid lines on white, and added a white surround. Historical operator selectors offered TrapV/sin and grid/room, with a separate Baseline button. Run `node tests/runtime_checks.js` and `node tests/operator_checks.js` as well as the math checks. These execute the actual runtime/operator scripts with simulated DOM/XR/GPU/Firebase boundaries without opening a browser.

See [日本語の改修結果・操作手順・検証限界](IMPLEMENTATION-ja.md) for the current behavior. Historical implementation: the operator stimulus was a configurable TrapV-like velocity profile, with a high-contrast front semicylinder and the existing room available as scene options. These are alternatives, not verified reproductions of Ghiasi/Train. Normal STOP returns to zero over two seconds; the separate emergency button resets immediately. Stop before changing trial conditions. Run `node tests/stimulus_checks.js` for the dependency-free math/path checks. The older sections below describe the original implementation; current logging includes commanded and applied software angles and monotonic timestamps, but external sensor synchronization remains unimplemented.

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

旧波形（sin / Baseline / 既存CSV）は `stimulus-engine.js`、運動の時間制御・開始終了ランプ・速度制限・STOPは `quest-runtime.js` の `stimulus-driver.tick()` です。これらは今回作り替えていません。設定ファイル編集後はPCとQuestを再読み込みしてください。キャッシュが残る場合はページのキャッシュも更新してください。

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

## Kiemel 2011仕様の追加（feature/kiemel-2011）

**提供されたKiemel2011.pdf本文（Journal of Motor Behavior 43(3), pp.239–240）と照合しました。** 数学・配置・指令処理はNodeで検証しました。ヘッドレスChromiumのWebGL描画、三条件の実シーン変換、PCプレビューと指令送信も検証しました。XRイベントとFirebaseは模擬しており、Quest実機のimmersive-vrと実通信は未検証です。既存の部屋、ノイズ、縞、sin、Baselineは維持します。TrapVは削除しました。

### 固定3面スクリーン投影（feature/kiemel-fixed-projection）

`kiemel-projection.js` が各スクリーンに対応する非対称（off-axis）投影カメラを作成します。カメラの位置は校正眼原点O、3枚のスクリーンはOから正面1.07 m／左右1.52 mの位置で固定します。投影元の仮想環境だけに運動を適用し、同じ基準眼位置から3枚のレンダーターゲットに描画します。Questの追跡カメラは、この固定スクリーンを自然に見回すために使います。頭の現在位置は投影元カメラへ渡しません。各壁のローカルu/v/法線からnear面の左右上下範囲を求めるため、正面と側面の接合線で投影の方向が一致します。ターゲット更新後はXR・描画先・viewport・scissor・autoClearを復元します。

編集箇所：`kiemel-config.js` の `projection.resolution` は各画面のテクスチャ解像度（初期1024×1024、256〜2048）。これはQuest向けの工学的設定で、論文値ではありません。固定視点の投影と固定スクリーンは原装置に近づけましたが、HMDの視野、解像度、更新頻度、両眼で仮想画面を見る光学条件、描画遅延は物理CAVEとは異なります。Quest実機でフレーム落ちと画面の接合を確認してください。原論文の60 Hzを保証する実装ではありません。

本文照合：p.239 Apparatusで距離・60 Hz・500図形/壁・辺長・30 cm空白・固定平均眼位置、p.240で10成分の式、A=0.02 deg Hz、正方向、股関節/Translation換算、5+250+5秒を確認しました。脚長・眼高は入力実測から算出します。式の振幅は変更していません。250秒を1 ms間隔で計算した足関節基準角は約±1.291147°（数値標本の極値、連続時間の厳密な極値ではありません）、RMS約0.661974°です。

本文の実験運用は各条件4試行、3条件を1回ずつ含むブロック内で無作為化、足先間隔は身長の11%、両足の角度14°です。このアプリは条件を手動選択し、自動ブロック無作為化・姿勢計測・足位置拘束は実装しません。条件数や姿勢の設定まで自動再現したと扱わないでください。

ログでは `applied_deg` は論文の正前方角度、`translation_z_m` / `eye_linear_z_m` / `eye_exact_z_m` はA-FrameのZ成分（前方が負）です。旧版ログは正方向が逆です。`layoutSettings.projection.method='fixed-screen-offaxis'` とresolutionを保存して旧版と区別します。PDFはリポジトリへ転載していません。照合資料SHA-256: `81db6f1067d6d5033f2cdebb797cdfcb20399c4e6f2914a7fd1b05b57583a676`。

### ファイルと変更する値

| 役割 | 編集箇所 |
| --- | --- |
| 設定・復元基準 | `kiemel-config.js` の `referencePreset`（固定の基準）と `CONFIG`（編集用コピー） |
| 壁までの距離 | `CONFIG.geometry.frontDistance=1.07`、`sideDistance=1.52`。単位m |
| 壁の幅・高さ・側壁の奥行き | `frontWidth=3.04`、`wallHeight=2.5`、`sideDepth=2.14`。接続には `frontWidth=2*sideDistance` が必要 |
| 三角形の寸法・個数 | `pattern.triangleSidesM=[.034,.034,.030]`、`countPerWall=500` |
| 配置・中央空白・注視点 | `pattern.seed`、`centralBlankRadius=.30`、`fixationPoint=false` |
| 将来の図形変更 | `pattern.type='polygon'` と `verticesM`（非退化の凸多角形）。生成入口は `kiemel-environment.js` の `shape()` |
| 身体寸法と回転中心 | PCのKiemel専用入力欄。mに変換した `body.ankleHeight` / `hipHeight` / `eyeHeight` |
| 条件 | `motion.type`: `translation` / `ankle` / `hip`。PCで選択可能 |
| 共通振幅 | `motion.amplitudeDegHz=.02`、`amplitudeScale=1`。3条件の独立振幅は設けない |
| 周波数 | `frequencyNumerators` / `frequencyDenominator`。第8成分以降の振幅は `capAfter` に従う |
| 時間 | `preSeconds=5`、`duration=250`、`postSeconds=5`。短縮ボタンは125秒の刺激 |
| 波形・座標変換 | `kiemel-motion.js`（純粋計算）。実際の環境全体への適用は `quest-runtime.js` の `applyKiemel()` |
| 表示と配置検査 | `kiemel-environment.js`。3壁と固定図形を一度生成して再利用 |

編集例は `kiemel-config.js` の `CONFIG` 直下にコメントで示しています。`referencePreset` は凍結され、`KiemelConfig.restore()` はその新しいコピーを返します。PCの「Kiemel基準設定へ復元」は幾何・図形・運動・時間を基準に戻し、被験者の入力欄は維持します。編集後はPC・Quest双方を再読み込みし、身体寸法変更時は再校正してください。

### 幾何・校正

校正時の左右眼ビューのワールド位置の平均を眼基準原点Oとして固定します。ステレオの行列が取得できない場合はXRカメラ位置を使い、その方式をログに記録します。時間方向の平均化はしていません。校正後は頭の動きに合わせてOや壁位置を更新せず、Questの頭部追跡と各眼の描画を維持します。前方は−Z、右は+X、上は+Y。校正時は正面（アプリの−Z）を向いてください。視線方向への自動ヨー位置合わせは追加していません。

| 壁 | 眼基準の中心[m] | 面の向き | 初期寸法[m] |
| --- | --- | --- | --- |
| 正面 | `(0,0,-1.07)` | XY面 | 幅3.04、高さ2.5 |
| 左 | `(-1.52,0,0)` | YZ面 | 奥行き2.14、高さ2.5 |
| 右 | `(+1.52,0,0)` | YZ面 | 奥行き2.14、高さ2.5 |

側壁はZ=−1.07から+1.07まで続き、正面の左右端と一致します。上下は眼基準のY=±1.25です。**高さ2.5 m、奥行き2.14 m、上下を眼の周りに対称に置くことは実装上の仮設定で、原論文の測定値とは主張しません。** 距離1.07 m／1.52 mとは別の値です。頂点データはmで作成し、描画バッファのFloat32精度に伴う微小な丸めはあります。

黒い壁に白い三角形を各500個。辺長はテクスチャの見かけのピクセル数ではなくメートルの頂点から構成します。全頂点が壁内にあり、図形同士が重ならず、正面の円形空白に辺・内部を含めて侵入しないことを確認して採用します。収容できない指定はエラーとし、個数や寸法を自動で減らしません。壁と図形は同じ幾何平面上で、黒背景材質の深度オフセットによりz-fightingを避けます。白い図形自体を前方へ移す補正はありません。

乱数シードは12345。条件・被験者寸法・注視点ON/OFFの変更では配置を変えません。配置条件（壁寸法・図形寸法・個数・seed等）が変わったときだけ再生成します。指紋は非暗号学的な配置識別値です。注視点は初期OFF。ON時の直径5 mmは便宜的な設定で論文値ではありません。

入力は眼・股関節・足関節の実測高さ（cm）。`0≤足関節<股関節<眼` を検証し、推測値を補いません。`l1=hipHeight-ankleHeight`、`l2=eyeHeight-hipHeight`、`H=l1+l2`。眼の入力値とQuestが追跡する床上高さの差も表示・記録します。身体寸法が変わるとSTARTを拒否して再校正を要求します。

### 波形と変換

`f=[3,7,13,23,43,73,113,179,263,367]/125 Hz`、`A=.02 deg*Hz`。

```text
v_a(t) = amplitudeScale * Σ(j=1..10) (-1)^j * A_j * sin(2π f_j t)
A_j = A/f_j (j≤8), A/f_8 (j=9,10)
theta_a = π/180 * v_a(t)
theta_h = H/l2 * theta_a
d_translation = H * theta_a [m]
```

論文の正方向は前方回転です。論文の角度は正を前方として記録し、A-Frameでは **負のX軸回転・−Z変位** に変換します。環境の点Pに対する眼基準の変換：

```text
Ankle:     C_a=(0,-H,0),  P'=C_a+Rx(-theta_a)*(P-C_a)
Hip:       C_h=(0,-l2,0), P'=C_h+Rx(-theta_h)*(P-C_h)
Translation:             P'=P+(0,0,-d_translation), rotation=0
Questワールド座標:       O+P'
```

三角形ごとの回転ではなく、投影元の3壁と全図形を一体の環境として変換します。観察するスクリーン自体は動かしません。条件変更時の静止姿勢はすべて同じです。回転中心のワールド座標もログに保存します。

線形近似での眼位置相当のA-Frame Z変位はすべて `-H*theta_a` です。厳密な変位は `-H*sin(theta_a)`、`-l2*sin(theta_h)`、`-H*theta_a` なので有限角では等しくありません。指定式を変えて無理に一致させることはしていません。誤差はそれぞれ `H*|theta_a|³/6`、`l2*|theta_h|³/6` 以下で、身体寸法・共通倍率によって変わります。保守的な上界も `motionSettings.approximationBounds` に記録します。

### 時間・停止・操作

START受信・準備完了時の `performance.now()` をt=0とし、`[0,5)` は静止、`[5,255)` に `v_a(t-5)` を適用、`[255,260)` は静止、その後終了します。フレーム数で波形の時間を進めません。Kiemelには従来の3秒待機・1.5秒ランプ・角速度制限を適用しません。既存モードの処理は維持します。

任意の短縮時間で切り捨てて終端角を0へ跳ばすことは避け、終端波形が0でない指定を拒否します。初期の共通周期は125秒なので、短縮ボタンは5＋125＋5=135秒です。周波数を速めて短縮する実装ではありません。通常STOP時だけ2秒で静止姿勢へ復帰し、緊急STOP・VR終了・非表示・切断等では停止します。STOPによる復帰部分は原波形とは別で、`returning` と記録します。Baselineは同じ環境・時間設定で静止、元のBaseline操作も維持します。

PCで「Kiemel」を選択 → 身体寸法入力 → Quest標準VRボタン → 位置合わせ → 3条件のいずれかを選択 → START → 終了またはSTOP。身体寸法と共通倍率をそろえて比較してください。Kiemel専用欄を使い、単一sin欄の角度・周波数・再生時間は使いません。PCプレビューはFirebaseの認証・状態・ログを書き換えず、同期精度や実機描画を保証するものではありません。

### ログ・検証結果・残る相違点

Kiemelログは `kiemel`（全設定）、`kiemelCalibration`（眼原点・身体寸法等）、`patternSettings`（個数・seed・配置指紋）、`layoutSettings`（3壁の中心・基底・寸法）、`motionSettings`（軸・中心・誤差上界）、`timingSummary` を保存します。サンプル列は `sampleColumns` に定義し、角度[deg]・環境のZ平行移動[m]・足関節基準角・眼位置相当の線形／厳密変位・phaseを分けます。回転時の環境の剛体並進成分と、Translation条件の `translation_z_m` は別概念です。後者は回転条件では0です。CSVは旧ログと新ログの列を名前で統合し、不足列を空欄にします。

`node tests/kiemel_checks.js` は1500個すべての境界・中央空白・非重複と三角形の辺長、壁の距離・接続、乱数再現性、周波数・符号・単位・回転中心・時間境界を検証します。テスト身体寸法は眼1.60 m・股関節0.90 m・足関節0.08 m（実被験者値ではない）。0～250秒を1/240秒間隔、60,001点で調べた結果：

| 検証 | 結果 |
| --- | --- |
| 線形近似の3条件の最大差 | 0 m |
| 厳密な足関節回転とTranslationの最大差 | 約0.002899 mm |
| 厳密な股関節回転とTranslationの最大差 | 約0.013667 mm |
| Translationの回転角 | 常に0 |
| 各回転中心 | 変換で不変 |
| 60/72/90/120 Hz相当の同一時刻 | 同じ波形値 |

`node tests/runtime_checks.js` は本番の指令・tickを模擬DOM/XRで実行し、3変換、眼原点の固定、同一配置、260秒の区間、STOP／緊急停止／Baseline、身体変更拒否とログを確認します。`node tests/operator_checks.js` は単位変換・条件送信・共通倍率・復元・短縮・混在CSVを検証します。これらNode検証はGPU／Quest実測ではありません。

`tests/kiemel_browser_checks.py` は既存のA-Frame 1.7.0バンドルを使い、ヘッドレスChromium（ソフトウェアWebGL）の黒白描画、1,500三角形、標準VRボタン、実シーンの三条件の変換、PCプレビューと指令送信を確認します。XR状態とFirebaseは模擬境界です。Quest実機・実Firebase通信・光の提示時刻は検証しません。

提示仕様と合わせた項目：眼からの距離、3壁の直角・接続、図形個数・辺長・黒白・空白、指定波形と条件間換算、初期5＋250＋5秒。本文で特定できない値／移植差：壁の縦横寸法・上下配置・seed・注視点サイズ、原装置とQuestの視野・光学系・立体描画・遅延・リフレッシュ周波数、校正手順。原装置60 Hzという本文の条件に対し、Questの周波数を60 Hzに固定していません。足関節・股関節の前後左右位置は頭の真下とする近似で、解剖学的な関節位置の実測ではありません。XR公称値が取得できれば保存し、実際のアプリのサンプル間隔・平均Hz・最大間隔も記録します。光の提示時刻や床反力計／IMUとの同期を測定したログではありません。

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
