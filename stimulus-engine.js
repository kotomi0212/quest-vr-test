/* Shared deterministic stimulus math. Degrees, seconds, metres. */
(function (scope) {
  'use strict';
  const limits = Object.freeze({ angle: 20, velocity: 30, frequency: 2 });
  function parseCsv(content) {
    const points=[];
    for(const line of content.replace(/^\uFEFF/,'').trim().split(/\r?\n/)) {
      const s=line.trim(); if(!s || s.startsWith('#') || /^time/i.test(s)) continue;
      const cells=s.split(','); if(cells.length!==2 || cells.some(x=>!x.trim())) throw Error('CSV行が不正です');
      const p=cells.map(Number), prev=points.at(-1);
      if(!p.every(Number.isFinite) || p[0]<0 || Math.abs(p[1])>limits.angle || (prev && (p[0]<=prev[0] || Math.abs((p[1]-prev[1])/(p[0]-prev[0]))>limits.velocity))) throw Error('CSV時刻・角度・角速度が範囲外です');
      points.push(p);
    }
    if(points.length<2 || points.length>20000 || points[0][0]!==0 || points[0][1]!==0) throw Error('CSVは原点(0,0)開始、2～20000行が必要です');
    return points;
  }
  function interpolate(p,t) {
    if(t<=p[0][0]) return p[0][1]; if(t>=p.at(-1)[0]) return p.at(-1)[1];
    let a=0,b=p.length-1; while(a+1<b){const m=(a+b)>>1;if(p[m][0]<=t)a=m;else b=m;}
    return p[a][1]+(t-p[a][0])/(p[b][0]-p[a][0])*(p[b][1]-p[a][1]);
  }
  const multi10Frequencies=Object.freeze([3,7,13,23,43,73,113,179,263,367].map(n=>n/125));
  // Smooth-velocity profile: retain all ten frequencies while attenuating the
  // rapid reversals that made the previous capped 1/f weighting look jerky.
  const multi10AmplitudeExponent=1.5;
  function multi10Raw(t) { return multi10Frequencies.reduce((sum,frequency,index)=>
    sum+(index%2?1:-1)*Math.sin(2*Math.PI*frequency*t)/frequency**multi10AmplitudeExponent,0); }
  let multi10Peak=0;
  for(let i=0;i<=125000;i++)multi10Peak=Math.max(multi10Peak,Math.abs(multi10Raw(i/1000)));
  const multi3Frequencies=Object.freeze([0.03,0.1,0.5]);
  function multi3Raw(t) { return multi3Frequencies.reduce((sum,frequency)=>sum+Math.sin(2*Math.PI*frequency*t),0); }
  let multi3Peak=0;
  for(let i=0;i<=100000;i++)multi3Peak=Math.max(multi3Peak,Math.abs(multi3Raw(i/1000)));
  function angle(c,t,p) {
    if(c.mode==='sine')return c.amplitudeDeg*Math.sin(2*Math.PI*c.frequencyHz*t);
    if(c.mode==='multi10')return (c.amplitudePpDeg/2)*multi10Raw(t)/multi10Peak;
    if(c.mode==='multi3')return (c.amplitudePpDeg/2)*multi3Raw(t)/multi3Peak;
    return c.mode==='csv'?interpolate(p,t):0;
  }
  function drawGrid(ctx, width, height) {
    // Thin black horizontal/vertical stripes on white, not alternating tiles.
    // 32 columns over pi metres and 60 rows over six metres: ~10 cm spacing.
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,width,height);
    ctx.fillStyle='#000';
    const dx=width/32, dy=height/60;
    for(let x=0;x<=32;x++) ctx.fillRect(x*dx-dx*.08,0,dx*.16,height);
    for(let y=0;y<=60;y++) ctx.fillRect(0,y*dy-dy*.08,width,dy*.16);
  }
  const api={limits,parseCsv,interpolate,angle,drawGrid,multi10Frequencies,multi10Peak,multi10AmplitudeExponent,multi3Frequencies,multi3Peak}; scope.Stimulus=api;
  if(typeof module!=='undefined') module.exports=api;
})(globalThis);
