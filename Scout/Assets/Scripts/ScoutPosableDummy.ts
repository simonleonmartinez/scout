import {Interactable,TargetingPriority} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import {Interactor,TargetingMode} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";

/** A pose: each moved joint's local rotation as [w,x,y,z]. Joints left at rest are omitted. */
export type DummyPose={[joint:string]:number[]};

/** The standing dummy cut into rigid pieces (GeneratedMeshes/Dummy). The prefab input lists them in this
 * order. Each piece hangs from a pivot at its joint, so turning the pivot swings the piece and everything
 * below it, like a real mannequin. Pivots are in the model's own space (cm, 30 tall, facing +Z, +X is the
 * dummy's left); `limit` is how far (degrees) a joint may turn from rest; `lo`/`hi` bound the piece (the
 * imported meshes' own bounds always include the origin, so they can't be used); `ball` is the radii of the
 * dark joint ball that fills the gap when the joint bends, centred at `ballAt`. Each ball is the largest
 * that still fits inside the body at rest, so it only shows through the gap, never over the skin. */
const JOINTS:{name:string;parent:string|null;pivot:vec3;limit:number;lo:vec3;hi:vec3;ball?:vec3;ballAt?:vec3}[]=[
  {name:"pelvis",parent:null,pivot:new vec3(0,0,0),limit:0,lo:new vec3(-2.3,13.5,-2),hi:new vec3(2.3,17,1.9)},
  {name:"torso",parent:"pelvis",pivot:new vec3(0,17,-0.1),limit:40,lo:new vec3(-2.7,17,-2.6),hi:new vec3(2.7,24.3,2.3),ball:new vec3(1.5,0.54,1.04),ballAt:new vec3(0,16.6,-0.1)},
  {name:"head",parent:"torso",pivot:new vec3(0,24.3,-0.55),limit:55,lo:new vec3(-2.4,24.3,-2.7),hi:new vec3(2.4,30,2.7),ball:new vec3(0.78,0.78,0.78),ballAt:new vec3(0,23.9,-0.45)},
  {name:"upperArmL",parent:"torso",pivot:new vec3(3.8,22.2,-0.5),limit:170,lo:new vec3(2.7,17.8,-1.9),hi:new vec3(4.7,23.4,0.7),ball:new vec3(0.63,0.63,0.63),ballAt:new vec3(3.5,22.4,-0.4)},
  {name:"foreArmL",parent:"upperArmL",pivot:new vec3(4.1,17.8,-0.4),limit:145,lo:new vec3(3.5,10.4,-1.3),hi:new vec3(5.1,17.8,1.1),ball:new vec3(0.5,0.5,0.5),ballAt:new vec3(4.1,17.6,-0.6)},
  {name:"upperArmR",parent:"torso",pivot:new vec3(-3.8,22.2,-0.5),limit:170,lo:new vec3(-4.7,17.8,-1.9),hi:new vec3(-2.7,23.2,0.7),ball:new vec3(0.63,0.63,0.63),ballAt:new vec3(-3.5,22.4,-0.4)},
  {name:"foreArmR",parent:"upperArmR",pivot:new vec3(-4.1,17.8,-0.4),limit:145,lo:new vec3(-5.1,10.4,-1.3),hi:new vec3(-3.5,17.8,1.1),ball:new vec3(0.5,0.5,0.5),ballAt:new vec3(-4.1,17.6,-0.6)},
  {name:"thighL",parent:"pelvis",pivot:new vec3(1.5,14.4,-0.1),limit:110,lo:new vec3(0.4,8,-1.8),hi:new vec3(3.2,15.2,1.5),ball:new vec3(1.07,1.07,1.07),ballAt:new vec3(1.3,14.6,-0.05)},
  {name:"shinL",parent:"thighL",pivot:new vec3(1.8,8,-0.25),limit:140,lo:new vec3(0.8,0,-2.6),hi:new vec3(3.6,8,2.2),ball:new vec3(0.69,0.69,0.69),ballAt:new vec3(1.8,8.2,-0.45)},
  {name:"thighR",parent:"pelvis",pivot:new vec3(-1.5,14.4,-0.1),limit:110,lo:new vec3(-3.2,8,-1.8),hi:new vec3(-0.4,15.2,1.5),ball:new vec3(1.07,1.07,1.07),ballAt:new vec3(-1.3,14.6,-0.05)},
  {name:"shinR",parent:"thighR",pivot:new vec3(-1.8,8,-0.25),limit:140,lo:new vec3(-3.6,0,-2.6),hi:new vec3(-0.8,8,2.2),ball:new vec3(0.69,0.69,0.69),ballAt:new vec3(-1.8,8.2,-0.45)},
];
export const DUMMY_PART_COUNT=JOINTS.length;
/** The seated subject is the same posable dummy, starting from this pose: thighs forward, shins down,
 * hands resting toward the knees. */
