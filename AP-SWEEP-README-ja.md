# 前後並進・対数周波数スイープ専用サイト

既存の回転刺激サイトとは独立した、Quest用の前後並進刺激です。

## ページ

- Quest: `quest3.html`
- PC操作: `operator3.html`

Firebase Realtime Databaseでは、既存サイトと衝突しないように
`sessions/<sessionId>-ap-sweep/` 以下だけを使用します。

## 初期設定

`ap-sweep-config.js` に次の初期値があります。PC操作画面からも試行ごとに変更できます。

- 区間1: 0～30秒、0.7 → 0.1 Hz
- 区間2: 30～100秒、0.1 → 0.05 Hz
- 刺激時間: 100秒固定
- 速度振幅: 0.1 m/s
- 床面サイズ: 6 m × 6 m（中央から前後左右の壁まで3 m）
- 壁の高さ: 2.5 m
- 格子間隔: 0.5 m
- 位置積分刻み: 1 ms

## 波形

各区間で `k = ln(fEnd / fStart) / duration` として、瞬時周波数を次式で求めます。

```text
f(t)   = fStart * exp(k*t)
phi(t) = phiAtSegmentStart + 2*pi*fStart*expm1(k*t)/k
v(t)   = velocityAmplitude*sin(phi(t))
```

`phi(t)` は瞬時周波数の解析的な時間積分です。区間2は区間1の終端位相を引き継ぐため、30秒で周波数・位相・速度が連続します。位置は速度を1 ms刻みで区間をまたいで台形積分し、描画フレームではそのテーブルを補間します。このため、位置も連続し、描画フレーム間隔の変動を位置へ累積しません。

AP位置・速度は前方を正とし、A-Frameでは前方が−Zなので `translation_z_m = -ap_position_m` です。

## 操作

1. Questで `quest3.html` を開き、標準VRボタンを押します。
2. PCで `operator3.html` にログインします。
3. 必要なら設定を変更し、「部屋設定を反映」を押します。
4. 被験者が実験位置で正面を向いた状態で「立ち位置を合わせる」を押します。
5. 「スイープSTART」または「Baseline START」を押します。
6. 通常停止はSTOP、即時停止は緊急停止を使用します。
7. CSVまたはJSONでログを保存します。

通常STOPとスイープの自然終了後は、現在位置から2秒で原点へ戻ります。Baselineは同じグリッド空間を動かさずに、指定時間だけ表示します。

## ログ列

- `elapsed_ms`
- `instantaneous_frequency_hz`
- `ap_position_m`
- `ap_velocity_m_s`
- `translation_z_m`
- `performance_ms`
- `epoch_estimate_ms`
- `phase`

時刻と位置はソフトウェア指令値です。外部センサーとの同期や実際の表示光タイミングを測定するものではありません。

## ローカル検証

```text
node tests/ap_sweep_checks.js
node tests/ap_sweep_site_checks.js
```
