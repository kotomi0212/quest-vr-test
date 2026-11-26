(function(){
 let anchor,dot,spinner,cfg=null,height=null;
 window.FixationTarget={
  configure(scene,config){
   cfg=config;
   if(!anchor){
    const T=AFRAME.THREE;anchor=new T.Group();scene.object3D.add(anchor);
    dot=new T.Mesh(new T.CircleGeometry(.025,48),new T.MeshBasicMaterial({color:0xff2020,depthTest:false}));dot.renderOrder=100;anchor.add(dot);
    spinner=new T.Group();anchor.add(spinner);
    for(let i=0;i<12;i++){
     const m=new T.Mesh(new T.CircleGeometry(.012,20),new T.MeshBasicMaterial({color:0xff2020,transparent:true,opacity:.2+.8*i/11,depthTest:false}));
     m.position.set(.065*Math.cos(i*Math.PI/6),.065*Math.sin(i*Math.PI/6),0);m.renderOrder=100;spinner.add(m);
    }

   }
   anchor.visible=height!==null&&!!cfg&&cfg.condition!=='none';
   anchor.position.set(0,height??1.6,-(cfg?.distance_m||2.5));
   dot.visible=cfg?.condition==='dot';spinner.visible=cfg?.condition==='spinner';
  },
  captureHeight(scene){
   if(!scene.renderer?.xr?.isPresenting||!scene.camera)throw new Error('Questを装着してVR表示に入ってください');
   const p=new AFRAME.THREE.Vector3();scene.camera.getWorldPosition(p);
   if(!Number.isFinite(p.y)||p.y<=.3||p.y>3)throw new Error('目線高さを取得できません。トラッキングを確認してください');
   height=p.y;if(anchor){anchor.position.y=height;anchor.visible=!!cfg&&cfg.condition!=='none';}return height;
  },
  clearHeight(){height=null;if(anchor)anchor.visible=false;},
  tick(scene,t){
   if(!anchor||!cfg)return;

   spinner.rotation.z=-2*Math.PI*(cfg.spinner_rate_hz||1)*t;
  },
  position(){return cfg&&cfg.condition!=='none'?[anchor.position.x,anchor.position.y,anchor.position.z]:null;}
 };
})();
