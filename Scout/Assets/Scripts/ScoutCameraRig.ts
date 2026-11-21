import {BackPlate} from "UIKit.lspkg/Scripts/BackPlate";
import {Interactable} from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import {Interactor,TargetingMode} from "InteractionKit.lspkg/Core/Interactor/Interactor";
import {addBackPlateHover,addHoverFeedback} from "./ScoutHover";
import {BODY_INK,child,image,panel,styleBack,text} from "./ScoutOnboarding";

/** Which camera sits on the tripod: the cinema camera (video) or the vintage stills camera (photo). */
export type BodyKind="cinema"|"photo";
export const BODY_KINDS:BodyKind[]=["cinema","photo"];
const BODY_ICONS:{[k in BodyKind]:Texture}={
  cinema:requireAsset("../Icons/videocam.png") as Texture,
  photo:requireAsset("../Icons/photo_camera.png") as Texture,
};
/** How the camera is held: on the tripod, or handheld by a camera operator (one per body). */
export type MountKind="tripod"|"handheld";
export const MOUNT_KINDS:MountKind[]=["tripod","handheld"];
// The mount buttons are worded (icons alone read ambiguously).
const MOUNT_LABELS:{[k in MountKind]:string}={tripod:"Tripod",handheld:"Handheld"};
/** A handheld operator's height (cm): the floating UI sits above their head. */
const OPERATOR_HEIGHT=175;
const HEIGHT_ICON=requireAsset("../Icons/height.png") as Texture;
const TILT_ICON=requireAsset("../Icons/tilt.png") as Texture;

/** The tripod is the original ShotScout camera's, cut into legs / centre column / pan head
 * (Assets/GeneratedMeshes/CameraRig); either body sits on the head. All in cm, column axis at the
 * origin, feet at y=0, lens along +X. */
export type RigPrefabs={tripod:ObjectPrefab[];bodies:{[k in BodyKind]:ObjectPrefab};
  /** Camera operators holding each body (Assets/GeneratedMeshes/Handheld), feet at the origin, facing +X. */
  handheld?:{[k in BodyKind]:ObjectPrefab}};

/** How far the centre column can rise (cm). */
export const MAX_LIFT=40;

// The column runs 38.4-98.2 cm inside the legs; the head (and the body on it) starts at 100.1 cm. The
// column is stretched (bottom fixed) so its top always meets the head, closing the cut gap once raised.
const COLUMN_BOTTOM=38.4,COLUMN_TOP=98.2,HEAD_BASE=100.1;

/** Total height at no lift, per body (cm). */
export function rigHeight(body:BodyKind):number {return body==="cinema"?145:127;}

/** How far the camera can tilt up or down (degrees). */
export const MAX_TILT=60;
// The head tilts about a point just above its narrow base (the plate and handle swing with the camera).
const TILT_PIVOT=4;
// Tilt wheel per body, centred on the tilt axis on the camera's left side (the tilting frame: x along
// the lens, y up, z sideways; the camera's left is -z), so it turns in place as the camera tilts.
const WHEEL:{[k in BodyKind]:{center:vec3;radius:number}}={
  cinema:{center:new vec3(0,0,-24),radius:9},
  photo:{center:new vec3(0,0,-19),radius:7},
};

/** A Camera prop's rig: builds the parts under `parent` (feet at its origin), raises the column and
 * tilts the head. */
/** What the tilt wheel needs from a rig: the part that tilts (the wheel hangs off it, turning about its
 * local Z), where the wheel goes, and the tilt itself. */
export interface TiltRig {
  readonly tilting:SceneObject;
  readonly wheel:{center:vec3;radius:number};
  readonly tiltAngle:number;
}

/** Called whenever a built rig's height changes (cm, + is up) — for the tripod sound — or its tilt
 * changes (degrees) — for the dial clicks. `muted` while code (not the user) sets them, e.g. a restored
 * layout's saved tilt. */
export const RigSounds:{onLift:((delta:number)=>void)|null;onTilt:((delta:number)=>void)|null;muted:boolean}={onLift:null,onTilt:null,muted:false};

