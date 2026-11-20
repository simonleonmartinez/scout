import {Interactable,TargetingPriority} from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import {Interactor,TargetingMode} from "InteractionKit.lspkg/Core/Interactor/Interactor";
import {KNEE_SLEEVES,SleeveData} from "./ScoutDummySleeves";

/** A pose: each moved joint's local rotation as [w,x,y,z]. Joints left at rest are omitted. */
export type DummyPose={[joint:string]:number[]};

/** The standing dummy cut into rigid pieces (GeneratedMeshes/Dummy). The prefab input lists them in this
 * order. Each piece hangs from a pivot at its joint, so turning the pivot swings the piece and everything
 * below it, like a real mannequin. Pivots are in the model's own space (cm, 30 tall, facing +Z, +X is the
 * dummy's left); `limit` is how far (degrees) a joint may turn from rest; `lo`/`hi` bound the piece (the
 * imported meshes' own bounds always include the origin, so they can't be used); `ball` is the radii of the
 * dark joint ball that fills the gap when the joint bends, centred at `ballAt`. Each ball is the largest
 * that still fits inside the body at rest, so it only shows through the gap, never over the skin. */
/** A joint that only bends one way about one axis (in its parent's frame), from `min` to `max` degrees. */
type Hinge={axis:vec3;min:number;max:number};
// Knees: the shin only folds back behind the thigh (positive about the dummy's left-right axis). They bend
// through a `sleeve` of the original mesh that deforms with the bend (the kneecap stretches over it)
// rather than two rigid pieces that would gape open at the front.
const KNEE:Hinge={axis:new vec3(1,0,0),min:0,max:140};
const JOINTS:{name:string;parent:string|null;pivot:vec3;limit:number;lo:vec3;hi:vec3;ball?:vec3;ballAt?:vec3;dotAt?:vec3;hinge?:Hinge;sleeve?:SleeveData}[]=[
  // The hips are the whole figure's handle: they turn about the point between the feet, so pulling them
  // tips the dummy over (onto its back, front or side) — no separate tilt control. Their dot sits at the
  // hips, not at that pivot on the floor.
  {name:"pelvis",parent:null,pivot:new vec3(0,0,0),limit:90,lo:new vec3(-2.3,13.5,-2),hi:new vec3(2.3,17,1.9),dotAt:new vec3(0,15.3,0)},
  {name:"torso",parent:"pelvis",pivot:new vec3(0,17,-0.1),limit:40,lo:new vec3(-2.7,17,-2.6),hi:new vec3(2.7,24.3,2.3),ball:new vec3(1.5,0.54,1.04),ballAt:new vec3(0,16.6,-0.1)},
  {name:"head",parent:"torso",pivot:new vec3(0,24.3,-0.55),limit:55,lo:new vec3(-2.4,24.3,-2.7),hi:new vec3(2.4,30,2.7),ball:new vec3(0.78,0.78,0.78),ballAt:new vec3(0,23.9,-0.45)},
  {name:"upperArmL",parent:"torso",pivot:new vec3(3.8,22.2,-0.5),limit:170,lo:new vec3(2.7,17.8,-1.9),hi:new vec3(4.7,23.4,0.7),ball:new vec3(0.63,0.63,0.63),ballAt:new vec3(3.5,22.4,-0.4)},
  {name:"foreArmL",parent:"upperArmL",pivot:new vec3(4.1,17.8,-0.4),limit:145,lo:new vec3(3.5,13.4,-1.3),hi:new vec3(5.1,17.8,0.7),ball:new vec3(0.5,0.5,0.5),ballAt:new vec3(4.1,17.6,-0.6)},
  {name:"upperArmR",parent:"torso",pivot:new vec3(-3.8,22.2,-0.5),limit:170,lo:new vec3(-4.7,17.8,-1.9),hi:new vec3(-2.7,23.2,0.7),ball:new vec3(0.63,0.63,0.63),ballAt:new vec3(-3.5,22.4,-0.4)},
  {name:"foreArmR",parent:"upperArmR",pivot:new vec3(-4.1,17.8,-0.4),limit:145,lo:new vec3(-5.1,13.4,-1.3),hi:new vec3(-3.5,17.8,0.7),ball:new vec3(0.5,0.5,0.5),ballAt:new vec3(-4.1,17.6,-0.6)},
  {name:"thighL",parent:"pelvis",pivot:new vec3(1.5,14.4,-0.1),limit:110,lo:new vec3(0.4,8.8,-1.8),hi:new vec3(3.2,15.2,1.5),ball:new vec3(1.07,1.07,1.07),ballAt:new vec3(1.3,14.6,-0.05)},
  {name:"shinL",parent:"thighL",pivot:new vec3(1.8,8,-0.25),limit:140,lo:new vec3(0.8,0,-2.6),hi:new vec3(3.6,7.8,2.2),hinge:KNEE,sleeve:KNEE_SLEEVES.L},
  {name:"thighR",parent:"pelvis",pivot:new vec3(-1.5,14.4,-0.1),limit:110,lo:new vec3(-3.2,8.8,-1.8),hi:new vec3(-0.4,15.2,1.5),ball:new vec3(1.07,1.07,1.07),ballAt:new vec3(-1.3,14.6,-0.05)},
  {name:"shinR",parent:"thighR",pivot:new vec3(-1.8,8,-0.25),limit:140,lo:new vec3(-3.6,0,-2.6),hi:new vec3(-0.8,7.8,2.2),hinge:KNEE,sleeve:KNEE_SLEEVES.R},
  {name:"handL",parent:"foreArmL",pivot:new vec3(4.45,13.4,0.05),limit:80,lo:new vec3(3.5,10.4,-0.8),hi:new vec3(5,13.4,1.1),ball:new vec3(0.38,0.38,0.38)},
  {name:"handR",parent:"foreArmR",pivot:new vec3(-4.45,13.4,0.05),limit:80,lo:new vec3(-5,10.4,-0.8),hi:new vec3(-3.5,13.4,1.1),ball:new vec3(0.38,0.38,0.38)},
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
// Body before dots before everything else (default order 0): see the constructor.
const BODY_RENDER_ORDER=-10,DOT_RENDER_ORDER=-5;
// The pieces a seated dummy sits on (seatBottom).
const SEAT_PIECES=["pelvis","thighL","thighR"];
const DOT_COLOR:[number,number,number,number]=[0.66,0.5,1,0.9];
// A spot on the dummy's texture that's its dark joint colour (either way up), for the joint balls.
const JOINT_UV=new vec2(0.0083,0.1294);
// Extra room around each piece's grab box (model cm), so thin forearms are easy to catch.
const GRAB_PAD=0.8;

/** A knee drag's hold on the thigh: the hand's sideways pull rolls the thigh about its own length. */
type Twist={thigh:SceneObject;axis:vec3;start:quat;frame:quat;from:vec3;limit:number};
type Drag={bottom:number;interactor:Interactor;node:SceneObject;joint:{limit:number;hinge?:Hinge};direct:boolean;distance:number;from:vec3;start:quat;twist:Twist|null};
// How far a knee drag may roll its thigh either way (degrees).
const THIGH_ROLL=75;

export class PosableDummy {
  readonly root:SceneObject;
  private nodes:{[name:string]:SceneObject}={};
  private visuals:RenderMeshVisual[]=[];
  // Just the imported pieces: the code-built sleeves and balls don't report reliable bounds, and the
  // pieces alone already span the whole figure.
  private pieceVisuals:RenderMeshVisual[]=[];
  private grabs:SceneObject[]=[];
  private dots:SceneObject[]=[];
  private seatVisuals:RenderMeshVisual[]=[];
  private sleeves:{builder:MeshBuilder;data:SleeveData;center:vec3;axis:vec3;node:SceneObject;angle:number}[]=[];
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
    // Without the input, fall back to the pieces' own imported material, so the joint balls, caps and
    // knee sleeves still get built (and match the pieces).
    if(!material){
      const probe=prefabs[0].instantiate(this.root);
      material=collectVisuals(probe)[0]?.mainMaterial??null;
      probe.destroy();
    }
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
        v.meshShadowMode=MeshShadowMode.Caster;
      }
      this.visuals.push(...visuals);this.pieceVisuals.push(...visuals);
      if(SEAT_PIECES.indexOf(j.name)>=0)this.seatVisuals.push(...visuals);
      // The joint ball belongs to the parent piece, so it stays put as a socket while the limb turns in it.
      if(j.ball&&material)this.addBall(j.parent?this.nodes[j.parent]:this.root,(j.ballAt??j.pivot).sub(parentSpec?parentSpec.pivot:vec3.zero()),j.ball,material);
      if(j.sleeve&&j.hinge&&material)this.addSleeve(j.parent?this.nodes[j.parent]:this.root,parentSpec?parentSpec.pivot:vec3.zero(),node,j.pivot,j.hinge.axis,j.sleeve,material);
      if(j.limit>0){
        this.addGrab(node,j);
        if(dots)this.addDot(node,dots,j.dotAt?j.dotAt.sub(j.pivot):vec3.zero());
      }
    });
    // Draw order: the body first, then the joint dots over it (they ignore depth, to show through the
    // body), then everything else at the default order — so a menu or prop in front of the dummy still
    // covers the dots. (The world occluder draws earlier at -100; hand occlusion last.)
    for(const v of collectVisuals(this.root))v.setRenderOrder(BODY_RENDER_ORDER);
    for(const d of this.dots)for(const v of collectVisuals(d))v.setRenderOrder(DOT_RENDER_ORDER);
    if(pose)this.applyPose(pose);
    this.update();
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
  /** Keeps the bendy joints (knee sleeves) in step with their joints. Cheap when nothing moved. */
  update():void {
    for(const sl of this.sleeves){
      if(isNull(sl.node))continue;
      const q=sl.node.getTransform().getLocalRotation(),a=sl.axis;
      const angle=2*Math.atan2(q.x*a.x+q.y*a.y+q.z*a.z,q.w);
      if(Math.abs(angle-sl.angle)<0.002)continue;
      sl.angle=angle;
      this.bendSleeve(sl);
    }
  }
  /** World Y of the underside of the hips and thighs — what a seated dummy rests on. */
  seatBottom():number {
    let y=Infinity;
    for(const v of this.seatVisuals)if(!isNull(v))y=Math.min(y,v.worldAabbMin().y);
    return y;
  }
  /** World Y of the dummy's lowest point, whatever its pose. */
  bottom():number {
    let y=Infinity;
    for(const v of this.pieceVisuals)if(!isNull(v))y=Math.min(y,v.worldAabbMin().y);
    return y;
  }
  /** World Y of the dummy's highest point, whatever its pose. */
  top():number {
    let y=-Infinity;
    for(const v of this.pieceVisuals)if(!isNull(v))y=Math.max(y,v.worldAabbMax().y);
    return y;
  }
  /** World-space box around the whole figure, whatever its pose. */
  bounds():{min:vec3;max:vec3} {
    // Plain numbers: a vec3 can't hold Infinity (it becomes 0).
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(const v of this.pieceVisuals){
      if(isNull(v))continue;
      const a=v.worldAabbMin(),b=v.worldAabbMax();
      lo[0]=Math.min(lo[0],a.x);lo[1]=Math.min(lo[1],a.y);lo[2]=Math.min(lo[2],a.z);
      hi[0]=Math.max(hi[0],b.x);hi[1]=Math.max(hi[1],b.y);hi[2]=Math.max(hi[2],b.z);
    }
    return {min:new vec3(lo[0],lo[1],lo[2]),max:new vec3(hi[0],hi[1],hi[2])};
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
      this.nodes[j.name].getTransform().setLocalRotation(constrain(q,j));
    }
  }
  resetPose():void {
    const before=this.bottom();
    for(const j of JOINTS)this.nodes[j.name].getTransform().setLocalRotation(quat.quatIdentity());
    if(this.onChanged)this.onChanged(before);
  }

  /** A grab box around the piece: pulling it swings the piece about its joint toward the hand. */
  private addGrab(node:SceneObject,j:{pivot:vec3;limit:number;lo:vec3;hi:vec3;hinge?:Hinge;parent?:string|null}):void {
    const lo=j.lo,hi=j.hi;
    const grab=global.scene.createSceneObject("Grab");grab.setParent(node);
    grab.getTransform().setLocalPosition(lo.add(hi).uniformScale(0.5).sub(j.pivot));
    const col=grab.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const box=Shape.createBoxShape();box.size=hi.sub(lo).add(vec3.one().uniformScale(GRAB_PAD*2));col.shape=box;
    const input=grab.createComponent(Interactable.getTypeName()) as Interactable;
    input.targetingMode=3;input.enableInstantDrag=true;
    // Normal priority: the edit handles (arrows, ring) and the menu win over a limb behind them. The
    // dummy's own enclosing hit box is switched off while posing (ScoutMain), so limbs aren't blocked.
    input.targetingPriority=TargetingPriority.Normal;
    input.onTriggerStart.add(e=>{
      e.stopPropagation();
      if(this.drag)return;
      const it=e.interactor,direct=it.activeTargetingMode===TargetingMode.Direct;
      const hit=direct?it.startPoint:(it.targetHitPosition??it.startPoint);
      if(!hit||!it.startPoint)return;
      const from=this.toParent(node,hit);
      if(from.length<0.01)return;
      this.drag={bottom:this.bottom(),interactor:it,node,joint:j,direct,distance:hit.distance(it.startPoint),from,start:node.getTransform().getLocalRotation(),twist:this.twistFor(node,j,hit)};
    });
    input.onTriggerUpdate.add(e=>{
      const d=this.drag;
      if(!d||d.interactor!==e.interactor||d.node!==node)return;
      e.stopPropagation();
      const it=e.interactor;
      if(!it.startPoint||(!d.direct&&!it.direction))return;
      // Up close the hand is the target; from afar, a point along the ray at the distance it grabbed at.
      const point=d.direct?it.startPoint:it.startPoint.add(it.direction.uniformScale(d.distance));
      if(d.twist)this.rollThigh(d.twist,node,point);
      const to=this.toParent(node,point);
      if(to.length<0.01)return;
      const turn=quat.rotationFromTo(d.from.normalize(),to.normalize());
      node.getTransform().setLocalRotation(constrain(turn.multiply(d.start),d.joint));
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
  /** A knee only folds one way, so pulling the shin sideways can't move it on its own: instead that pull
   * rolls the thigh about its own length (hip to knee), which swings the bent shin round to follow — how
   * you'd turn a bent leg's knee in or out. Set up at grab time, in the thigh's frame as it was then. */
  private twistFor(node:SceneObject,j:{pivot:vec3;hinge?:Hinge;parent?:string|null},hit:vec3):Twist|null {
    if(!j.hinge||!j.parent)return null;
    const parentSpec=JOINTS.find(p=>p.name===j.parent);
    if(!parentSpec)return null;
    const thigh=node.getParent();
    const start=thigh.getTransform().getLocalRotation();
    const frame=thigh.getParent().getTransform().getWorldRotation().multiply(start);
    const from=frame.invert().multiplyVec3(hit.sub(node.getTransform().getWorldPosition()));
    return {thigh,axis:j.pivot.sub(parentSpec.pivot).normalize(),start,frame,from,limit:parentSpec.limit};
  }
  private rollThigh(tw:Twist,node:SceneObject,point:vec3):void {
    // The knee sits on the roll axis, so it stays put; compare where the grab and the hand sit around it.
    const to=tw.frame.invert().multiplyVec3(point.sub(node.getTransform().getWorldPosition()));
    const L=tw.axis,flat=(v:vec3)=>v.sub(L.uniformScale(v.dot(L)));
    const a=flat(tw.from),b=flat(to);
    // A straight leg has nothing sticking out sideways to turn by: leave the thigh alone.
    if(a.length<0.3*tw.from.length||b.length<0.01)return;
    let angle=Math.atan2(L.dot(a.cross(b)),a.dot(b))*180/Math.PI;
    angle=Math.max(-THIGH_ROLL,Math.min(THIGH_ROLL,angle));
    const q=tw.start.multiply(quat.angleAxis(angle*Math.PI/180,L));
    tw.thigh.getTransform().setLocalRotation(clampTurn(q,tw.limit));
  }
  /** `world` relative to `node`'s pivot, in its parent's rotation frame (scale only shortens it). */
  private toParent(node:SceneObject,world:vec3):vec3 {
    const pivot=node.getTransform().getWorldPosition();
    const parentRot=node.getParent().getTransform().getWorldRotation();
    return parentRot.invert().multiplyVec3(world.sub(pivot));
  }
  /** A short band of the original mesh around a hinge, rebuilt as it bends: each vertex turns about the
   * joint by a share of the bend that grows from 0 at the parent's edge to all of it at the child's, so
   * the surface stretches smoothly across the joint. Lives in the parent's frame (model coords). */
  private addSleeve(parent:SceneObject,parentPivot:vec3,node:SceneObject,center:vec3,axis:vec3,data:SleeveData,material:Material):void {
    const so=global.scene.createSceneObject("Sleeve");so.setParent(parent);
    so.getTransform().setLocalPosition(parentPivot.uniformScale(-1));
    const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"texture0",components:2}]);
    b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;
    const v=data.v,count=v.length/8;
    // Two copies: the outside, and a flipped inside (reversed winding, normals inverted). The material
    // culls back faces, so this way the band shows whichever way its faces came out of the import.
    for(let side=0;side<2;side++)for(let k=0;k<v.length;k+=8){
      const f=side?-1:1;
      b.appendVerticesInterleaved([v[k],v[k+1],v[k+2],v[k+3]*f,v[k+4]*f,v[k+5]*f,v[k+6],1-v[k+7]]);
    }
    const idx=data.i.slice();
    for(let t=0;t<data.i.length;t+=3)idx.push(data.i[t]+count,data.i[t+2]+count,data.i[t+1]+count);
    b.appendIndices(idx);
    const visual=so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh=b.getMesh();visual.mainMaterial=material;b.updateMesh();
    visual.meshShadowMode=MeshShadowMode.Caster;
    this.visuals.push(visual);
    this.sleeves.push({builder:b,data,center,axis,node,angle:0});
  }
  private bendSleeve(sl:{builder:MeshBuilder;data:SleeveData;center:vec3;axis:vec3;angle:number}):void {
    const v=sl.data.v,c=sl.center;
    // The band's top (parent side) and bottom (child side), from the data itself.
    let top=-Infinity,bot=Infinity;
    for(let k=1;k<v.length;k+=8){top=Math.max(top,v[k]);bot=Math.min(bot,v[k]);}
    for(let k=0,n=0;k<v.length;k+=8,n++){
      const t=Math.min(1,Math.max(0,(top-v[k+1])/(top-bot))),w=t*t*(3-2*t);
      const r=quat.angleAxis(sl.angle*w,sl.axis);
      const p=r.multiplyVec3(new vec3(v[k]-c.x,v[k+1]-c.y,v[k+2]-c.z)).add(c);
      const nn=r.multiplyVec3(new vec3(v[k+3],v[k+4],v[k+5]));
      sl.builder.setVertexInterleaved(n,[p.x,p.y,p.z,nn.x,nn.y,nn.z,v[k+6],1-v[k+7]]);
      sl.builder.setVertexInterleaved(n+v.length/8,[p.x,p.y,p.z,-nn.x,-nn.y,-nn.z,v[k+6],1-v[k+7]]);
    }
    sl.builder.updateMesh();
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
    visual.meshShadowMode=MeshShadowMode.Caster;
    this.visuals.push(visual);
  }
  private addDot(node:SceneObject,material:Material,at:vec3):void {
    const dot=global.scene.createSceneObject("Joint");dot.setParent(node);
    dot.getTransform().setLocalPosition(at);
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
    visual.setRenderOrder(DOT_RENDER_ORDER);
    this.dots.push(dot);
  }
}

/** Keeps a joint's turn natural: a hinge only bends about its axis within its range; anything else may
 * turn any way up to `limit` degrees from rest. */
function constrain(q:quat,j:{limit:number;hinge?:Hinge}):quat {
  if(!j.hinge)return clampTurn(q,j.limit);
  // The part of the turn about the hinge axis (swing-twist), clamped to the hinge's range.
  const a=j.hinge.axis;
  let angle=2*Math.atan2(q.x*a.x+q.y*a.y+q.z*a.z,q.w)*180/Math.PI;
  if(angle>180)angle-=360;else if(angle<-180)angle+=360;
  angle=Math.max(j.hinge.min,Math.min(j.hinge.max,angle));
  return quat.angleAxis(angle*Math.PI/180,a);
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
