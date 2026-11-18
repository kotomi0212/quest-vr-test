/* Fore-aft 80-second identification stimulus defaults. SI units throughout. */
(function (scope) {
  'use strict';
  const config = Object.freeze({
    durationSec: 80,
    sweepSegments: Object.freeze([
      Object.freeze({ startFrequencyHz: .7, endFrequencyHz: .2, durationSec: 11 }),
      Object.freeze({ startFrequencyHz: .2, endFrequencyHz: .1, durationSec: 11 }),
      Object.freeze({ startFrequencyHz: .1, endFrequencyHz: .05, durationSec: 11.732276119163764 }),
      Object.freeze({ startFrequencyHz: .05, endFrequencyHz: .05, durationSec: 46.267723880836236 })
    ]),
    amplitudePreset: 'low', velocityPeakPresetsMps: Object.freeze({ low: .05, standard: .1 }),
    band: 'identification', phaseSeed: 20261115, rampSec: 2,
    roomSizeM: 6, roomHeightM: 3, gridSpacingM: .5, integrationStepSec: .002,
    countdownSec: 5, returnDurationSec: 2, previewEyeHeightM: 1.6
  });
  scope.AP_SWEEP_CONFIG = config;
  if (typeof module !== 'undefined') module.exports = config;
})(globalThis);
