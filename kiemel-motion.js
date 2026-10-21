/* Pure protocol math. +X rotation gives +Z (posterior) displacement at eye level.
 * No rendering, frame-count timing, rate limiter, fade or condition-specific gain.
 */
(function (scope) {
  'use strict';
  const rad = degree => degree * Math.PI / 180;
  function bodyDimensions(body) {
    const { ankleHeight: a, hipHeight: h, eyeHeight: e } = body || {};
    if (![a,h,e].every(Number.isFinite) || a < 0 || !(a < h && h < e)) throw Error('身体寸法は m 単位で 0≤足関節<股関節<眼 が必要です');
    return { l1:h-a, l2:e-h, H:e-a };
  }
  function components(motion) {
    const m=motion;
    if (!Array.isArray(m.frequencyNumerators) || !m.frequencyNumerators.length ||
      !m.frequencyNumerators.every(f=>Number.isFinite(f)&&f>0) || !Number.isFinite(m.frequencyDenominator) || m.frequencyDenominator<=0 ||
      !Number.isInteger(m.capAfter) || m.capAfter<1 || m.capAfter>m.frequencyNumerators.length ||
      !Number.isFinite(m.amplitudeDegHz) || m.amplitudeDegHz<0 || !Number.isFinite(m.amplitudeScale) || m.amplitudeScale<0) throw Error('Kiemel周波数・共通振幅設定が不正です');
    const f=m.frequencyNumerators.map(n=>n/m.frequencyDenominator), cap=f[m.capAfter-1];
    return f.map((frequency,i)=>({ frequency, amplitude:m.amplitudeDegHz/(i<m.capAfter?frequency:cap)*m.amplitudeScale, sign:i%2?1:-1 }));
  }
  function ankleAngle(t,motion) {
    if (!Number.isFinite(t)) throw Error('時刻は秒の有限値が必要です');
    return components(motion).reduce((s,c)=>s+c.sign*c.amplitude*Math.sin(2*Math.PI*c.frequency*t),0);
  }
  function validate(config, requireBody=true) {
    if (requireBody) bodyDimensions(config.body);
    const m=config.motion;
    if (!['translation','ankle','hip'].includes(m.type) || ![m.preSeconds,m.duration,m.postSeconds].every(Number.isFinite) ||
      m.preSeconds<0 || m.duration<=0 || m.postSeconds<0) throw Error('Kiemel条件・時間設定が不正です');
    components(m);
    // No implicit return-to-zero ramp: a shortened waveform must end at zero.
    if (Math.abs(ankleAngle(m.duration,m))>1e-9) throw Error('短縮時間の終端角が0ではありません。初期波形の共通周期125秒（または終端0の時間）を指定してください');
    return config;
  }
  function pose(angleDeg,body,type) {
    const {l2,H}=bodyDimensions(body), theta=rad(angleDeg);
    if (!['translation','ankle','hip'].includes(type)) throw Error('Kiemel条件が不正です');
    const angle=type==='translation'?0:type==='hip'?angleDeg*H/l2:angleDeg;
    const center=type==='hip'?[0,-l2,0]:[0,-H,0];
    const translation=type==='translation'?H*theta:0;
    return { angleDeg:angle, pivot:center, translationZ:translation, ankleReferenceDeg:angleDeg,
      eyeLinearZ:H*theta, eyeExactZ:type==='translation'?translation:(type==='hip'?l2:H)*Math.sin(rad(angle)) };
  }
  function at(elapsed,config,baseline=false) {
    const m=config.motion, end=m.preSeconds+m.duration, total=end+m.postSeconds;
    const phase=elapsed<m.preSeconds?'pre-static':elapsed<end?'stimulus':elapsed<total?'post-static':'completed';
    const t=Math.max(0,Math.min(m.duration,elapsed-m.preSeconds));
    const angle=phase==='stimulus'&&!baseline?ankleAngle(t,m):0;
    return { ...pose(angle,config.body,m.type), phase, stimulusSeconds:t, totalSeconds:total };
  }
  function rotateX(p,angleDeg) { const a=rad(angleDeg),c=Math.cos(a),s=Math.sin(a);return [p[0],c*p[1]-s*p[2],s*p[1]+c*p[2]]; }
  function transform(p,pose) {
    const c=pose.pivot, r=rotateX(p.map((v,i)=>v-c[i]),pose.angleDeg);
    return r.map((v,i)=>v+c[i]+(i===2?pose.translationZ:0));
  }
  function bounds(config) {
    const {H,l2}=bodyDimensions(config.body),ankleDeg=components(config.motion).reduce((s,c)=>s+c.amplitude,0),hipDeg=ankleDeg*H/l2;
    return {ankleAngleBoundDeg:ankleDeg,hipAngleBoundDeg:hipDeg,translationBoundM:H*rad(ankleDeg),ankleApproximationErrorBoundM:H*Math.abs(rad(ankleDeg))**3/6,hipApproximationErrorBoundM:l2*Math.abs(rad(hipDeg))**3/6};
  }
  const api={rad,bodyDimensions,components,ankleAngle,validate,pose,at,rotateX,transform,bounds};
  scope.KiemelMotion=api;
  if (typeof module !== 'undefined') module.exports=api;
})(globalThis);