export class CameraRig implements TiltRig {
  private column:SceneObject;
  private tilt:SceneObject;
  private bodyObject:SceneObject=null;
  private liftCm=0;
  private built=false;
  private tiltDeg=0;
  private bodyKind:BodyKind;
  private mountKind:MountKind="tripod";
  private legs:SceneObject;
  private operator:SceneObject=null;
  constructor(private parent:SceneObject,private prefabs:RigPrefabs,body:BodyKind,lift:number,tilt=0,mount:MountKind="tripod"){
    // Legs first: the marker code measures the prop's feet from the first mesh it finds.
    const [legs,column,head]=prefabs.tripod.map(p=>p?p.instantiate(parent):null);
    if(legs)legs.name="Tripod legs";
    this.legs=legs;
    this.column=column;
    this.tilt=global.scene.createSceneObject("Tilt");this.tilt.setParent(parent);
    if(head){head.setParent(this.tilt);head.getTransform().setLocalPosition(new vec3(0,-TILT_PIVOT,0));}
    this.setBody(body);
    this.setLift(lift);
    this.setTilt(tilt);
    this.setMount(mount);
    this.built=true;
  }
  get lift():number {return this.liftCm;}
  get tiltAngle():number {return this.tiltDeg;}
  get body():BodyKind {return this.bodyKind;}
  get mount():MountKind {return this.mountKind;}
  /** Whether handheld operators are available (their models are wired). */
  get canHandhold():boolean {return !!this.prefabs.handheld;}
  /** Total height (cm): the tripod and camera, or the operator. */
  get totalHeight():number {return this.mountKind==="handheld"?OPERATOR_HEIGHT:rigHeight(this.bodyKind)+this.liftCm;}
  /** On the tripod, or handheld: the tripod, column, head and camera hide and an operator holding the
   * same kind of camera stands in their place (no height or tilt of its own). */
  setMount(kind:MountKind):void {
    if(kind==="handheld"&&!this.prefabs.handheld)kind="tripod";
    this.mountKind=kind;
    const tripod=kind==="tripod";
    for(const so of [this.legs,this.column,this.tilt])if(so&&!isNull(so))so.enabled=tripod;
    if(this.operator&&!isNull(this.operator)){this.operator.destroy();this.operator=null;}
    if(!tripod){
      this.operator=this.prefabs.handheld[this.bodyKind].instantiate(this.parent);
      this.operator.name="Camera operator";
      // The "crew" lettering on the hoodie is a thin decal over the back with its own sharp image: drawn
      // see-through so only the letters show.
      const crew=findChildNamed(this.operator,"Crew");
      const v=crew?crew.getComponent("Component.RenderMeshVisual") as RenderMeshVisual:null;
      if(v&&v.mainMaterial){const m=v.mainMaterial.clone();m.mainPass.blendMode=BlendMode.Normal;m.mainPass.depthWrite=false;v.mainMaterial=m;}
    }
  }
  /** The part that tilts (head + body); the tilt wheel hangs off it. */
  get tilting():SceneObject {return this.tilt;}
  /** Where this body's tilt wheel goes, in the tilting frame. */
  get wheel():{center:vec3;radius:number} {return WHEEL[this.bodyKind];}
  /** Swaps the camera on the head. */
  setBody(kind:BodyKind):void {
    this.bodyKind=kind;
    if(this.bodyObject&&!isNull(this.bodyObject))this.bodyObject.destroy();
    const prefab=this.prefabs.bodies[kind];
    this.bodyObject=prefab?prefab.instantiate(this.tilt):null;
    if(this.bodyObject){
      this.bodyObject.name="Camera body";
      this.bodyObject.getTransform().setLocalPosition(new vec3(0,-TILT_PIVOT,0));
    }
    // A handheld operator holds the matching camera too.
    if(this.built&&this.mountKind==="handheld")this.setMount("handheld");
  }
  /** Raises the centre column by `cm` (clamped to 0..MAX_LIFT); the head and body ride on top. */
  setLift(cm:number):void {
    const before=this.liftCm;
    this.liftCm=Math.max(0,Math.min(MAX_LIFT,cm));
    if(this.built&&!RigSounds.muted&&Math.abs(this.liftCm-before)>0.01)RigSounds.onLift?.(this.liftCm-before);
    const c=this.liftCm;
    if(this.column&&!isNull(this.column)){
      const s=(HEAD_BASE-COLUMN_BOTTOM+c)/(COLUMN_TOP-COLUMN_BOTTOM);
      const t=this.column.getTransform();
      t.setLocalScale(new vec3(1,s,1));
      t.setLocalPosition(new vec3(0,COLUMN_BOTTOM*(1-s),0));
    }
    this.tilt.getTransform().setLocalPosition(new vec3(0,HEAD_BASE+TILT_PIVOT+c,0));
  }
  /** Tilts the camera: positive raises the lens (+X) toward up. */
  setTilt(deg:number):void {
    const before=this.tiltDeg;
    this.tiltDeg=Math.max(-MAX_TILT,Math.min(MAX_TILT,deg));
    if(this.built&&!RigSounds.muted&&Math.abs(this.tiltDeg-before)>0.001)RigSounds.onTilt?.(this.tiltDeg-before);
    this.tilt.getTransform().setLocalRotation(quat.angleAxis(this.tiltDeg*Math.PI/180,vec3.forward()));
  }
}

