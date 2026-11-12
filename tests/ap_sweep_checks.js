'use strict';
const assert = require('node:assert/strict');
const defaults = require('../ap-sweep-config.js');
const sweep = require('../ap-sweep-stimulus.js');

const config = sweep.validate({ ...defaults });
assert.equal(config.durationSec, 100);
assert.equal(config.velocityAmplitudeMps, 0.1);
assert.deepEqual(config.segments.map(segment => ({ ...segment })), [
  { startFrequencyHz: 0.7, endFrequencyHz: 0.1, durationSec: 30 },
  { startFrequencyHz: 0.1, endFrequencyHz: 0.05, durationSec: 70 }
]);

const first = config.segments[0], second = config.segments[1];
const k1 = Math.log(0.1 / 0.7) / 30;
const k2 = Math.log(0.05 / 0.1) / 70;
assert(Math.abs(sweep.segmentRate(first) - k1) < 1e-15);
assert(Math.abs(sweep.segmentRate(second) - k2) < 1e-15);

assert.equal(sweep.frequencyAt(config, 0), 0.7);
assert(Math.abs(sweep.frequencyAt(config, 30) - 0.1) < 1e-15);
assert(Math.abs(sweep.frequencyAt(config, 100) - 0.05) < 1e-15);
assert.equal(sweep.phaseAt(config, 0), 0);

const firstCycles = 0.7 * Math.expm1(k1 * 30) / k1;
const secondCycles = 0.1 * Math.expm1(k2 * 70) / k2;
const phaseAtBoundary = 2 * Math.PI * firstCycles;
assert(Math.abs(sweep.phaseAt(config, 30) - phaseAtBoundary) < 1e-12);
assert(Math.abs(sweep.phaseAt(config, 100) - 2 * Math.PI * (firstCycles + secondCycles)) < 1e-12);
assert(Math.abs(sweep.totalCycles(config) - 14.299602805766884) < 1e-12);

// The second segment inherits phase. Frequency, phase and velocity are continuous at 30 s.
const epsilon = 1e-9;
assert(Math.abs(sweep.frequencyAt(config, 30 - epsilon) - sweep.frequencyAt(config, 30 + epsilon)) < 1e-10);
assert(Math.abs(sweep.phaseAt(config, 30 - epsilon) - sweep.phaseAt(config, 30 + epsilon)) < 1e-8);
assert(Math.abs(sweep.velocityAt(config, 30 - epsilon) - sweep.velocityAt(config, 30 + epsilon)) < 1e-9);

for (let i = 0; i <= 10000; i++) {
  const t = config.durationSec * i / 10000;
  assert(Math.abs(sweep.velocityAt(config, t)) <= config.velocityAmplitudeMps + 1e-14);
}

const trajectory = sweep.buildTrajectory(config);
assert.equal(trajectory.positions.length, 100001);
for (const t of [0, 0.1234, 29.999999, 30, 30.000001, 65, 99.999, 100]) {
  const state = sweep.stateAt(trajectory, t);
  assert(Number.isFinite(state.positionM));
  assert(Math.abs(state.velocityMps) <= 0.10000000000001);
  assert(state.frequencyHz <= 0.7 && state.frequencyHz >= 0.05 - 1e-14);
}
assert(Math.abs(sweep.stateAt(trajectory, 30 - epsilon).positionM - sweep.stateAt(trajectory, 30 + epsilon).positionM) < 1e-9);

// Compare the 1 ms integral with an independently generated 0.5 ms reference.
const reference = sweep.buildTrajectory({ ...config, integrationStepSec: 0.0005 });
for (const t of [1, 10, 30, 50, 75, 100]) {
  const error = Math.abs(sweep.stateAt(trajectory, t).positionM - sweep.stateAt(reference, t).positionM);
  assert(error < 2e-7, `position integration error at ${t}s: ${error}`);
}

for (const bad of [
  { durationSec: 300 },
  { velocityAmplitudeMps: 0.2 },
  { segments: [{ startFrequencyHz: 0.7, endFrequencyHz: 0.05, durationSec: 100 }] },
  { roomSizeM: 1 },
  { roomHeightM: 1.9 },
  { gridSpacingM: 4 }
]) assert.throws(() => sweep.validate({ ...config, ...bad }));

console.log('PASS: fixed two-segment log sweep, exact phase carry-over, constant velocity amplitude, continuous integrated position');
