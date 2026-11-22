# VR × ComBalance 計測ソフト

編集できるPython・JavaScript・C#ソースを管理します。90秒マルチコサイン、30秒の注視条件3種類、目線高さの手動取得、床反力との時計対応、名前付きCSV保存を含みます。

## 別のWindows PCに導入

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