// Light: the original light model cut into base / stretching pole / upper pole / softbox head
// (Assets/GeneratedMeshes/LightRig), in cm with feet at y=0. The pole runs up behind the softbox to its
// mount at ~137 cm (off the model's origin); only the head tilts, at that joint.
const LIGHT_POLE_BOTTOM=60,LIGHT_POLE_TOP=99;
const LIGHT_PIVOT=new vec3(6.6,137,-8);
/** GLB units -> cm for the original Light.glb (its key-light bulb offset is in GLB units). */
export const LIGHT_MODEL_SCALE=549.8;
// The tilt node is turned so its Z is the head's tilt axis (the model's -X): the softbox shines along +Z,
// and a positive turn about -X raises it, matching the camera's "positive is up".
const LIGHT_TILT_BASE=quat.angleAxis(-Math.PI/2,vec3.up());
// Wheel on the light's left (+X when facing its beam), at the joint, just past the softbox's edge so it
// isn't hidden behind it.
const LIGHT_WHEEL={center:new vec3(0,0,-35),radius:6};

/** A Light prop's rig: base and stretching pole, with the softbox head tilting on top. `frame` is a
 * GLB-unit frame that moves with the head, for the real-time light and its glow. */
export class LightRig implements TiltRig {
  readonly frame:SceneObject;
  readonly wheel=LIGHT_WHEEL;
  private pole:SceneObject;
  private poleTop:SceneObject;
  private tilt:SceneObject;
  private liftCm=0;
  private built=false;
  private tiltDeg=0;
  /** `prefabs` = [base, pole, upper pole, head]. */
  constructor(parent:SceneObject,prefabs:ObjectPrefab[],lift:number,tilt=0){
    // Base first: the marker code measures the prop's feet from the first mesh it finds.
    const [base,pole,poleTop,head]=prefabs.map(p=>p?p.instantiate(parent):null);
    if(base)base.name="Light base";
    this.pole=pole;this.poleTop=poleTop;
    this.tilt=global.scene.createSceneObject("Tilt");this.tilt.setParent(parent);
    // Children of the tilt node sit back where they were: undo its base turn and its pivot offset.
    const undo=LIGHT_TILT_BASE.invert(),offset=undo.multiplyVec3(LIGHT_PIVOT.uniformScale(-1));
    if(head){head.setParent(this.tilt);head.getTransform().setLocalRotation(undo);head.getTransform().setLocalPosition(offset);}
    this.frame=global.scene.createSceneObject("Light frame");this.frame.setParent(this.tilt);
    const ft=this.frame.getTransform();
    ft.setLocalRotation(undo);ft.setLocalPosition(offset);ft.setLocalScale(vec3.one().uniformScale(LIGHT_MODEL_SCALE));
    this.setLift(lift);
    this.setTilt(tilt);
    this.built=true;
  }
  get lift():number {return this.liftCm;}
  get tiltAngle():number {return this.tiltDeg;}
  get tilting():SceneObject {return this.tilt;}
  /** Raises the pole by `cm` (clamped to 0..MAX_LIFT); the head rides on top. */
  setLift(cm:number):void {
    const before=this.liftCm;
    this.liftCm=Math.max(0,Math.min(MAX_LIFT,cm));
    if(this.built&&!RigSounds.muted&&Math.abs(this.liftCm-before)>0.01)RigSounds.onLift?.(this.liftCm-before);
    const c=this.liftCm;
    if(this.pole&&!isNull(this.pole)){
      const s=(LIGHT_POLE_TOP-LIGHT_POLE_BOTTOM+c)/(LIGHT_POLE_TOP-LIGHT_POLE_BOTTOM);
      const t=this.pole.getTransform();
      t.setLocalScale(new vec3(1,s,1));
      t.setLocalPosition(new vec3(0,LIGHT_POLE_BOTTOM*(1-s),0));
    }
    // The upper pole rides up with the stretch; the head (on the tilt node) rides on top of it.
    if(this.poleTop&&!isNull(this.poleTop))this.poleTop.getTransform().setLocalPosition(new vec3(0,c,0));
    this.tilt.getTransform().setLocalPosition(LIGHT_PIVOT.add(new vec3(0,c,0)));
  }
  /** Tilts the softbox: positive aims it up. */
  setTilt(deg:number):void {
    const before=this.tiltDeg;
    this.tiltDeg=Math.max(-MAX_TILT,Math.min(MAX_TILT,deg));
    if(this.built&&!RigSounds.muted&&Math.abs(this.tiltDeg-before)>0.001)RigSounds.onTilt?.(this.tiltDeg-before);
    this.tilt.getTransform().setLocalRotation(LIGHT_TILT_BASE.multiply(quat.angleAxis(this.tiltDeg*Math.PI/180,vec3.forward())));
  }
}