export const SEATED_POSE:DummyPose={
  thighL:[0.7071,-0.7071,0,0],thighR:[0.7071,-0.7071,0,0],
  shinL:[0.7071,0.7071,0,0],shinR:[0.7071,0.7071,0,0],
  upperArmL:[0.9848,-0.1736,0,0],upperArmR:[0.9848,-0.1736,0,0],
  foreArmL:[0.906,-0.4226,0,0],foreArmR:[0.906,-0.4226,0,0],
};
// Purple dots marking each joint while posing (model cm; the dummy is scaled up ~5.7x in the world).
const DOT_RADIUS=0.45;
const DOT_COLOR:[number,number,number,number]=[0.66,0.5,1,0.9];
// A spot on the dummy's texture that's its dark joint colour (either way up), for the joint balls.
const JOINT_UV=new vec2(0.0083,0.1294);
// Extra room around each piece's grab box (model cm), so thin forearms are easy to catch.
const GRAB_PAD=0.8;

type Drag={bottom:number;interactor:Interactor;node:SceneObject;limit:number;direct:boolean;distance:number;from:vec3;start:quat};

export class PosableDummy {
  readonly root:SceneObject;
  private nodes:{[name:string]:SceneObject}={};
  private visuals:RenderMeshVisual[]=[];
  private grabs:SceneObject[]=[];
  private dots:SceneObject[]=[];
  private editable=true;
  private drag:Drag=null;
  /** Called when a limb is let go, with where the dummy's lowest point was before the move. */
  onChanged:(bottomBefore:number)=>void=null;
  get dragging():boolean {return this.drag!==null;}

