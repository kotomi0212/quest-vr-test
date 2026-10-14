# 改修結果・実験前の確認（2026-10-14）

## 実機報告を受けた修正（gridfix1）

前版の描画ループにTrapVの呼び出しがなく、ログに未定義のcommanded変数を使用していたため、刺激再生で実行時エラーが起きる不備があった。Stimulus.angleを共通描画ループから呼び、指令角度・適用角度・開始終了包絡・速度制限を接続し直した。以前の単体テストだけではこの接続不備を検出できていなかった。

添付図と指示に合わせ、模様は市松模様から「白地に細い黒の縦横線」へ変更。半径1m、半円周方向32分割・高さ6m方向60分割で、約10cm間隔、線幅は各間隔の16%。細かい寸法は論文から復元したものではない。半円筒外の周囲には白いskyを配置し、頭の向きで黒い空白が見えるのを避ける。格子の位置はキャリブレーションした頭の真下のX/Zに合わせる。停止中の映像選択または位置合わせで反映できる。

操作画面の刺激セレクターはTrapV / sinのみ。静止条件は独立のBaselineボタン。映像セレクターは黒格子の半円筒 / 既存部屋のみ。CSV入力UIは取り除いたが、既存データ用のバックエンド再生・ログCSV出力は維持。以下の旧記述で市松・縦縞の選択やCSV読込操作について述べる箇所はこの修正で置き換えられる。

node tests/runtime_checks.js は実際のquest-runtime.jsの指令受信とtickを実行し、TrapV・sin・既存CSVの非零回転、通常STOP、緊急STOP、格子生成、白い周囲、停止中切替を検証。node tests/operator_checks.js は実際のoperator.jsのDOM参照と各指令を検証。どちらもDOM/GPU/XR/Firebase境界は模擬であり、ブラウザやQuestは起動しない。WebXR上の見た目・追跡・表示タイミングは引き続き実機確認が必要。

## リポジトリ調査

- ルート: `C:/Users/atvma/gitseguchi/quest-vr-test`
- remote: `git@github.com:kotomi0212/quest-vr-test.git`、ブランチ: `main`。
- operator.html → quest.html?preview=1 は同一ディレクトリの相対参照。JS・設定・標準CSVもルート配置。旧リポジトリURLへの依存は確認されず。
- index.html は既存の赤い点のデモ、engel/index.html は別デモ。互換性のため変更していない。実験には quest.html / operator.html を明示指定。
- Firebase: `quest-remote-pilot`、asia-southeast1 の既存RTDB、`sessions/pilot-20261012`。設定・認証方式・本番ルールは変更していない。同じsessionIdでは複数Questを同時運用しない。
- GitHub Pagesの管理画面/APIは未確認。Settings → Pages が「Deploy from a branch / main / (root)」なら下記URLになる。docs公開やActions設定の場合は実際の設定確認が必要。
- PC: https://kotomi0212.github.io/quest-vr-test/operator.html
- Quest: https://kotomi0212.github.io/quest-vr-test/quest.html
- commit/push・公開は未実施。公開先にはまだ改修は反映されていない。

## 使用手順

1. Quest BrowserでQuest URLを開き、床設定・実験位置を確認し、標準VRボタンを一度押す。PCからWebXRセッションを自動開始しない。VR退出後は再入場操作が必要。
2. PC URLで既存Firebase実験者アカウントにログイン。PC Firebase接続、Quest状態、immersive-vr、3D描画を確認する。
3. 身長の実測値を入力。目高入力はPCプレビュー専用。足首高さは必要なら身長×0.039で仮推定し、実測等に基づいて手動補正。この係数は本実装の便宜的仮定であり、検証済み人体計測モデルではない。
4. 被験者が直立して正面を向いた状態で「立ち位置を合わせる」。Questの床基準目高、足首補正値を確認。足首X/Zは頭の真下で近似され、解剖学的実測ではない。local-floorを要求するが、実機の床原点精度は検証すること。
5. 映像を半円筒チェッカー・縦縞・既存部屋から選ぶ。刺激の既定はTrapV型。振幅A、最大速度V、加減速時間r、保持時間h、試行時間を設定し、波形プレビューを確認。
6. STARTで3秒待機後に再生。Baselineは専用ボタンでも開始可能。実行中の条件置換は拒否し、STOPしてから次の条件を開始する。キャリブレーションも停止中に行う。
7. 通常STOPは2秒で0°へ戻る。緊急停止は即時0°。VR退出・非表示・描画消失・Firebase切断も停止する。VRセッション自体はSTOPでは終了しない。
8. CSVは time_s,angle_deg の2列。原点(0,0)開始、時刻昇順、2～20000点。ローカル選択した点列を指令に含めるか、公開ルートのCSVファイル名を指定。線形補間し、最終時刻以後は最終角度を保持する。
9. 試行終了後にJSONまたはCSVログを取得。通信エラーによるログ保存失敗は画面表示されるが、現状は永続ローカルバックアップがないため欠測に注意する。

## 刺激の定義と出典