// Pale see-through glass, like the height slider's track (green was distracting).
const RING_GLASS:[number,number,number,number]=[1,1,1,0.35];
const WHEEL_TUBE=1.2,WHEEL_ARCS=12;
// Hover glow: a soft purple ring a little thicker than the glass one; it lingers briefly after the cursor
// leaves so edges don't flicker. Shared with the gizmo's turn ring.
export const RING_GLOW:[number,number,number,number]=[0.66,0.5,1,0.55];
export const RING_GLOW_TUBE=1.9,RING_GLOW_LINGER=0.2;
// Purple hub in the middle of the wheel with the rotate icon, like the height slider's knob. It faces out
// from the prop (the wheel sits on its left, -Z in the tilting frame) and turns the wheel too when dragged.
const HUB_FRACTION=0.8,HUB_ICON=0.62,HUB_HOVER_SCALE=1.2;
// Below this |view . axis| the wheel is seen edge-on, and dragging along the rim stands in for turning it.
const EDGE_ON=0.3;

/** A small glass wheel on the camera's left side, on the tilt axis. Turning it turns the camera with it:
 * spin it forward (top toward the lens) to tilt down, backward to tilt up. ScoutMain shows it only while
 * the camera is in edit mode. */
// How close (cm) a closed hand must be to a tilt wheel to take hold of it.
const HAND_REACH=10;

