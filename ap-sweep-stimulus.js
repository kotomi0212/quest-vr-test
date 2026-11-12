/* Deterministic logarithmic sweep math. Positive AP is forward (-Z in A-Frame). */
(function (scope) {
  'use strict';

  const requiredSegments = Object.freeze([
    Object.freeze({ startFrequencyHz: 0.7, endFrequencyHz: 0.1, durationSec: 30 }),
    Object.freeze({ startFrequencyHz: 0.1, endFrequencyHz: 0.05, durationSec: 70 })
  ]);

  function validate(input) {
    const c = { ...input };
    const finite = ['durationSec', 'velocityAmplitudeMps',
      'roomSizeM', 'roomHeightM', 'gridSpacingM', 'integrationStepSec'];
    if (!finite.every(key => Number.isFinite(c[key]))) throw Error('刺激設定に数値以外が含まれています');
    if (c.durationSec !== 100 || c.velocityAmplitudeMps !== 0.1) {
      throw Error('刺激は100秒・速度振幅0.1 m/sの固定プロトコルです');
    }
    if (!Array.isArray(c.segments) || c.segments.length !== requiredSegments.length ||
      !requiredSegments.every((required, index) => Object.keys(required).every(key => c.segments[index]?.[key] === required[key]))) {
      throw Error('周波数区間は0.7→0.1 Hz・30秒、0.1→0.05 Hz・70秒の固定設定です');
    }
    if (c.roomSizeM < 2 || c.roomSizeM > 20) throw Error('床面サイズは2～20 mで設定してください');
    if (c.roomHeightM < 2 || c.roomHeightM > 5) throw Error('壁の高さは2～5 mで設定してください');
    if (c.gridSpacingM < 0.1 || c.gridSpacingM > c.roomSizeM / 2) throw Error('格子間隔は0.1 m以上、部屋サイズの半分以下にしてください');
    if (c.integrationStepSec < 0.0005 || c.integrationStepSec > 0.01) throw Error('積分刻みは0.5～10 msで設定してください');
    return c;
  }

  function segmentRate(segment) {
    return Math.log(segment.endFrequencyHz / segment.startFrequencyHz) / segment.durationSec;
  }

  function segmentCycles(segment) {
    const k = segmentRate(segment);
    return segment.startFrequencyHz * Math.expm1(k * segment.durationSec) / k;
  }

  function totalCycles(c) {
    return c.segments.reduce((sum, segment) => sum + segmentCycles(segment), 0);
  }

  function segmentAt(c, timeSec) {
    const t = Math.max(0, Math.min(c.durationSec, timeSec));
    let startTimeSec = 0;
    for (let index = 0; index < c.segments.length; index++) {
      const segment = c.segments[index];
      const endTimeSec = startTimeSec + segment.durationSec;
      if (t < endTimeSec || index === c.segments.length - 1) {
        return { index, segment, localTimeSec: Math.min(segment.durationSec, t - startTimeSec), startTimeSec };
      }
      startTimeSec = endTimeSec;
    }
    throw Error('スイープ区間を解決できません');
  }

  function frequencyAt(c, timeSec) {
    const { segment, localTimeSec } = segmentAt(c, timeSec);
    return segment.startFrequencyHz * Math.exp(segmentRate(segment) * localTimeSec);
  }

  // Exact piecewise integral of instantaneous frequency. Prior segment phase is retained.
  function phaseAt(c, timeSec) {
    const current = segmentAt(c, timeSec);
    let cycles = 0;
    for (let index = 0; index < current.index; index++) cycles += segmentCycles(c.segments[index]);
    const k = segmentRate(current.segment);
    cycles += current.segment.startFrequencyHz * Math.expm1(k * current.localTimeSec) / k;
    return 2 * Math.PI * cycles;
  }

  function velocityAt(c, timeSec) {
    return c.velocityAmplitudeMps * Math.sin(phaseAt(c, timeSec));
  }

  function buildTrajectory(input) {
    const config = validate(input);
    const step = config.integrationStepSec;
    const count = Math.ceil(config.durationSec / step) + 1;
    const positions = new Float64Array(count);
    let previousTime = 0;
    let previousVelocity = velocityAt(config, 0);
    for (let i = 1; i < count; i++) {
      const time = Math.min(config.durationSec, i * step);
      const velocity = velocityAt(config, time);
      positions[i] = positions[i - 1] + (previousVelocity + velocity) * 0.5 * (time - previousTime);
      previousTime = time;
      previousVelocity = velocity;
    }
    return Object.freeze({ config, step, positions });
  }

  function stateAt(trajectory, timeSec) {
    const c = trajectory.config;
    const t = Math.max(0, Math.min(c.durationSec, timeSec));
    const index = Math.min(trajectory.positions.length - 1, Math.floor(t / trajectory.step));
    const next = Math.min(trajectory.positions.length - 1, index + 1);
    const baseTime = Math.min(c.durationSec, index * trajectory.step);
    const nextTime = Math.min(c.durationSec, next * trajectory.step);
    const fraction = nextTime === baseTime ? 0 : Math.max(0, Math.min(1, (t - baseTime) / (nextTime - baseTime)));
    const positionM = trajectory.positions[index] +
      (trajectory.positions[next] - trajectory.positions[index]) * fraction;
    return {
      timeSec: t,
      frequencyHz: frequencyAt(c, t),
      phaseRad: phaseAt(c, t),
      velocityMps: velocityAt(c, t),
      positionM
    };
  }

  const api = { validate, segmentRate, segmentCycles, totalCycles, segmentAt, frequencyAt, phaseAt, velocityAt, buildTrajectory, stateAt };
  scope.APSweepStimulus = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