Ghiasi Noughaby et al. (2026), DOI: https://doi.org/10.1152/jn.00258.2025
研究室の説明 https://polarlab.ca/research/vision-pc/ ではTrapVおよびML-TrapVによる振幅・速度の独立操作を確認。出版社本文は取得できず、数値・時間配列・ML-TrapVは再現していない。

本実装は速度を0→Vへr秒で線形増加し、A/V−r秒一定速度、その後r秒で0へ減速する。その積分が角度。0→A、h秒保持、A→0、h秒保持を反復する。移動時間=A/V+r、周期=2(A/V+r+h)。既定値A=5°、V=2°/s、r=0.5s、h=1sなら周期8秒。角度が台形という意味ではない。正弦波も互換モードとして残す。

参考論文をAssländer, Albrecht, Gruber & Peterka (2025), “Is It Me or the Train Moving? Humans Resolve Sensory Conflicts with a Nonlinear Feedback Mechanism in Balance Control”, Journal of Neuroscience, DOI: 10.1523/JNEUROSCI.2303-24.2025 と特定。本文 https://pmc.ncbi.nlm.nih.gov/articles/PMC12268977/ のMethodsは半径1mの高コントラスト半円筒と床上8.8cmの回転中心を記載。これに合わせ半径を1m、足首高さのUI初期値を8.8cmへ修正（手動補正と身長ベース仮推定は引き続き可能）。論文の装置はHTC Vive Pro Eye / Unity / SteamVRであり、Quest版との同等性は未検証。半円筒は半径1m、高さ6m、Y中心2m、正面−Z側180°、16×16白黒チェッカーまたは縦縞の代替仕様。固定テクスチャと単一メッシュ、mipmapと異方性フィルタを使用。縦縞はピッチの垂直運動を示す特徴が少ないため、まずチェッカーで確認する。頭位置を移動すると半円筒に対する中心位置も変わる。固定寸法を身長に応じて自動スケールしない。

既存部屋・半円筒とも同じvisual-worldに配置し、P'=A+Rx(θ)(P−A)を適用。頭部の回転・並進は刺激で変更しない。+Xが右、+Yが上、正面は−Z。正角度は右手系X回転で正面の点を上へ、目より上の点を+Z（被験者側）へ動かす。身体反応方向を保証するものではない。

ソフトウェア上限は角度20°、速度30°/s、正弦波周波数2Hz、試行5～600秒。医療的・倫理的な安全閾値ではない。開始終了1.5秒の包絡と描画ごとの速度制限により、指令と適用波形は一致しない場合がある。加速度全般やジャークの上限は未実装。緊急停止は不連続になり得る。監視と物理的な転倒防止措置を前提に低条件から検証する。

WebXR仕様: https://www.w3.org/TR/webxr/ 。immersiveセッションの要求はユーザー操作が必要。既存の標準VR UIと実セッション状態判定を維持。

## ログと同期の限界

JSONは指令条件、CSV点列、身長・測定目高・推定足首高・手動足首高、足首XYZ、開始終了のQuest時計、終了理由を保存。sampleColumnsで列を定義し、elapsed_ms / applied_deg / commanded_deg / performance_ms / epoch_estimate_ms をフレーム単位で記録する。performance.timeOriginとFirebase時刻補正値も保存する。appliedは描画オブジェクトに設定した角度であり、光学計測された表示角度ではない。

CSV出力にはメタデータJSONを各サンプル行に含む。外部IMU・床反力計とのハードウェア同期・時刻誤差評価は未実装。Firebase時刻補正は高精度同期を保証しない。停止時の最終0°設定は別フレームサンプルに記録されない場合がある。

## 検証

- 成功: node --check（3 JS）、node tests/stimulus_checks.js。TrapVの積分・周期・最大速度、CSV補間と不正入力拒否、既存CSV受入、回転中心不変、ローカルスクリプト参照を確認。
- テスト内の浮動小数点完全一致は誤差許容比較に修正して再実行。
- 既存tests/browser_checks.pyは通常STOPの漸近復帰と停止後再試行に合わせて更新。今回はブラウザ起動禁止の指示に従い未実行。
- 未検証: PC表示の見た目、実WebGL上の半円筒の向き・視野・ちらつき・負荷、実Quest VR開始・床追跡、実Firebase伝達・権限・切断検知時間、実表示の周波数と遅延、ログ容量上限、Pages設定。
- 切断検出はFirebaseの接続通知に依存し、独立したPC生存監視は未実装。PCだけが切断してもQuestは試行時間まで動作し得る。
- Assländer論文Figure 1bの模様の細部と公開ソフトウェア（https://github.com/PostureControlLab/anaropia-rfm）を追加照合する必要がある。本文で確認できたのは高コントラストという指定であり、16×16チェッカー・高さ6mは未確認の代替仕様。Ghiasi本文のTrapV数値条件も引き続き未確認。
- Assländer論文の刺激は積分した疑似ランダム三値系列と正弦波であり、TrapVではない。本システムはAssländerのシーン構成を参考にGhiasiのTrapV型を組み合わせた独自条件。
