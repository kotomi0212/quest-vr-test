/* Deterministic 80 s acceleration-domain fore-aft translation stimuli. */
(function(scope){
  'use strict';
  const bands=Object.freeze({
    identification:Object.freeze(Array.from({length:14},(_,i)=>Number(((i+1)*.05).toFixed(2)))),
    paper:Object.freeze(Array.from({length:30},(_,i)=>Number(((i+1)*.05).toFixed(2))))
  });
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function random(seed){let x=(Number(seed)||1)>>>0;return()=>((x=Math.imul(x^x>>>15,1|x),x^=x+Math.imul(x^x>>>7,61|x),((x^x>>>14)>>>0)/4294967296));}
  function envelope(t,c){if(!c.rampSec)return 1;const u=clamp(Math.min(t,c.durationSec-t)/c.rampSec,0,1);return .5-.5*Math.cos(Math.PI*u);}
  function validate(input){
    const c={...input};
    for(const key of ['durationSec','roomSizeM','roomHeightM','gridSpacingM','integrationStepSec','rampSec','phaseSeed'])if(!Number.isFinite(Number(c[key])))throw Error(`${key}が不正です`);
    if(c.durationSec!==80)throw Error('刺激時間は80秒固定です');
    if(!['low','standard'].includes(c.amplitudePreset))throw Error('加速度振幅プリセットが不正です');
    if(!bands[c.band])throw Error('周波数帯域が不正です');
    c.targetVelocityPeakMps=c.amplitudePreset==='low'?.05:.1;
    if(!Array.isArray(c.sweepSegments)||c.sweepSegments.length!==4||Math.abs(c.sweepSegments.reduce((s,x)=>s+Number(x.durationSec),0)-80)>1e-9)throw Error('スイープ区間は合計80秒にしてください');
    if(c.roomSizeM<2||c.roomSizeM>20||c.roomHeightM<2||c.roomHeightM>5||c.gridSpacingM<.1||c.gridSpacingM>c.roomSizeM/2)throw Error('部屋設定が範囲外です');
    return c;
  }
  function sweepFrequency(c,t){let start=0;for(let i=0;i<c.sweepSegments.length;i++){const s=c.sweepSegments[i],end=start+s.durationSec;if(t<=end||i===c.sweepSegments.length-1){const u=s.durationSec?clamp((t-start)/s.durationSec,0,1):1;return {index:i,frequencyHz:s.startFrequencyHz+(s.endFrequencyHz-s.startFrequencyHz)*u};}start=end;}}
  function sweepCycles(c,t){let cycles=0,start=0;for(const s of c.sweepSegments){const dt=clamp(t-start,0,s.durationSec);cycles+=s.startFrequencyHz*dt+(s.endFrequencyHz-s.startFrequencyHz)*dt*dt/(2*s.durationSec);start+=s.durationSec;if(t<=start)break;}return cycles;}
  function design(c,type){
    if(type==='multicosine'){const r=random(c.phaseSeed),frequencies=bands[c.band],phases=frequencies.map(()=>r()*2*Math.PI);return {domain:'acceleration',frequenciesHz:frequencies,phasesRad:phases};}
    return {domain:'acceleration',segments:c.sweepSegments};
  }
  function multicosinePosition(c,d,t){return d.frequenciesHz.reduce((sum,f,i)=>{const w=2*Math.PI*f;return sum-1/(w*w)*Math.cos(w*t+d.phasesRad[i]);},0);}
  function buildSweepPositions(c,d,step,n){
    let C=0,S=0;for(let i=0;i<n;i++){const t=i*step,theta=2*Math.PI*sweepCycles(c,t),weight=(i===0||i===n-1)?.5:1,e=envelope(t,c);C+=weight*e*Math.cos(theta);S+=weight*e*Math.sin(theta);}
    d.phaseOffsetRad=Math.atan2(C,S);
    const acceleration=new Float64Array(n),velocity=new Float64Array(n),position=new Float64Array(n);
    for(let i=0;i<n;i++){const t=i*step;acceleration[i]=envelope(t,c)*Math.cos(2*Math.PI*sweepCycles(c,t)+d.phaseOffsetRad);}
    for(let i=1;i<n;i++)velocity[i]=velocity[i-1]+(acceleration[i-1]+acceleration[i])*step/2;
    for(let i=1;i<n;i++)position[i]=position[i-1]+(velocity[i-1]+velocity[i])*step/2;
    d.integrationInitialVelocityMps=0;d.endVelocityBeforeScalingMps=velocity[n-1];d.endPositionBeforeScalingM=position[n-1];d.rampAppliedTo='acceleration';return position;
  }
  function buildTrajectory(input,type='sweep'){
    const c=validate(input);if(!['sweep','multicosine'].includes(type))throw Error('刺激モードが不正です');
    const d=design(c,type),step=c.integrationStepSec,n=Math.round(c.durationSec/step)+1,rawPositions=type==='sweep'?buildSweepPositions(c,d,step,n):new Float64Array(n);
    if(type==='multicosine'){const initial=multicosinePosition(c,d,0);for(let i=0;i<n;i++)rawPositions[i]=multicosinePosition(c,d,i*step)-initial;d.positionOffsetRemovedM=initial;}
    const p=i=>{const j=clamp(i,0,n-1),x=rawPositions[j];return type==='sweep'?x:x*envelope(j*step,c);};let maxP=0,maxV=0,maxA=0;
    for(let i=0;i<n;i++){const x=p(i),den=i===0||i===n-1?step:2*step,v=(p(i+1)-p(i-1))/den,a=i===0||i===n-1?0:(p(i+1)-2*x+p(i-1))/(step*step);maxP=Math.max(maxP,Math.abs(x));maxV=Math.max(maxV,Math.abs(v));maxA=Math.max(maxA,Math.abs(a));}
    const scale=c.targetVelocityPeakMps/maxV;c.accelerationAmplitudeMps2=scale;if(type==='multicosine')d.componentAccelerationAmplitudeMps2=scale;else d.accelerationAmplitudeMps2=scale;
    return Object.freeze({config:c,type,design:d,step,rawPositions,scale,peaks:{positionM:maxP*scale,velocityMps:maxV*scale,accelerationMps2:maxA*scale}});
  }
  function rawPositionAt(tr,t){const x=clamp(t,0,tr.config.durationSec),i=Math.min(tr.rawPositions.length-2,Math.floor(x/tr.step)),u=(x-i*tr.step)/tr.step,p=tr.rawPositions[i]*(1-u)+tr.rawPositions[i+1]*u;return tr.type==='sweep'?p:p*envelope(x,tr.config);}
  function stateAt(tr,t){const x=clamp(t,0,tr.config.durationSec),h=tr.step,p=rawPositionAt(tr,x),lo=x<=0?x:x-h,hi=x>=tr.config.durationSec?x:x+h,v=(rawPositionAt(tr,hi)-rawPositionAt(tr,lo))/(hi-lo||1),a=x<=0||x>=tr.config.durationSec?0:(rawPositionAt(tr,x+h)-2*p+rawPositionAt(tr,x-h))/(h*h),f=tr.type==='sweep'?sweepFrequency(tr.config,x).frequencyHz:null;return {timeSec:x,frequencyHz:f,positionM:p*tr.scale,velocityMps:v*tr.scale,accelerationMps2:a*tr.scale,phaseRad:tr.type==='sweep'?2*Math.PI*sweepCycles(tr.config,x)+tr.design.phaseOffsetRad:null};}
  const api={bands,validate,sweepFrequency,sweepCycles,buildTrajectory,stateAt};scope.APSweepStimulus=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