export class TiltWheel {
  readonly root:SceneObject;
  private drag:{interactor:Interactor;center:vec3;axis:vec3;view:vec3;edge:boolean;direct:boolean;
    previous:vec3;startTilt:number;angle:number}=null;
  constructor(private rig:TiltRig,material:Material,private camera:Camera,private set:(deg:number)=>void,private touched:()=>void){
    this.root=child(rig.tilting,"Tilt wheel",vec3.zero());
    this.rebuild(material);
    this.root.enabled=false;
  }
  get dragging():boolean {return !!this.drag;}
  private hand:{center:vec3;axis:vec3;previous:vec3;startTilt:number;angle:number}=null;
  /** A fist closing on the wheel up close starts turning it with the hand; returns whether it caught. */
  handTurnBegin(point:vec3):boolean {
    if(!this.root.enabled||this.drag)return false;
    const center=this.root.getTransform().getWorldPosition();
    const axis=this.rig.tilting.getTransform().getWorldRotation().multiplyVec3(vec3.forward()).normalize();
    const d=point.sub(center),off=d.dot(axis),inPlane=d.sub(axis.uniformScale(off)).length;
    if(Math.abs(off)>HAND_REACH||inPlane>this.rig.wheel.radius+HAND_REACH)return false;
    this.hand={center,axis,previous:point,startTilt:this.rig.tiltAngle,angle:0};
    this.touched();
    return true;
  }
  handTurnUpdate(point:vec3):void {
    const h=this.hand;
    if(!h)return;
    const a=h.previous.sub(h.center),b=point.sub(h.center);
    const from=a.sub(h.axis.uniformScale(a.dot(h.axis))),to=b.sub(h.axis.uniformScale(b.dot(h.axis)));
    if(from.length>1&&to.length>1)h.angle+=Math.atan2(h.axis.dot(from.cross(to)),from.dot(to));
    h.previous=point;
    this.set(h.startTilt+h.angle*180/Math.PI);this.touched();
  }
  handTurnEnd():void {this.hand=null;this.touched();}
  get handTurning():boolean {return !!this.hand;}
  private side=-1;
  /** Keeps the wheel on the side of the prop the user is looking from, so nobody has to walk round to
   * tilt it. Not while it's being turned. */
  faceViewer(eye:vec3):void {
    if(this.drag||this.hand)return;
    const local=this.rig.tilting.getTransform().getInvertedWorldTransform().multiplyPoint(eye);
    const side=local.z>=0?1:-1;
    if(side===this.side)return;
    this.side=side;
    const c=this.rig.wheel.center;
    const t=this.root.getTransform();
    t.setLocalPosition(new vec3(c.x,c.y,side*Math.abs(c.z)));
    t.setLocalRotation(quat.angleAxis(side>0?Math.PI:0,vec3.up()));
  }
  private glow:SceneObject=null;
  private hoverAt=-1;
  /** Called every frame while the wheel shows: the glow follows hover (with a short grace so it doesn't
   * flicker at the edge) and stays on while the wheel is being turned. */
  updateGlow():void {
    if(!this.glow||isNull(this.glow))return;
    const on=getTime()-this.hoverAt<RING_GLOW_LINGER||!!this.drag||!!this.hand;
    if(this.glow.enabled!==on)this.glow.enabled=on;
  }
  /** Rebuilds the ring for the rig's current body (sizes differ). */
  rebuild(material:Material):void {
    for(let i=this.root.getChildrenCount()-1;i>=0;i--)this.root.getChild(i).destroy();
    const {center,radius}=this.rig.wheel;
    this.root.getTransform().setLocalPosition(center);
    this.root.getTransform().setLocalRotation(quat.quatIdentity());this.side=center.z>=0?1:-1;
    ringMesh(child(this.root,"Ring",vec3.zero()),radius,WHEEL_TUBE,RING_GLASS,material);
    // Soft purple glow around the ring while it's hovered (it's a thin target), off otherwise.
    this.glow=child(this.root,"Ring glow",vec3.zero());
    ringMesh(this.glow,radius,WHEEL_TUBE*RING_GLOW_TUBE,RING_GLOW,material);
    this.glow.enabled=false;this.hoverAt=-1;
    const hubSize=radius*HUB_FRACTION;
    const hub=child(this.root,"Tilt hub",vec3.zero());
    hub.getTransform().setLocalRotation(quat.angleAxis(Math.PI,vec3.up()));
    const face=child(hub,"Face",vec3.zero());
    panel(face,hubSize,hubSize,PURPLE,hubSize/2);
    image(child(face,"Icon",new vec3(0,0,0.3)),TILT_ICON,hubSize*HUB_ICON,hubSize*HUB_ICON,BODY_INK);
    const hubCol=hub.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const hubBox=Shape.createBoxShape();hubBox.size=new vec3(hubSize,hubSize,3);hubCol.shape=hubBox;
    const hubInput=this.bind(hub);
    addHoverFeedback(hubInput,face,undefined,HUB_HOVER_SCALE,true);
    // Arc hit boxes around the ring; the hub covers the middle.
    for(let i=0;i<WHEEL_ARCS;i++){
      const a=i*2*Math.PI/WHEEL_ARCS;
      const hit=child(this.root,"Tilt arc "+i,new vec3(Math.cos(a)*radius,Math.sin(a)*radius,0));
      hit.getTransform().setLocalRotation(quat.angleAxis(a,vec3.forward()));
      const col=hit.createComponent("Physics.ColliderComponent") as ColliderComponent;
      const box=Shape.createBoxShape();box.size=new vec3(4,radius*2*Math.PI/WHEEL_ARCS+1,4);col.shape=box;
      this.bind(hit);
    }
  }
  /** Where the hand is, for turning: the hand itself up close, else the ray on the wheel's plane (or, seen
   * edge-on, on a plane facing the user). */
  private point(interactor:Interactor,d:{center:vec3;axis:vec3;view:vec3;edge:boolean;direct:boolean}):vec3 {
    if(d.direct)return interactor.startPoint;
    return planeHit(interactor,d.center,d.edge?d.view:d.axis);
  }
  private bind(object:SceneObject):Interactable {
    const input=object.createComponent(Interactable.getTypeName()) as Interactable;
    input.targetingMode=3;input.enableInstantDrag=true;
    input.onHoverEnter.add(()=>{this.hoverAt=getTime();});
    input.onHoverUpdate.add(()=>{this.hoverAt=getTime();});
    input.onTriggerStart.add(e=>{
      e.stopPropagation();this.touched();
      if(this.drag)return;
      const t=this.root.getTransform(),center=t.getWorldPosition();
      // The wheel's axis is the tilt axis; a positive turn about it is a positive (upward) tilt. Taken
      // from the rig (not the wheel, which flips to face whoever is looking) so it never reverses.
      const axis=this.rig.tilting.getTransform().getWorldRotation().multiplyVec3(vec3.forward()).normalize();
      const view=this.camera.getTransform().getWorldPosition().sub(center).normalize();
      const direct=e.interactor.activeTargetingMode===TargetingMode.Direct;
      const d={interactor:e.interactor,center,axis,view,edge:!direct&&Math.abs(view.dot(axis))<EDGE_ON,direct,
        previous:null as vec3,startTilt:this.rig.tiltAngle,angle:0};
      d.previous=this.point(e.interactor,d);
      if(!d.previous)return;
      this.drag=d;
    });
    input.onTriggerUpdate.add(e=>{
      const d=this.drag;
      if(!d||d.interactor!==e.interactor)return;
      e.stopPropagation();this.touched();
      const p=this.point(e.interactor,d);
      if(!p)return;
      if(d.edge){
        // Seen edge-on, the user is grabbing the rim nearest them: moving it along the rim turns the wheel.
        d.angle+=p.sub(d.previous).dot(d.axis.cross(d.view))/this.rig.wheel.radius;
      }else{
        const a=d.previous.sub(d.center),b=p.sub(d.center);
        const from=a.sub(d.axis.uniformScale(a.dot(d.axis))),to=b.sub(d.axis.uniformScale(b.dot(d.axis)));
        if(from.length>1&&to.length>1)d.angle+=Math.atan2(d.axis.dot(from.cross(to)),from.dot(to));
      }
      d.previous=p;
      this.set(d.startTilt+d.angle*180/Math.PI);
    });
    const end=()=>{if(this.drag){this.drag=null;this.touched();}};
    input.onTriggerEnd.add(end);input.onTriggerEndOutside.add(end);input.onTriggerCanceled.add(end);
    return input;
  }
}

