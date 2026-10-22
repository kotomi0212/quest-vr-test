/* 最小限の運動設定。波形計算はstimulus-engine.js、適用箇所はruntimeのrotate()。 */
(function (scope) {
  'use strict';
  const motionConfig = {
    rotationAxis: { x: 1, y: 0, z: 0 }, // X軸=前後傾斜、Y軸=左右への向き変更、Z軸=左右傾斜
    pivot: {
      mode: 'calibrated', // calibrated=PCの位置合わせ結果、fixed=下記positionMを使用
      positionM: { x: 0, y: 0.088, z: 0 },
      offsetM: { x: 0, y: 0, z: 0 } // 選んだ原点に足す。股関節の自動推定ではない
    }
  };
  scope.motionConfig = motionConfig;
  if (typeof module !== 'undefined') module.exports = motionConfig;
})(globalThis);
