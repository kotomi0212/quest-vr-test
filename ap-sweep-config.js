/* Fore-aft logarithmic frequency sweep defaults. SI units throughout. */
(function (scope) {
  'use strict';

  const config = Object.freeze({
    startFrequencyHz: 0.7,
    endFrequencyHz: 0.05,
    durationSec: 300,
    velocityAmplitudeMps: 0.1,
    roomSizeM: 6,
    gridSpacingM: 0.5,
    integrationStepSec: 0.001,
    countdownSec: 3,
    returnDurationSec: 2,
    previewEyeHeightM: 1.6
  });

  scope.AP_SWEEP_CONFIG = config;
  if (typeof module !== 'undefined') module.exports = config;
})(globalThis);
