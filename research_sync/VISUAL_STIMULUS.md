# 90秒VR視覚刺激（2026-11-21）

灰色の格子部屋（正面幅6 m・高さ3 m、正面壁まで3 m、格子50 cm）全体をAP方向に並進します。刺激による回転はありません。

## 表示と再生

PCプレビュー: http://localhost:8870/visual-preview.html

閉じた後はリポジトリのルートで `python -m research_sync.visual_preview_server` を実行します。「再生」で90秒の映像、「先頭へ」でリセット、スライダーで任意時刻を確認できます。これは実際のQuestページと同じ部屋・波形を用いた単眼プレビューです。

既存ソフトの標準設定 `results/stimulus/stimulus.json` は今回の波形へ更新済みです。既存PCソフトを再起動し、Questページを再読み込みすると反映されます。今回、機器を使った新たな試行は行っていません。

## 波形

- 周波数: 0.05～1.50 Hz、0.05 Hz刻み、30成分。
- 全成分の加速度片振幅: **0.01666464946520325 m/s²**。
- 最大絶対速度: **0.1000000000 m/s**（0～90秒全体、局所極値を連続時刻で探索）。
- 最大絶対変位: 0.21521243 m。最大絶対加速度: 0.15873604 m/s²。
- 0～10秒のみ5次多項式で滑らかに接続します。10～90秒は全80秒間で指定の加速度マルチコサインそのものです。終了側の振幅ランプはありません。
- 位相は終端の速度・加速度がゼロになる制約下で、変位・加速度のピークを抑えるよう探索しました。大域最適を保証するものではありません。

角周波数を ωk、90秒時点の位相を θk、終了時刻を T として、定常区間では次の解析解を使います。

```
a(t) = A Σ cos(ωk(t−T)+θk)
v(t) = A Σ sin(ωk(t−T)+θk) / ωk
x(t) = A Σ {cos(θk)−cos(ωk(t−T)+θk)} / ωk²
```

Σsin(θk)/ωk = 0、Σcos(θk) = 0 を課し、定数位置オフセットで x(T)=0 にしています。開始区間は x に包絡 e を掛け、速度・加速度を積の微分から計算します。数値二重積分は行いません。終了時の位置・速度・加速度は数値誤差内でゼロであり、部屋を原点へ戻す際のジャンプを防ぎます。Questの各描画フレームで `world.position.z = -x(t)` を適用します。

## 条件変更

`visual_stimulus_settings.json` の周波数範囲・刻み、最大速度、時間を編集し、ルートから次を実行します（出力先は新しい名前にします）。

```
python -m research_sync.visual_stimulus research_sync/results/visual-stimulus-new
```

生成後、検証結果を確認して新しい `stimulus.json` を `research_sync/results/stimulus/stimulus.json` にコピーし、既存ソフトを再起動してください。プレビューで別条件を見る場合は `python -m research_sync.visual_preview_server --port 8871 --data results/visual-stimulus-new` を使います。周波数・時間を変えたときも位相とスケールの再設計が必要です。

## 成果物と確認

`results/visual-stimulus-20261121/` に時系列CSV、30成分振幅CSV、位相を含む設定JSON、検証JSON、グラフPNGを保存しました。30成分振幅は10～90秒を独立に調和回帰して確認し、相対誤差の最大値は約5.8×10⁻¹⁵でした。

`python -m unittest research_sync.test_visual_stimulus -v` の4テストと `node research_sync/test_quest.js` が通過しています。解析解の微分、端点、振幅、速度極値、Pythonとブラウザーの一致、条件変更を確認しています。旧波形を使う既存回帰テストの参照先のみ、保存した `previous_active_stimulus.json` へ固定しました。

ComBalance取得・同期・床反力・FRF・パラメータ推定の実装は変更していません。関連する既存10ファイルのSHA-256が作業前後で一致しています。
