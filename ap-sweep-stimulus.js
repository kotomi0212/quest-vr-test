/* Deterministic logarithmic sweep math. Positive AP is forward (-Z in A-Frame). */
(function (scope) {
  'use strict';

  function validate(input) {
    const c = { ...input };
    const finite = ['startFrequencyHz', 'endFrequencyHz', 'durationSec', 'velocityAmplitudeMps',
      'roomSizeM', 'roomHeightM', 'gridSpacingM', 'integrationStepSec'];
    if (!finite.every(key => Number.isFinite(c[key]))) throw Error('刺激設定に数値以外が含まれています');
    if (c.startFrequencyHz <= c.endFrequencyHz || c.endFrequencyHz < 0.01 || c.startFrequencyHz > 5) {
      throw Error('周波数は5 Hz以下、0.01 Hz以上で、高周波から低周波へ設定してください');
    }
    if (c.durationSec < 5 || c.durationSec > 1800) throw Error('刺激時間は5～1800秒で設定してください');
    if (c.velocityAmplitudeMps <= 0 || c.velocityAmplitudeMps > 1) throw Error('速度振幅は0より大きく1 m/s以下で設定してください');
    if (c.roomSizeM < 2 || c.roomSizeM > 20) throw Error('床面サイズは2～20 mで設定してください');
    if (c.roomHeightM < 2 || c.roomHeightM > 5) throw Error('壁の高さは2～5 mで設定してください');
    if (c.gridSpacingM < 0.1 || c.gridSpacingM > c.roomSizeM / 2) throw Error('格子間隔は0.1 m以上、部屋サイズの半分以下にしてください');
    if (c.integrationStepSec < 0.0005 || c.integrationStepSec > 0.01) throw Error('積分刻みは0.5～10 msで設定してください');
    return c;
  }

  function sweepRate(c) {
    return Math.log(c.endFrequencyHz / c.startFrequencyHz) / c.durationSec;
  }

  function frequencyAt(c, timeSec) {
    const t = Math.max(0, Math.min(c.durationSec, timeSec));
    return c.startFrequencyHz * Math.exp(sweepRate(c) * t);
  }

  // Exact integral of instantaneous frequency: phase(t) = 2*pi*integral(0..t) f(u)du.
  function phaseAt(c, timeSec) {
    const t = Math.max(0, Math.min(c.durationSec, timeSec));
    const k = sweepRate(c);
    return 2 * Math.PI * c.startFrequencyHz * Math.expm1(k * t) / k;
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

  const api = { validate, sweepRate, frequencyAt, phaseAt, velocityAt, buildTrajectory, stateAt };
  scope.APSweepStimulus = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
