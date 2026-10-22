/* Seeded, nonoverlapping convex shapes on three perpendicular metric walls.
 * Geometry generation is independent of stimulus condition and subject height.
 */
(function (scope) {
  'use strict';
  function walls(g) {
    if (![g.frontDistance,g.sideDistance,g.frontWidth,g.wallHeight,g.sideDepth].every(n=>Number.isFinite(n)&&n>0) || Math.abs(g.frontWidth-2*g.sideDistance)>1e-9) throw Error('3面の接続には frontWidth=2×sideDistance が必要です');
    return [
      {id:'front',width:g.frontWidth,height:g.wallHeight,center:[0,0,-g.frontDistance],u:[1,0,0],v:[0,1,0],yaw:0},
      {id:'left',width:g.sideDepth,height:g.wallHeight,center:[-g.sideDistance,0,-g.frontDistance+g.sideDepth/2],u:[0,0,-1],v:[0,1,0],yaw:Math.PI/2},
      {id:'right',width:g.sideDepth,height:g.wallHeight,center:[g.sideDistance,0,-g.frontDistance+g.sideDepth/2],u:[0,0,1],v:[0,1,0],yaw:-Math.PI/2}
    ];
  }
  function shape(pattern) {
    let points;
    if (pattern.type==='triangles') {
      const [a,b,c]=pattern.triangleSidesM||[];
      if (![a,b,c].every(n=>Number.isFinite(n)&&n>0) || a+b<=c || a+c<=b || b+c<=a) throw Error('三角形の辺長が不正です');
      const x=(a*a-b*b)/(2*c), h=Math.sqrt(a*a-(x+c/2)**2);
      points=[[-c/2,0],[c/2,0],[x,h]];
    } else if (pattern.type==='polygon') points=pattern.verticesM;
    else throw Error('対応形状はtrianglesまたは凸polygonです');
    if (!Array.isArray(points)||points.length<3||!points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))) throw Error('形状の頂点が不正です');
    let direction=0;
    for(let i=0;i<points.length;i++) {
      const a=points[i],b=points[(i+1)%points.length],c=points[(i+2)%points.length];
      const cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
      if(Math.abs(cross)<1e-14 || (direction&&Math.sign(cross)!==direction)) throw Error('形状は非退化の凸多角形にしてください');
      direction=Math.sign(cross);
    }
    const mean=[0,1].map(i=>points.reduce((s,p)=>s+p[i],0)/points.length);
    return points.map(p=>p.map((v,i)=>v-mean[i]));
  }
  function overlap(a,b) {
    for(const polygon of [a,b]) for(let i=0;i<polygon.length;i++) {
      const p=polygon[i],q=polygon[(i+1)%polygon.length],axis=[p[1]-q[1],q[0]-p[0]];
      const interval=pts=>pts.map(v=>v[0]*axis[0]+v[1]*axis[1]);
      const x=interval(a),y=interval(b);
      if(Math.max(...x)<=Math.min(...y)+1e-14||Math.max(...y)<=Math.min(...x)+1e-14)return false;
    }
    return true;
  }
  function circleIntersects(points,radius) {
    // Test disk against full polygon, not just its centre or vertices.
    let inside=true,sign=0;
    for(let i=0;i<points.length;i++) {
      const a=points[i],b=points[(i+1)%points.length],dx=b[0]-a[0],dy=b[1]-a[1];
      const cross=dx*(-a[1])-dy*(-a[0]);
      if(cross&&sign&&Math.sign(cross)!==sign)inside=false;
      if(cross)sign=Math.sign(cross);
      const t=Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/(dx*dx+dy*dy)));
      if(Math.hypot(a[0]+t*dx,a[1]+t*dy)<=radius+1e-12)return true;
    }
    return inside;
  }
  function random(seed) { let s=seed>>>0;return ()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s/4294967296;}; }
  function bounds(points) {return {x0:Math.min(...points.map(p=>p[0])),x1:Math.max(...points.map(p=>p[0])),y0:Math.min(...points.map(p=>p[1])),y1:Math.max(...points.map(p=>p[1]))};}
  function generate(config) {
    const p=config.pattern, canonical=shape(p), next=random(p.seed);
    if(!Number.isInteger(p.seed)||p.seed<0||p.seed>4294967295||!Number.isInteger(p.countPerWall)||p.countPerWall<1||
      !Number.isInteger(p.maxPlacementAttempts)||p.maxPlacementAttempts<p.countPerWall||!Number.isFinite(p.centralBlankRadius)||p.centralBlankRadius<0||
      typeof p.fixationPoint!=='boolean'||!Number.isFinite(p.fixationDiameter)||p.fixationDiameter<=0)throw Error('配置数・乱数シード・中央空白等が不正です');
    const result=walls(config.geometry).map(w=>{
      const polygons=[],boxes=[];
      for(let attempt=0;polygons.length<p.countPerWall&&attempt<p.maxPlacementAttempts;attempt++) {
        const angle=next()*2*Math.PI,c=Math.cos(angle),s=Math.sin(angle),x=(next()-.5)*w.width,y=(next()-.5)*w.height;
        const polygon=canonical.map(v=>[x+c*v[0]-s*v[1],y+s*v[0]+c*v[1]]),box=bounds(polygon);
        if(box.x0<-w.width/2||box.x1>w.width/2||box.y0<-w.height/2||box.y1>w.height/2)continue;
        if(w.id==='front'&&p.centralBlankRadius>0&&circleIntersects(polygon,p.centralBlankRadius))continue;
        if(polygons.some((other,i)=>{const b=boxes[i];return !(box.x1<b.x0||box.x0>b.x1||box.y1<b.y0||box.y0>b.y1)&&overlap(polygon,other);}))continue;
        polygons.push(polygon);boxes.push(box);
      }
      if(polygons.length!==p.countPerWall)throw Error(w.id+': 指定数を重なりなく配置できません。個数は自動で減らしません');
      return {...w,polygons};
    });
    // Stable diagnostic fingerprint, not a cryptographic hash.
    let hash=2166136261;
    for(const ch of JSON.stringify(result.map(w=>w.polygons)))hash=Math.imul(hash^ch.charCodeAt(0),16777619)>>>0;
    return {walls:result,fingerprint:hash.toString(16).padStart(8,'0'),seed:p.seed,count:result.reduce((n,w)=>n+w.polygons.length,0)};
  }
  function point(w,p) {return w.center.map((v,i)=>v+w.u[i]*p[0]+w.v[i]*p[1]);}
  function build(THREE,model,pattern) {
    const group=new THREE.Group(), white=[];
    for(const wall of model.walls) {
      const black=new THREE.Mesh(new THREE.PlaneGeometry(wall.width,wall.height),new THREE.MeshBasicMaterial({color:0x000000,side:THREE.DoubleSide,toneMapped:false,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1}));
      black.position.set(...wall.center);black.rotation.y=wall.yaw;group.add(black);
      for(const polygon of wall.polygons) for(let j=1;j<polygon.length-1;j++)for(const vertex of [polygon[0],polygon[j],polygon[j+1]])white.push(...point(wall,vertex));
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(white,3));
    group.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide,toneMapped:false})));
    const fixation=new THREE.Mesh(new THREE.CircleGeometry(pattern.fixationDiameter/2,16),new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide,toneMapped:false}));
    fixation.position.set(...model.walls[0].center);fixation.visible=pattern.fixationPoint;group.add(fixation);
    group.userData.fixation=fixation;
    return group;
  }
  const api={walls,shape,overlap,circleIntersects,generate,point,build};scope.KiemelEnvironment=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
