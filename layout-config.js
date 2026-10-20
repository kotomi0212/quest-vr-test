/* 配置だけの設定。距離・寸法はm、回転は度。編集後はPCとQuestを再読み込み。 */
(function (scope) {
  'use strict';
  const layoutConfig = {
    // calibrated-xz: 位置合わせした頭の真下をX/Zの原点とする。Yは床基準。
    // world: アプリのワールド原点を使う。頭に追従するHUDではない。
    anchor: 'calibrated-xz',
    plane: {
      widthM: 6, heightM: 4,
      positionM: { x: 0, y: 1.6, z: -3 }, // 表示面の中心。-Zが前方、-3は正面3m
      rotationDeg: { x: 0, y: 0, z: 0 }  // 面自体の初期姿勢（運動の回転軸とは別）
    },
    // 互換用。新しい3種類の画像は上のplaneを使用する。
    cylinder: {
      radiusM: 1, heightM: 6, radialSegments: 96,
      positionM: { x: 0, y: 2, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 },
      thetaStartDeg: 90, thetaLengthDeg: 180
    }
    // 既存の家具・壁の部屋はquest.htmlの #room-pattern。今回は作り替えない。
  };
  scope.layoutConfig = layoutConfig;
  if (typeof module !== 'undefined') module.exports = layoutConfig;
})(globalThis);