  constructor(parent:SceneObject,prefabs:ObjectPrefab[],material:Material|null,dotMaterial:Material|null,pose?:DummyPose){
    this.root=global.scene.createSceneObject("Dummy");this.root.setParent(parent);
    const dots=dotMaterial?dotMaterial.clone():null;
    // The dots sit inside the body at the joint centres, so they draw on top.
    if(dots){dots.mainPass.depthTest=false;dots.mainPass.depthWrite=false;}
    JOINTS.forEach((j,i)=>{
      const node=global.scene.createSceneObject(j.name);
      const parentSpec=j.parent?JOINTS.find(p=>p.name===j.parent):null;
      node.setParent(j.parent?this.nodes[j.parent]:this.root);
      node.getTransform().setLocalPosition(parentSpec?j.pivot.sub(parentSpec.pivot):j.pivot);
      this.nodes[j.name]=node;
      const piece=prefabs[i].instantiate(node);
      piece.getTransform().setLocalPosition(j.pivot.uniformScale(-1));
      const visuals=collectVisuals(piece);
      for(const v of visuals){
        if(material)v.mainMaterial=material;
        v.meshShadowMode=MeshShadowMode.Both;
      }
      this.visuals.push(...visuals);
      // The joint ball belongs to the parent piece, so it stays put as a socket while the limb turns in it.
      if(j.ball&&material)this.addBall(j.parent?this.nodes[j.parent]:this.root,(j.ballAt??j.pivot).sub(parentSpec?parentSpec.pivot:vec3.zero()),j.ball,material);
      if(j.limit>0){
        this.addGrab(node,j);
        if(dots)this.addDot(node,dots);
      }
    });
    if(pose)this.applyPose(pose);
    this.setEditable(false);
  }
  /** Limbs can be grabbed (and the joint dots show) only while editing. */
  setEditable(on:boolean):void {
    if(on===this.editable)return;
    this.editable=on;
    for(const g of this.grabs)g.enabled=on;
    for(const d of this.dots)d.enabled=on;
    if(!on)this.drag=null;
  }
  /** World Y of the dummy's lowest point, whatever its pose. */
  bottom():number {
    let y=Infinity;
    for(const v of this.visuals)if(!isNull(v))y=Math.min(y,v.worldAabbMin().y);
    return y;
  }
  /** World Y of the dummy's highest point, whatever its pose. */
  top():number {
    let y=-Infinity;
    for(const v of this.visuals)if(!isNull(v))y=Math.max(y,v.worldAabbMax().y);
    return y;
  }
  pose():DummyPose {
    const out:DummyPose={};
    for(const j of JOINTS){
      const q=this.nodes[j.name].getTransform().getLocalRotation();
      if(Math.abs(q.w)<0.9999)out[j.name]=[q.w,q.x,q.y,q.z].map(n=>Math.round(n*10000)/10000);
    }
    return out;
  }
  applyPose(pose:DummyPose):void {
    for(const j of JOINTS){
      const v=pose[j.name];
      if(!Array.isArray(v)||v.length!==4||!v.every(n=>typeof n==="number"&&Number.isFinite(n)))continue;
      const len=Math.hypot(v[0],v[1],v[2],v[3]);
      if(len<0.5)continue;
      const q=new quat(v[0]/len,v[1]/len,v[2]/len,v[3]/len);
      this.nodes[j.name].getTransform().setLocalRotation(clampTurn(q,j.limit));
    }
  }
  resetPose():void {
    const before=this.bottom();
    for(const j of JOINTS)this.nodes[j.name].getTransform().setLocalRotation(quat.quatIdentity());
    if(this.onChanged)this.onChanged(before);
  }

