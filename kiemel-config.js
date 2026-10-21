/* Kiemel profile: units are metres, seconds, degrees, Hz. No inferred body sizes.
 * Checked against supplied Kiemel et al. 2011 PDF, pp.239-240.
 * Wall size/depth are approved placeholders, not paper measurements.
 */
(function (scope) {
  'use strict';
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  const referencePreset = freeze({
    geometry: {
      frontDistance: 1.07, sideDistance: 1.52, frontWidth: 3.04,
      wallHeight: 2.5, sideDepth: 2.14, // PLACEHOLDERS, not reported paper dimensions.
      sizeProvenance: 'User-approved placeholders: height 2.5m, depth 2.14m; not paper measurements.'
    },
    pattern: {
      type: 'triangles', triangleSidesM: [0.034, 0.034, 0.030], // AC, BC, AB
      // For future convex shapes: type:'polygon', verticesM:[[x,y],...].
      verticesM: null, countPerWall: 500, centralBlankRadius: 0.30,
      fixationPoint: false, fixationDiameter: 0.005, // Engineering choice; OFF by default.
      seed: 12345, maxPlacementAttempts: 100000
    },
    projection: { resolution: 1024 }, // Quest engineering choice; not paper resolution.
    body: { ankleHeight: null, hipHeight: null, eyeHeight: null },
    motion: {
      type: 'ankle', amplitudeScale: 1,
      amplitudeDegHz: 0.02,
      frequencyNumerators: [3, 7, 13, 23, 43, 73, 113, 179, 263, 367],
      frequencyDenominator: 125, capAfter: 8,
      preSeconds: 5, duration: 250, postSeconds: 5,
      shortDuration: 125 // Common period. Never rescale frequencies for a short test.
    }
  });
  const clone = value => JSON.parse(JSON.stringify(value));
  const CONFIG = clone(referencePreset);
  // EDIT CONFIG here. Geometry is independent of wave frequencies and amplitudes.
  // CONFIG.geometry.wallHeight = 3;
  // CONFIG.pattern.seed = 42;
  // CONFIG.motion.amplitudeScale = 0.5; // Shared by ALL three conditions.
  // CONFIG.motion.duration = 125;      // Requires a zero-angle endpoint.
  const api = { CONFIG, referencePreset, clone, restore: () => clone(referencePreset) };
  scope.KiemelConfig = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
