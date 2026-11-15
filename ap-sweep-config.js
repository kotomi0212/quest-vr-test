/* Fore-aft 80-second identification stimulus defaults. SI units throughout. */
(function (scope) {
  'use strict';
  const config = Object.freeze({
    durationSec: 80,
    sweepSegments: Object.freeze([
      Object.freeze({ startFrequencyHz: .7, endFrequencyHz: .2, durationSec: 10 }),
      Object.freeze({ startFrequencyHz: .2, endFrequencyHz: .1, durationSec: 8 }),
      Object.freeze({ startFrequencyHz: .1, endFrequencyHz: .05, durationSec: 12 }),
      Object.freeze({ startFrequencyHz: .05, endFrequencyHz: .05, durationSec: 50 })
    ]),
    amplitudePreset: 'low', velocityPresetsMps: Object.freeze({ low: .05, standard: .1 }),
    band: 'identification', phaseSeed: 20261115, rampSec: 2,
    roomSizeM: 6, roomHeightM: 2.5, gridSpacingM: .5, integrationStepSec: .002,
    countdownSec: 5, returnDurationSec: 2, previewEyeHeightM: 1.6
  });
  scope.AP_SWEEP_CONFIG = config;
  if (typeof module !== 'undefined') module.exports = config;
})(globalThis);