/** A torus in the XY plane (axis +Z) as a vertex-coloured mesh on `so`. */
function ringMesh(so:SceneObject,radius:number,tube:number,color:[number,number,number,number],material:Material):void {
  const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
  b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;
  const indices:number[]=[];
  for(let j=0;j<=48;j++)for(let k=0;k<=8;k++){
    const a=j*Math.PI/24,t=k*Math.PI/4;
    const radial=new vec3(Math.cos(a),Math.sin(a),0);
    const n=radial.uniformScale(Math.cos(t)).add(vec3.forward().uniformScale(Math.sin(t)));
    const p=radial.uniformScale(radius).add(n.uniformScale(tube));
    b.appendVerticesInterleaved([p.x,p.y,p.z,n.x,n.y,n.z,...color]);
    if(j<48&&k<8){const x=j*9+k;indices.push(x,x+9,x+1,x+1,x+9,x+10);}
  }
  b.appendIndices(indices);
  const visual=so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
  visual.mesh=b.getMesh();visual.mainMaterial=material;b.updateMesh();
}

function planeHit(interactor:Interactor,origin:vec3,normal:vec3):vec3 {
  const start=interactor.startPoint,direction=interactor.direction;
  if(!start||!direction)return null;
  const den=direction.dot(normal);
  if(Math.abs(den)<.015)return null;
  const dist=origin.sub(start).dot(normal)/den;
  if(dist<0||dist>10000)return null;
  return start.add(direction.uniformScale(dist));
}

