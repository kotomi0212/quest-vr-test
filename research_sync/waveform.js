(function(root){
  function evaluate(t,c){
    if(c.waveform==='sampled_centered_sweep'){
      const T=c.duration_s,h=c.sample_step_s,s=c.samples_xva;
      if(t<0)return{x:s[0][0],v:0,a:0};
      if(t>T)return{x:s[s.length-1][0],v:0,a:0};
      const i=Math.min(s.length-2,Math.floor(t/h)),u=(t-i*h)/h;
      const [x0,v0,a0]=s[i],[x1,v1,a1]=s[i+1];
      // Quintic Hermite interpolation: x, v, a are derivatives of the same curve.
      const c0=x0,c1=h*v0,c2=h*h*a0/2;
      const dx=x1-c0-c1-c2,dv=h*v1-c1-2*c2,da=h*h*a1-2*c2;
      const c3=10*dx-4*dv+da/2,c4=-15*dx+7*dv-da,c5=6*dx-3*dv+da/2;
      return{x:c0+u*(c1+u*(c2+u*(c3+u*(c4+u*c5)))),
        v:(c1+u*(2*c2+u*(3*c3+u*(4*c4+u*5*c5))))/h,
        a:(2*c2+u*(6*c3+u*(12*c4+u*20*c5)))/(h*h)};
    }
    if(c.waveform==='pilot_acceleration_multicosine'){
      const T=c.duration_s,R=c.ramp_s;if(t<=0||t>=T)return{x:0,v:0,a:0};
      let x=0,v=0,a=0;
      c.frequencies_hz.forEach((f,k)=>{const w=2*Math.PI*f,z=w*t+c.phases_rad[k];x-=Math.cos(z)/w**2;v+=Math.sin(z)/w;a+=Math.cos(z);});
      const u=Math.max(0,Math.min(1,Math.min(t,T-t)/R));
      const e=10*u**3-15*u**4+6*u**5,d=u>0&&u<1?(30*u**2-60*u**3+30*u**4)/R*(t<T/2?1:-1):0;
      const dd=u>0&&u<1?(60*u-180*u**2+120*u**3)/R**2:0,A=c.acceleration_component_m_s2;
      return{x:A*e*x,v:A*(e*v+d*x),a:A*(e*a+2*d*v+dd*x)};
    }
    if(c.waveform==='fixation_single_sine')return (root.FixationStimulus||(typeof require!=='undefined'?require('./fixation.js'):null)).state(t);
    if(c.schema===2&&c.waveform==='endpoint_stationary_multicosine'){
      const T=c.duration_s,R=c.stationary_start_s;
      if(t<0||t>T)return{x:0,v:0,a:0};
      let x=0,v=0,a=0;
      c.frequencies_hz.forEach((f,k)=>{
        const w=2*Math.PI*f,theta=c.endpoint_phases_rad[k],z=w*(t-T)+theta;
        x+=(Math.cos(theta)-Math.cos(z))/w**2;v+=Math.sin(z)/w;a+=Math.cos(z);
      });
      const u=Math.max(0,Math.min(1,t/R)),e=10*u**3-15*u**4+6*u**5;
      const d=t>0&&t<R?(30*u**2-60*u**3+30*u**4)/R:0;
      const dd=t>0&&t<R?(60*u-180*u**2+120*u**3)/R**2:0;
      const A=c.acceleration_component_m_s2;
      return{x:A*e*x,v:A*(e*v+d*x),a:A*(e*a+2*d*v+dd*x)};
    }
    let x=0,v=0,a=0;
    c.frequencies_hz.forEach((f,k)=>{const w=2*Math.PI*f,z=w*t+c.phases_rad[k];x-=Math.cos(z)/w**2;v+=Math.sin(z)/w;a+=Math.cos(z);});
    const A=c.acceleration_component_m_s2,u=Math.max(0,Math.min(1,Math.min(t,90-t)/5));
    const e=10*u**3-15*u**4+6*u**5;
    const d=(u>0&&u<1)?(30*u**2-60*u**3+30*u**4)*(t<45?1:-1)/5:0;
    const dd=(u>0&&u<1)?(60*u-180*u**2+120*u**3)/25:0;
    return {x:A*e*x,v:A*(e*v+d*x),a:A*(e*a+2*d*v+dd*x)};
  }
  root.ResearchWaveform={evaluate};
  if(typeof module!=='undefined')module.exports={evaluate};
})(typeof window!=='undefined'?window:globalThis);
