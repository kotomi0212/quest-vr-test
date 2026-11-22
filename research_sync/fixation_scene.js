AFRAME.registerComponent('fixation-driver',{
 init(){
  this.state={condition:'none',start:null};this.offset=0;
  const scene=this.el,THREE=AFRAME.THREE;
  this.anchor=new THREE.Group();scene.object3D.add(this.anchor);
  // A sibling of the translating room and camera: fixed in local-floor space.
  this.anchor.position.set(0,1.6,-FixationStimulus.config.distance);
  this.dot=new THREE.Mesh(new THREE.CircleGeometry(FixationStimulus.config.pointRadius,48),new THREE.MeshBasicMaterial({color:0xff2020,depthTest:false}));
  this.dot.renderOrder=100;this.anchor.add(this.dot);
  this.spinner=new THREE.Group();this.anchor.add(this.spinner);
  for(let i=0;i<12;i++){
   const mesh=new THREE.Mesh(new THREE.CircleGeometry(.012,20),new THREE.MeshBasicMaterial({color:0xff2020,transparent:true,opacity:.2+.8*i/11,depthTest:false}));
   mesh.position.set(.065*Math.cos(i*Math.PI/6),.065*Math.sin(i*Math.PI/6),0);mesh.renderOrder=100;this.spinner.add(mesh);
  }
  // Capture eye height once when entering VR, then retain a world-fixed anchor.
  scene.addEventListener('enter-vr',()=>{this.capture=true;});
  const poll=async()=>{try{const before=performance.now()/1000,r=await fetch('/state',{cache:'no-store'}),s=await r.json();this.offset=s.now-(before+performance.now()/1000)/2;this.state=s;}catch(e){} };
  poll();this.timer=setInterval(poll,100);
 },
 tick(){
  if(this.capture&&this.el.camera){const p=new AFRAME.THREE.Vector3();this.el.camera.getWorldPosition(p);if(p.y>.3){this.anchor.position.y=p.y;this.capture=false;}}
  const s=this.state,t=s.start===null?0:Math.max(0,performance.now()/1000+this.offset-s.start);
  document.querySelector('#world').object3D.position.z=-FixationStimulus.state(t).x;
  this.dot.visible=s.condition==='dot';this.spinner.visible=s.condition==='spinner';
  this.spinner.rotation.z=-2*Math.PI*t;
 },
 remove(){clearInterval(this.timer);}
});