const TRACK_W=9,TRACK_H=46,KNOB=8.5,KNOB_ICON=6;
const TRAVEL=TRACK_H-KNOB-1;
const GLASS=new vec4(1,1,1,0.16);
const PURPLE=new vec4(0x8a/255,0x6c/255,0xf0/255,1);
const QUIET=new vec4(0x2a/255,0x26/255,0x36/255,1);
const KNOB_HOVER_SCALE=1.3;
// Body picker: round icon buttons stacked beside the track (local +X is away from the prop); a purple
// ring sits behind the chosen one.
const PICK=10,PICK_ICON=6.5,PICK_RING=1.4,PICK_X=TRACK_W/2+PICK/2+3,PICK_GAP=3;
// Worded buttons (the mount pair): pill width and text size. Each pair sits on its own glass pill.
const PICK_TEXT_W=26,PICK_TEXT=115,PICK_GROUP_PAD=2.2;

/** Pill-shaped glass slider with a purple knob: dragging the knob up and down sets the rig's lift.
 * Above it, a Cinema / Photo picker swaps the camera body. Lives beside the prop and is only shown while
 * the prop is in edit mode, so moving the prop never changes it by accident. */
export class HeightSlider {
  readonly root:SceneObject;
  private knob:SceneObject;
  private drag:{interactor:Interactor;startY:number;startLift:number;normal:vec3;origin:vec3;direct:boolean}=null;
  private track:SceneObject;
  constructor(parent:SceneObject,pos:vec3,private camera:Camera,private get:()=>number,private set:(cm:number)=>void,
    private touched:()=>void,body?:BodyKind,pickBody?:(kind:BodyKind)=>void,mount?:MountKind,pickMount?:(kind:MountKind)=>void,mountX=0){
    this.root=child(parent,"Height slider",pos);
    const track=child(this.root,"Track",vec3.zero());
    this.track=track;
    panel(track,TRACK_W,TRACK_H,GLASS,TRACK_W/2);
    this.knob=child(this.root,"Knob",new vec3(0,0,0.6));
    const face=child(this.knob,"Face",vec3.zero());
    panel(face,KNOB,KNOB,PURPLE,KNOB/2);
    // The height icon sits in the knob, so it reads as the thing to drag.
    const glyph=child(face,"Height icon",new vec3(0,0,0.4));
    image(glyph,HEIGHT_ICON,KNOB_ICON,KNOB_ICON,BODY_INK);
    const col=this.knob.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const shape=Shape.createBoxShape();shape.size=new vec3(KNOB+3,KNOB+3,4);col.shape=shape;
    const input=this.knob.createComponent(Interactable.getTypeName()) as Interactable;
    input.targetingMode=3;input.enableInstantDrag=true;
    addHoverFeedback(input,face,undefined,KNOB_HOVER_SCALE,true);
    input.onTriggerStart.add(e=>{
      // Keep the prop's own manipulation from treating this as a move.
      e.stopPropagation();this.touched();
      const origin=this.knob.getTransform().getWorldPosition();
      const toCam=this.camera.getTransform().getWorldPosition().sub(origin);
      const normal=new vec3(toCam.x,0,toCam.z).length>1e-3?new vec3(toCam.x,0,toCam.z).normalize():vec3.forward();
      const direct=e.interactor.activeTargetingMode===TargetingMode.Direct;
      const point=direct?e.interactor.startPoint:this.intersection(e.interactor,origin,normal);
      if(!point)return;
      this.drag={interactor:e.interactor,startY:point.y,startLift:this.get(),normal,origin,direct};
    });
    input.onTriggerUpdate.add(e=>{
      const d=this.drag;
      if(!d||d.interactor!==e.interactor)return;
      e.stopPropagation();this.touched();
      const point=d.direct?e.interactor.startPoint:this.intersection(e.interactor,d.origin,d.normal);
      if(!point)return;
      // The knob travels TRAVEL cm for the full MAX_LIFT range.
      this.set(d.startLift+(point.y-d.startY)*MAX_LIFT/TRAVEL);
      this.refresh();
    });
    const end=()=>{if(this.drag){this.drag=null;this.touched();}};
    input.onTriggerEnd.add(end);input.onTriggerEndOutside.add(end);input.onTriggerCanceled.add(end);
    // Only cameras have more than one body to pick from.
    if(body&&pickBody)this.buildPicker("Body picker",PICK_X,BODY_KINDS,body,pickBody,{icons:BODY_ICONS});
    // ...and a mount: tripod or handheld, at `mountX` (the caller puts it on the prop's other side).
    if(mount&&pickMount)this.buildPicker("Mount picker",mountX,MOUNT_KINDS,mount,
      k=>{this.setHandheld(k==="handheld");pickMount(k);},{labels:MOUNT_LABELS});
    if(mount)this.setHandheld(mount==="handheld");
    this.refresh();
    this.root.enabled=false;
  }
  /** Handheld has no column to raise: the track and knob hide, the pickers stay. */
  setHandheld(on:boolean):void {
    this.track.enabled=!on;this.knob.enabled=!on;
  }
  get dragging():boolean {return !!this.drag;}
  /** Moves the knob to match the current lift. */
  refresh():void {
    const k=this.get()/MAX_LIFT;
    this.knob.getTransform().setLocalPosition(new vec3(0,-TRAVEL/2+k*TRAVEL,0.6));
  }
  /** A column of round icon buttons (or worded pills) on a glass pill of its own, with a purple ring on
   * the chosen one. */
  private buildPicker<K extends string>(name:string,x:number,kinds:K[],current:K,pick:(kind:K)=>void,
    face:{icons?:{[k in K]:Texture};labels?:{[k in K]:string}}):void {
    const column=child(this.root,name,new vec3(x,0,0));
    const w=face.labels?PICK_TEXT_W:PICK;
    const yOf=(i:number)=>((kinds.length-1)/2-i)*(PICK+PICK_GAP);
    // The pair's own pill, so two pairs read as two separate choices.
    const group=child(column,"Group",new vec3(0,0,-0.4));
    const gh=kinds.length*PICK+(kinds.length-1)*PICK_GAP+2*PICK_GROUP_PAD;
    panel(group,w+2*PICK_GROUP_PAD,gh,GLASS,(PICK+2*PICK_GROUP_PAD)/2);
    const ring=child(column,"Chosen",new vec3(0,yOf(kinds.indexOf(current)),-0.2));
    panel(ring,w+2*PICK_RING,PICK+2*PICK_RING,PURPLE,PICK/2+PICK_RING);
    kinds.forEach((kind,i)=>{
      const so=child(column,"Button",new vec3(0,yOf(i),0.2));
      const back=so.createComponent(BackPlate.getTypeName()) as BackPlate;
      back.style="simple";back.size=new vec2(w,PICK);
      back.onInitialized.add(()=>{
        styleBack(back,QUIET,PICK/2);
        back.interactionPlane.enabled=false;
        back.interactable.onTriggerEnd.add(()=>{
          this.touched();
          ring.getTransform().setLocalPosition(new vec3(0,yOf(i),-0.2));
          pick(kind);
        });
        addBackPlateHover(back,so,QUIET);
      });
      if(face.labels)text(so,face.labels[kind],new vec3(0,0,0.4),w-2,PICK-1,PICK_TEXT,BODY_INK);
      else{const glyph=child(so,"Icon",new vec3(0,0,0.4));image(glyph,face.icons[kind],PICK_ICON,PICK_ICON,BODY_INK);}
    });
  }
  private intersection(interactor:Interactor,origin:vec3,normal:vec3):vec3 {
    const start=interactor.startPoint,direction=interactor.direction;
    if(!start||!direction)return null;
    const den=direction.dot(normal);
    if(Math.abs(den)<.015)return null;
    const dist=origin.sub(start).dot(normal)/den;
    if(dist<0||dist>10000)return null;
    return start.add(direction.uniformScale(dist));
  }
}

/** The first object under `root` whose name contains `name` (imported names may carry a suffix). */
function findChildNamed(root:SceneObject,name:string):SceneObject|null {
  for(let i=0;i<root.getChildrenCount();i++){
    const c=root.getChild(i);
    if(c.name.indexOf(name)>=0)return c;
    const deeper=findChildNamed(c,name);
    if(deeper)return deeper;
  }
  return null;
}
