/* 模様だけの設定。width/heightは画像のピクセル数。配置（m）はlayout-config.jsへ。 */
(function (scope) {
  'use strict';
  const patternConfig = {
    // PCの初期選択。noise-1f / stripes-high / stripes-low / grid / room
    defaultPattern: 'grid',
    patterns: {
      'kiemel-triangles': { label: 'Kiemel：黒背景・白三角形の3面', kind: 'kiemel' },
      'noise-1f': {
        label: '空間ノイズ（初期値1/f）', kind: 'noise',
        width: 512, height: 512,       // FFTのため2の累乗（2～1024）
        spectralSlope: -1,            // 振幅 ∝ f^slope。-1ならパワーは1/f²
        spectralAspect: 1.5,          // 画像の周波数座標の横/縦比。配置変更では変えない
        brightness: 0.5, contrast: 1, // 線形輝度L=brightness*(1+contrast*field)
        seed: 20261020                // 固定すると同じ模様。時間ノイズではない
      },
      'stripes-high': {
        label: 'ストライプ（高コントラスト）', kind: 'stripes',
        width: 512, height: 512,
        orientation: 0,               // 度。0=縦縞、90=横縞
        stripeCount: 24,              // 画像内の明暗1組の数。0度なら幅方向
        brightness: 0.5, contrast: 1  // Michelsonコントラストの目標値
      },
      'stripes-low': {
        label: 'ストライプ（低コントラスト）', kind: 'stripes',
        width: 512, height: 512, orientation: 0, stripeCount: 24,
        brightness: 0.5, contrast: 0.1
      },
      grid: { label: '既存：黒格子の半円筒', kind: 'legacy' },
      room: { label: '既存：家具のある部屋', kind: 'legacy' }
    }
  };
  scope.patternConfig = patternConfig;
  if (typeof module !== 'undefined') module.exports = patternConfig;
})(globalThis);
