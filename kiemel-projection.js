/* Fixed CAVE screens; monocular stimulus rendered from the calibrated reference eye.
 * Head tracking affects only viewing the screens, never these projection cameras.
 */
(function(scope){
  'use strict';
  function frustum(w,near=.01,far=100){
    const n=[w.u[1]*w.v[2]-w.u[2]*w.v[1],w.u[2]*w.v[0]-w.u[0]*w.v[2],w.u[0]*w.v[1]-w.u[1]*w.v[0]];
    const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),d=-dot(w.center,n),x=dot(w.center,w.u),y=dot(w.center,w.v);
    if(!(d>near))throw Error('Projection reference eye must be inside the screens');
    return {left:(x-w.width/2)*near/d,right:(x+w.width/2)*near/d,bottom:(y-w.height/2)*near/d,top:(y+w.height/2)*near/d,near,far,normal:n};
  }
  function create(T,model,pattern,resolution){
    if(!Number.isInteger(resolution)||resolution<256||resolution>2048)throw Error('Projection resolution must be 256..2048');
    const scene=new T.Scene();scene.background=new T.Color(0);
    const source=scope.KiemelEnvironment.build(T,model,pattern);scene.add(source);
    const screens=new T.Group(),views=model.walls.map(w=>{
      const f=frustum(w),camera=new T.PerspectiveCamera();
      camera.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3(...w.u),new T.Vector3(...w.v),new T.Vector3(...f.normal)));
      camera.projectionMatrix.makePerspective(f.left,f.right,f.top,f.bottom,f.near,f.far);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();camera.updateMatrixWorld(true);
      const target=new T.WebGLRenderTarget(resolution,resolution,{depthBuffer:true,stencilBuffer:false});
      target.texture.colorSpace=T.SRGBColorSpace;target.texture.generateMipmaps=false;
      const screen=new T.Mesh(new T.PlaneGeometry(w.width,w.height),new T.MeshBasicMaterial({map:target.texture,side:T.DoubleSide,toneMapped:false}));
      screen.position.set(...w.center);screen.rotation.y=w.yaw;screens.add(screen);
      return {camera,target,screen};
    });
    screens.userData.projection={source,views,scene,referenceEye:[0,0,0],resolution,clearColor:new T.Color(),dirty:true,updateCount:0};
    return screens;
  }
  // Pose updates only mark dirty. Render once, immediately before the main scene.
  function request(screens){screens.userData.projection.dirty=true;}
  function renderPending(renderer,screens){
    if(screens?.userData.projection.dirty)render(renderer,screens);
  }
  function render(renderer,screens){
    const p=screens.userData.projection,oldTarget=renderer.getRenderTarget(),enabled=renderer.xr.enabled;
    const cubeFace=renderer.getActiveCubeFace(),mipmap=renderer.getActiveMipmapLevel();
    const autoClear=renderer.autoClear,alpha=renderer.getClearAlpha();renderer.getClearColor(p.clearColor);
    try{
      renderer.xr.enabled=false;renderer.autoClear=true;
      for(const v of p.views){renderer.setRenderTarget(v.target);renderer.render(p.scene,v.camera);}
      p.dirty=false;p.updateCount++;
    }finally{
      // setRenderTarget restores that target's physical viewport/scissor itself.
      // getViewport() is the logical canvas viewport: never apply it to an XR target.
      renderer.setRenderTarget(oldTarget,cubeFace,mipmap);
      renderer.setClearColor(p.clearColor,alpha);renderer.autoClear=autoClear;renderer.xr.enabled=enabled;
    }
  }
  const api={frustum,create,request,renderPending,render};scope.KiemelProjection=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