  /** A grab box around the piece: pulling it swings the piece about its joint toward the hand. */
  private addGrab(node:SceneObject,j:{pivot:vec3;limit:number;lo:vec3;hi:vec3}):void {
    const lo=j.lo,hi=j.hi;
    const grab=global.scene.createSceneObject("Grab");grab.setParent(node);
    grab.getTransform().setLocalPosition(lo.add(hi).uniformScale(0.5).sub(j.pivot));
    const col=grab.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const box=Shape.createBoxShape();box.size=hi.sub(lo).add(vec3.one().uniformScale(GRAB_PAD*2));col.shape=box;
    const input=grab.createComponent(Interactable.getTypeName()) as Interactable;
    input.targetingMode=3;input.enableInstantDrag=true;
    // Wins over the dummy's own (bigger, enclosing) collider.
    input.targetingPriority=TargetingPriority.High;
    input.onTriggerStart.add(e=>{
      e.stopPropagation();
      if(this.drag)return;
      const it=e.interactor,direct=it.activeTargetingMode===TargetingMode.Direct;
      const hit=direct?it.startPoint:(it.targetHitPosition??it.startPoint);
      if(!hit||!it.startPoint)return;
      const from=this.toParent(node,hit);
      if(from.length<0.01)return;
      this.drag={bottom:this.bottom(),interactor:it,node,limit:j.limit,direct,distance:hit.distance(it.startPoint),from,start:node.getTransform().getLocalRotation()};
    });
    input.onTriggerUpdate.add(e=>{
      const d=this.drag;
      if(!d||d.interactor!==e.interactor||d.node!==node)return;
      e.stopPropagation();
      const it=e.interactor;
      if(!it.startPoint||(!d.direct&&!it.direction))return;
      // Up close the hand is the target; from afar, a point along the ray at the distance it grabbed at.
      const point=d.direct?it.startPoint:it.startPoint.add(it.direction.uniformScale(d.distance));
      const to=this.toParent(node,point);
      if(to.length<0.01)return;
      const turn=quat.rotationFromTo(d.from.normalize(),to.normalize());
      node.getTransform().setLocalRotation(clampTurn(turn.multiply(d.start),d.limit));
    });
    const end=()=>{
      if(!this.drag||this.drag.node!==node)return;
      const before=this.drag.bottom;
      this.drag=null;
      if(this.onChanged)this.onChanged(before);
    };
    input.onTriggerEnd.add(end);input.onTriggerEndOutside.add(end);input.onTriggerCanceled.add(end);
    this.grabs.push(grab);
  }
  /** `world` relative to `node`'s pivot, in its parent's rotation frame (scale only shortens it). */
  private toParent(node:SceneObject,world:vec3):vec3 {
    const pivot=node.getTransform().getWorldPosition();
    const parentRot=node.getParent().getTransform().getWorldRotation();
    return parentRot.invert().multiplyVec3(world.sub(pivot));
  }
  private addBall(parent:SceneObject,at:vec3,radii:vec3,material:Material):void {
    const ball=global.scene.createSceneObject("Joint ball");ball.setParent(parent);
    ball.getTransform().setLocalPosition(at);
    const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"texture0",components:2}]);
    b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;
    const lat=10,lon=16,idx:number[]=[];
    for(let i=0;i<=lat;i++)for(let k=0;k<=lon;k++){
      const t=i*Math.PI/lat,p=k*2*Math.PI/lon;
      const u=new vec3(Math.sin(t)*Math.cos(p),Math.cos(t),Math.sin(t)*Math.sin(p));
      const n=new vec3(u.x/radii.x,u.y/radii.y,u.z/radii.z).normalize();
      b.appendVerticesInterleaved([u.x*radii.x,u.y*radii.y,u.z*radii.z,n.x,n.y,n.z,JOINT_UV.x,JOINT_UV.y]);
      if(i<lat&&k<lon){const a=i*(lon+1)+k;idx.push(a,a+1,a+lon+1,a+1,a+lon+2,a+lon+1);}
    }
    b.appendIndices(idx);
    const visual=ball.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh=b.getMesh();visual.mainMaterial=material;b.updateMesh();
    visual.meshShadowMode=MeshShadowMode.Both;
    this.visuals.push(visual);
  }
  private addDot(node:SceneObject,material:Material):void {
    const dot=global.scene.createSceneObject("Joint");dot.setParent(node);
    const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
    b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;
    const lat=6,lon=10,idx:number[]=[];
    for(let i=0;i<=lat;i++)for(let k=0;k<=lon;k++){
      const t=i*Math.PI/lat,p=k*2*Math.PI/lon;
      const n=new vec3(Math.sin(t)*Math.cos(p),Math.cos(t),Math.sin(t)*Math.sin(p));
      b.appendVerticesInterleaved([n.x*DOT_RADIUS,n.y*DOT_RADIUS,n.z*DOT_RADIUS,n.x,n.y,n.z,...DOT_COLOR]);
      if(i<lat&&k<lon){const a=i*(lon+1)+k;idx.push(a,a+lon+1,a+1,a+1,a+lon+1,a+lon+2);}
    }
    b.appendIndices(idx);
    const visual=dot.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh=b.getMesh();visual.mainMaterial=material;b.updateMesh();
    visual.setRenderOrder(50);
    this.dots.push(dot);
  }
}

/** Limits a joint's turn from rest to `limit` degrees. */
function clampTurn(q:quat,limit:number):quat {
  if(q.w<0)q=new quat(-q.w,-q.x,-q.y,-q.z);
  const angle=2*Math.acos(Math.min(1,Math.abs(q.w)))*180/Math.PI;
  return angle<=limit?q:quat.slerp(quat.quatIdentity(),q,limit/angle);
}
function collectVisuals(root:SceneObject,out:RenderMeshVisual[]=[]):RenderMeshVisual[] {
  const v=root.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
  if(v)out.push(v);
  for(let i=0;i<root.getChildrenCount();i++)collectVisuals(root.getChild(i),out);
  return out;
}
