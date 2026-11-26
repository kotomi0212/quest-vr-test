# VR × ComBalance 計測ソフト

2026-11-24更新: 計測画面の先頭に「90秒 スイープ 0.70→0.05 Hz（中心固定）」と「100秒 マルチコサイン10周波数（20秒×4周期）」を追加しました。開始不可の予備刺激は選択一覧から除外しています。更新後はPCアプリを再起動し、Quest Browserも再読み込みしてください。

スイープは90秒全体を使用し、減衰停止・原点復帰の区間はありません。加速度振幅は約0.0167 m/s²、変位包絡の中心は固定、開始・終了速度はゼロです。終了時は最終位置を保持し、次の試行はその位置を基準に開始します。周波数は変位搬送位相で0.70→0.05 Hz、加速度の瞬時周波数は補正により約0.6999→0.0486 Hzです。開始・終了の加速度には段差があります。

10周波数は0.05、0.10、0.20、0.30、0.45、0.60、0.70、0.90、1.20、1.50 Hz。各成分の加速度振幅は約0.0167 m/s²で、100秒のうち10～90秒が20秒周期×4回の解析区間です。CSVとメタデータに新しい条件名・設定を保存します。

編集できるPython・JavaScript・C#ソースを管理します。90秒マルチコサイン、30秒の注視条件3種類、目線高さの手動取得、床反力との時計対応、名前付きCSV保存を含みます。

## 別のWindows PCに導入

居室PCでは、最初に以下で取得します。

```powershell
git clone --branch feature/quest-combalance-software https://github.com/kotomi0212/All.git
cd All
```

GitとPython（現在の検証環境は64 bit Python 3.13）、必要に応じてNode.jsをインストールします。このブランチをcloneした後、リポジトリのルートで次を実行してください。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r research_sync/requirements.txt
```

`research_sync/計測ソフトを起動.cmd` で起動します。居室PCに機器がなくてもコードの編集と映像プレビューができます。

```powershell
.\.venv\Scripts\python.exe -m research_sync.visual_preview_server
# PCで http://localhost:8870/visual-preview.html
.\.venv\Scripts\python.exe -m research_sync.fixation_server
# PCで http://localhost:8872
```

実計測にはMeta Quest Developer Hub、USBデバッグ許可、ComBalanceメーカーソフト・ドライバー、機器のUSB接続が必要です。メーカーDLL・ドライバー・論文PDFはGitに含めていません。メーカーソフトの利用権限を持つPCで別途導入してください。メーカー取得用C#ヘルパーは初回準備でコンパイルします。ADBとメーカーソフトの既定パスが異なる場合は `control_app.py` 冒頭の `ADB` と `VENDOR` を変更します。

## 編集する場所

| 内容 | 主なファイル |
| --- | --- |
| PC画面・操作・保存確認 | `control_app.py` |
| 計測とQuestの通信・開始予約 | `server.py`、`quest.js` |
| 90秒波形の設定・生成 | `visual_stimulus_settings.json`、`visual_stimulus.py` |
| 30秒の単一周波数波形 | `fixation.js`、`trial_stimuli.py` |
| 赤点・回転表示と高さ取得 | `fixation_target.js` |
| CSVと名前・体重推定 | `recording.py`、`named_recording.py` |

30秒の波形条件を変更するときは、プレビュー側 `fixation.js` と計測メタデータ側 `trial_stimuli.py` の設定を合わせてください。

## 2台のPCで更新を共有

同じブランチを使います。作業前に `git pull --ff-only`、編集後に変更したソースだけを `git add` し、`git commit` と `git push` を行ってください。他方のPCで `git pull --ff-only` すると更新を取得できます。両PCで同時に同じファイルを変更した場合は競合解消が必要です。ソフトを再起動し、Questのページも再読み込みして変更を反映します。

`recordings/`、`sessions/`、実測を含む `results/`、ローカル調査資料、トークン、証明書、メーカー配布物は除外しています。例外として管理する `results/stimulus/` と `results/visual-stimulus-20261121/` は数学的に生成した刺激だけです。**Gitは計測データのバックアップにはなりません。**

## ソフトウェア試験

```powershell
.\.venv\Scripts\python.exe -m unittest research_sync.test_visual_stimulus research_sync.test_control research_sync.test_fixation_sync research_sync.test_named_recording
node research_sync/test_quest.js
node research_sync/test_fixation_target.js
```

テストの被験者情報と床反力は合成データです。実機の取得遅延と光学的表示遅延は未校正です。

操作の詳細: [注視条件と同期](FIXATION_README.md)、[CSV保存](CSV保存の使い方.md)、[90秒刺激](VISUAL_STIMULUS.md)。

新規予備試験: [低周波・少数成分の刺激設計](PILOT_DESIGN.md)。0.20 Hz単一40秒、5周波数100秒、静止60秒と外部IMUのゼロ検出を追加。
