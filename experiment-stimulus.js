/* Deterministic 80 s identification stimuli. Angles are degrees. */
(function (scope) {
  'use strict';
  const DURATION_SEC = 80;
  const bands = Object.freeze({
    identification: Object.freeze(Array.from({ length: 14 }, (_, i) => Number(((i + 1) * .05).toFixed(2)))),
    paper: Object.freeze(Array.from({ length: 30 }, (_, i) => Number(((i + 1) * .05).toFixed(2))))
  });
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  function hash(seed) { let x = (Number(seed) || 1) >>> 0; return () => ((x = Math.imul(x ^ x >>> 15, 1 | x), x ^= x + Math.imul(x ^ x >>> 7, 61 | x), ((x ^ x >>> 14) >>> 0) / 4294967296)); }
  function ramp(t, seconds) { if (!seconds) return 1; const u=clamp(Math.min(t,DURATION_SEC-t)/seconds,0,1);return .5-.5*Math.cos(Math.PI*u); }
  function validate(input) {
    const c = { band: 'identification', amplitudeMode: 'velocity', baseAmplitude: 2,
      amplitudePreset: 'standard', maxPositionDeg: 1, maxVelocityDegS: 8, maxAccelerationDegS2: 40,
      phaseSeed: 20261115, rampSec: 2, sweepSegments: [10, 8, 12, 50], ...input };
    const presets={low:.5,standard:1};
    if(!Object.hasOwn(presets,c.amplitudePreset))throw Error('振幅プリセットが不正です');
    c.maxPositionDeg=presets[c.amplitudePreset];
    if (!bands[c.band]) throw Error('周波数帯域が不正です');
    if (!['velocity', 'acceleration'].includes(c.amplitudeMode)) throw Error('振幅方式が不正です');
    for (const key of ['baseAmplitude','maxPositionDeg','maxVelocityDegS','maxAccelerationDegS2','phaseSeed','rampSec']) if (!Number.isFinite(Number(c[key]))) throw Error(`${key} が数値ではありません`);
    c.baseAmplitude=Number(c.baseAmplitude);c.maxPositionDeg=Number(c.maxPositionDeg);c.maxVelocityDegS=Number(c.maxVelocityDegS);c.maxAccelerationDegS2=Number(c.maxAccelerationDegS2);c.phaseSeed=Number(c.phaseSeed);c.rampSec=Number(c.rampSec);
    if (c.baseAmplitude<=0 || c.maxPositionDeg<=0 || c.maxPositionDeg>4 || c.maxVelocityDegS<=0 || c.maxVelocityDegS>30 || c.maxAccelerationDegS2<=0 || c.rampSec<0 || c.rampSec>10) throw Error('刺激振幅または制約が範囲外です');
    if (!Array.isArray(c.sweepSegments) || c.sweepSegments.length!==4 || c.sweepSegments.some(x=>!Number.isFinite(Number(x))||Number(x)<0) || Math.abs(c.sweepSegments.reduce((a,b)=>a+Number(b),0)-DURATION_SEC)>1e-9) throw Error(`スイープ区間の合計は${DURATION_SEC}秒にしてください`);
    c.sweepSegments=c.sweepSegments.map(Number); return c;
  }
  function rawMulticosine(c) {
    const frequencies=bands[c.band], random=hash(c.phaseSeed);
    const phases=frequencies.map(()=>random()*2*Math.PI);
    const amplitudes=frequencies.map(f=>c.amplitudeMode==='velocity'?c.baseAmplitude/(2*Math.PI*f):c.baseAmplitude/(2*Math.PI*f)**2);
    return { frequencies, phases, amplitudes };
  }
  function multicosineState(c, t, design=rawMulticosine(c)) {
    let p=0,v=0,a=0;
    design.frequencies.forEach((f,i)=>{const w=2*Math.PI*f,q=w*t+design.phases[i],A=design.amplitudes[i];p+=A*Math.cos(q);v+=-A*w*Math.sin(q);a+=-A*w*w*Math.cos(q);});
    return { positionDeg:p, velocityDegS:v, accelerationDegS2:a, frequencyHz:null };
  }
  function sweepFrequency(c,t) {
    const high=c.band==='paper'?1.5:.7, durations=c.sweepSegments, points=[high,.2,.1,.05,.05]; let start=0;
    for(let i=0;i<4;i++){const end=start+durations[i];if(t<=end||i===3){const u=durations[i]?clamp((t-start)/durations[i],0,1):1;return {index:i,local:u,duration:durations[i],f0:points[i],f1:points[i+1]};}start=end;}
  }
  function sweepCycles(c,t){let cycles=0,start=0;const d=c.sweepSegments, high=c.band==='paper'?1.5:.7, p=[high,.2,.1,.05,.05];for(let i=0;i<4;i++){const dt=clamp(t-start,0,d[i]);cycles+=p[i]*dt+(p[i+1]-p[i])*dt*dt/(2*(d[i]||1));start+=d[i];if(t<=start)break;}return cycles;}
  function sweepState(c,t){const s=sweepFrequency(c,t),f=s.f0+(s.f1-s.f0)*s.local,phase=2*Math.PI*sweepCycles(c,t);const velocity=c.baseAmplitude*Math.sin(phase);const acceleration=2*Math.PI*f*c.baseAmplitude*Math.cos(phase);return {positionDeg:0,velocityDegS:velocity,accelerationDegS2:acceleration,frequencyHz:f,phaseRad:phase};}
  function interpolatedPosition(positions,step,t){const time=clamp(t,0,DURATION_SEC),i=Math.min(positions.length-2,Math.floor(time/step)),u=(time-i*step)/step;return positions[i]*(1-u)+positions[i+1]*u;}
  function build(input,type,step=.002){const c=validate(input), design=type==='multicosine'?rawMulticosine(c):null,n=Math.round(DURATION_SEC/step)+1,positions=new Float64Array(n);let scale=1,maxP=0,maxV=0,maxA=0,prevV=0;for(let i=0;i<n;i++){const t=i*step,s=type==='multicosine'?multicosineState(c,t,design):sweepState(c,t);if(type==='sweep'&&i)positions[i]=positions[i-1]+(prevV+s.velocityDegS)*step/2;else if(type==='multicosine')positions[i]=s.positionDeg;prevV=s.velocityDegS;}const p=i=>positions[clamp(i,0,n-1)]*ramp(clamp(i,0,n-1)*step,c.rampSec);for(let i=0;i<n;i++){const value=p(i),velocity=(p(i+1)-p(i-1))/(i===0||i===n-1?step:2*step),acceleration=(p(i+1)-2*value+p(i-1))/(step*step);maxP=Math.max(maxP,Math.abs(value));maxV=Math.max(maxV,Math.abs(velocity));maxA=Math.max(maxA,Math.abs(acceleration));}scale=Math.min(1,c.maxPositionDeg/maxP,c.maxVelocityDegS/maxV,c.maxAccelerationDegS2/maxA);return {config:c,type,step,positions,design,scale,peaks:{positionDeg:maxP*scale,velocityDegS:maxV*scale,accelerationDegS2:maxA*scale}};}
  function stateAt(tr,t){const time=clamp(t,0,DURATION_SEC),h=tr.step,raw=x=>interpolatedPosition(tr.positions,h,x)*ramp(clamp(x,0,DURATION_SEC),tr.config.rampSec),p=raw(time),lo=time<=0?time:time-h,hi=time>=DURATION_SEC?time:time+h,velocity=(raw(hi)-raw(lo))/(hi-lo||1),acceleration=time<=0||time>=DURATION_SEC?0:(raw(time+h)-2*p+raw(time-h))/(h*h),base=tr.type==='multicosine'?multicosineState(tr.config,time,tr.design):sweepState(tr.config,time);return {...base,positionDeg:p*tr.scale,velocityDegS:velocity*tr.scale,accelerationDegS2:acceleration*tr.scale,ramp:ramp(time,tr.config.rampSec)};}
  const api={DURATION_SEC,bands,validate,rawMulticosine,multicosineState,sweepFrequency,sweepCycles,sweepState,build,stateAt};scope.ExperimentStimulus=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
