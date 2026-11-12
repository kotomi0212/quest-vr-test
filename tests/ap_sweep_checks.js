'use strict';
const assert = require('node:assert/strict');
const defaults = require('../ap-sweep-config.js');
const sweep = require('../ap-sweep-stimulus.js');

const config = sweep.validate({ ...defaults });
assert.equal(sweep.frequencyAt(config, 0), 0.7);
assert(Math.abs(sweep.frequencyAt(config, 300) - 0.05) < 1e-14);
assert.equal(sweep.phaseAt(config, 0), 0);

const k = Math.log(config.endFrequencyHz / config.startFrequencyHz) / config.durationSec;
const expectedCycles = config.startFrequencyHz * Math.expm1(k * config.durationSec) / k;
assert(Math.abs(sweep.phaseAt(config, config.durationSec) / (2 * Math.PI) - expectedCycles) < 1e-12);

for (let i = 0; i <= 30000; i++) {
  const t = config.durationSec * i / 30000;
  assert(Math.abs(sweep.velocityAt(config, t)) <= config.velocityAmplitudeMps + 1e-14);
}

const trajectory = sweep.buildTrajectory(config);
assert.equal(trajectory.positions.length, 300001);
for (const t of [0, 0.1234, 12.3456, 149.9999, 299.999, 300]) {
  const state = sweep.stateAt(trajectory, t);
  assert(Number.isFinite(state.positionM));
  assert(Math.abs(state.velocityMps) <= 0.10000000000001);
  assert(state.frequencyHz <= config.startFrequencyHz && state.frequencyHz >= config.endFrequencyHz - 1e-14);
}

// Compare the 1 ms integral with a separate 0.5 ms reference integration.
const reference = sweep.buildTrajectory({ ...config, integrationStepSec: 0.0005 });
for (const t of [1, 10, 100, 200, 300]) {
  const error = Math.abs(sweep.stateAt(trajectory, t).positionM - sweep.stateAt(reference, t).positionM);
  assert(error < 2e-7, `position integration error at ${t}s: ${error}`);
}

const fractionalDuration = sweep.buildTrajectory({ ...config, durationSec: 5.1234 });
assert.equal(
  sweep.stateAt(fractionalDuration, 5.1234).positionM,
  fractionalDuration.positions[fractionalDuration.positions.length - 1],
  'non-grid-aligned durations must reach the final integrated position'
);

for (const bad of [
  { endFrequencyHz: 0.8 },
  { endFrequencyHz: 0 },
  { durationSec: 2 },
  { velocityAmplitudeMps: 0 },
  { roomSizeM: 1 },
  { roomHeightM: 1.9 },
  { gridSpacingM: 4 }
]) assert.throws(() => sweep.validate({ ...config, ...bad }));

console.log('PASS: exact log-sweep phase, constant velocity amplitude, deterministic integrated position, and validation');
