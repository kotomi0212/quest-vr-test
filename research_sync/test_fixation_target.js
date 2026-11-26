const fs=require('fs'),vm=require('vm'),assert=require('assert');
class Vector{constructor(){this.set(0,0,0);}set(x,y,z){Object.assign(this,{x,y,z});}}
class Group{constructor(){this.position=new Vector();this.rotation={};this.children=[];}add(x){this.children.push(x);}}
class Mesh extends Group{}
const context={window:{},AFRAME:{THREE:{Group,Mesh,Vector3:Vector,CircleGeometry:class{},MeshBasicMaterial:class{}}}};
vm.runInNewContext(fs.readFileSync(__dirname+'/fixation_target.js','utf8'),context);
let eye=1.48;const scene={object3D:new Group(),renderer:{xr:{isPresenting:true}},camera:{getWorldPosition(v){v.y=eye;}}};
const target=context.window.FixationTarget;
target.configure(scene,{condition:'dot'});assert.equal(scene.object3D.children[0].visible,false);
assert.equal(target.captureHeight(scene),1.48);assert.equal(scene.object3D.children[0].visible,true);
eye=1.75;target.tick(scene,10);assert.equal(target.position()[1],1.48,'Head movement must not move the fixed target');
target.configure(scene,{condition:'spinner'});assert.equal(target.position()[1],1.48,'Condition changes must preserve captured height');
target.captureHeight(scene);assert.equal(target.position()[1],1.75);
scene.renderer.xr.isPresenting=false;assert.throws(()=>target.captureHeight(scene));
target.clearHeight();assert.equal(scene.object3D.children[0].visible,false);
console.log('PASS: explicit capture only, preserved across condition changes, fixed during head motion, hidden on invalidation');
