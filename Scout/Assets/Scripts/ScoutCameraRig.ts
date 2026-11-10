import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate";
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import {Interactor,TargetingMode} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import {addBackPlateHover,addHoverFeedback} from "./ScoutHover";
import {BODY_INK,child,image,panel,styleBack} from "./ScoutOnboarding";

/** Which camera sits on the tripod: the cinema camera (video) or the vintage stills camera (photo). */
export type BodyKind="cinema"|"photo";
export const BODY_KINDS:BodyKind[]=["cinema","photo"];
const BODY_ICONS:{[k in BodyKind]:Texture}={
  cinema:requireAsset("../Icons/videocam.png") as Texture,
  photo:requireAsset("../Icons/photo_camera.png") as Texture,
};
const HEIGHT_ICON=requireAsset("../Icons/height.png") as Texture;

/** The tripod is the original ShotScout camera's, cut into legs / centre column / pan head
 * (Assets/GeneratedMeshes/CameraRig); either body sits on the head. All in cm, column axis at the
 * origin, feet at y=0, lens along +X. */
export type RigPrefabs={tripod:ObjectPrefab[];bodies:{[k in BodyKind]:ObjectPrefab}};

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
export class CameraRig {
  private column:SceneObject;
  private tilt:SceneObject;
  private bodyObject:SceneObject=null;
  private liftCm=0;
  private tiltDeg=0;
  private bodyKind:BodyKind;
  constructor(parent:SceneObject,private prefabs:RigPrefabs,body:BodyKind,lift:number,tilt=0){
    // Legs first: the marker code measures the prop's feet from the first mesh it finds.
    const [legs,column,head]=prefabs.tripod.map(p=>p?p.instantiate(parent):null);
    if(legs)legs.name="Tripod legs";
    this.column=column;
    this.tilt=global.scene.createSceneObject("Tilt");this.tilt.setParent(parent);
    if(head){head.setParent(this.tilt);head.getTransform().setLocalPosition(new vec3(0,-TILT_PIVOT,0));}
    this.setBody(body);
    this.setLift(lift);
    this.setTilt(tilt);
  }
  get lift():number {return this.liftCm;}
  get tiltAngle():number {return this.tiltDeg;}
  get body():BodyKind {return this.bodyKind;}
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
  }
  /** Raises the centre column by `cm` (clamped to 0..MAX_LIFT); the head and body ride on top. */
  setLift(cm:number):void {
    this.liftCm=Math.max(0,Math.min(MAX_LIFT,cm));
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
    this.tiltDeg=Math.max(-MAX_TILT,Math.min(MAX_TILT,deg));
    this.tilt.getTransform().setLocalRotation(quat.angleAxis(this.tiltDeg*Math.PI/180,vec3.forward()));
  }
}

const GREEN:[number,number,number,number]=[.15,1,.3,1];
const WHEEL_TUBE=0.9,WHEEL_ARCS=12;
// Below this |view . axis| the wheel is seen edge-on, and dragging along the rim stands in for turning it.
const EDGE_ON=0.3;

/** A small green wheel on the camera's left side, on the tilt axis. Turning it turns the camera with it:
 * spin it forward (top toward the lens) to tilt down, backward to tilt up. ScoutMain shows it only while
 * the camera is in edit mode. */
export class TiltWheel {
  readonly root:SceneObject;
  private drag:{interactor:Interactor;center:vec3;axis:vec3;view:vec3;edge:boolean;direct:boolean;
    previous:vec3;startTilt:number;angle:number}=null;
  constructor(private rig:CameraRig,material:Material,private camera:Camera,private set:(deg:number)=>void,private touched:()=>void){
    this.root=child(rig.tilting,"Tilt wheel",vec3.zero());
    this.rebuild(material);
    this.root.enabled=false;
  }
  get dragging():boolean {return !!this.drag;}
  /** Rebuilds the ring for the rig's current body (sizes differ). */
  rebuild(material:Material):void {
    for(let i=this.root.getChildrenCount()-1;i>=0;i--)this.root.getChild(i).destroy();
    const {center,radius}=this.rig.wheel;
    this.root.getTransform().setLocalPosition(center);
    const ring=child(this.root,"Ring",vec3.zero());
    const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
    b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;
    const indices:number[]=[];
    for(let j=0;j<=48;j++)for(let k=0;k<=8;k++){
      const a=j*Math.PI/24,t=k*Math.PI/4;
      const radial=new vec3(Math.cos(a),Math.sin(a),0);
      const n=radial.uniformScale(Math.cos(t)).add(vec3.forward().uniformScale(Math.sin(t)));
      const p=radial.uniformScale(radius).add(n.uniformScale(WHEEL_TUBE));
      b.appendVerticesInterleaved([p.x,p.y,p.z,n.x,n.y,n.z,...GREEN]);
      if(j<48&&k<8){const x=j*9+k;indices.push(x,x+9,x+1,x+1,x+9,x+10);}
    }
    b.appendIndices(indices);
    const visual=ring.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh=b.getMesh();visual.mainMaterial=material;b.updateMesh();
    // Arc hit boxes leave the middle empty, so the camera behind stays grabbable.
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
  private bind(object:SceneObject):void {
    const input=object.createComponent(Interactable.getTypeName()) as Interactable;
    input.targetingMode=3;input.enableInstantDrag=true;
    input.onTriggerStart.add(e=>{
      e.stopPropagation();this.touched();
      if(this.drag)return;
      const t=this.root.getTransform(),center=t.getWorldPosition();
      // The wheel's axis is the tilt axis; a positive turn about it is a positive (upward) tilt.
      const axis=t.getWorldRotation().multiplyVec3(vec3.forward()).normalize();
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
  }
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

/** Pill-shaped glass slider with a purple knob: dragging the knob up and down sets the rig's lift.
 * Above it, a Cinema / Photo picker swaps the camera body. Lives beside the prop and is only shown while
 * the prop is in edit mode, so moving the prop never changes it by accident. */
export class HeightSlider {
  readonly root:SceneObject;
  private knob:SceneObject;
  private drag:{interactor:Interactor;startY:number;startLift:number;normal:vec3;origin:vec3;direct:boolean}=null;
  constructor(parent:SceneObject,pos:vec3,private camera:Camera,private get:()=>number,private set:(cm:number)=>void,
    private touched:()=>void,body:BodyKind,pickBody:(kind:BodyKind)=>void){
    this.root=child(parent,"Height slider",pos);
    const track=child(this.root,"Track",vec3.zero());
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
    this.buildPicker(body,pickBody);
    this.refresh();
    this.root.enabled=false;
  }
  get dragging():boolean {return !!this.drag;}
  /** Moves the knob to match the current lift. */
  refresh():void {
    const k=this.get()/MAX_LIFT;
    this.knob.getTransform().setLocalPosition(new vec3(0,-TRAVEL/2+k*TRAVEL,0.6));
  }
  private buildPicker(current:BodyKind,pick:(kind:BodyKind)=>void):void {
    const column=child(this.root,"Body picker",new vec3(PICK_X,0,0));
    const yOf=(i:number)=>((BODY_KINDS.length-1)/2-i)*(PICK+PICK_GAP);
    const ring=child(column,"Chosen",new vec3(0,yOf(BODY_KINDS.indexOf(current)),-0.2));
    panel(ring,PICK+2*PICK_RING,PICK+2*PICK_RING,PURPLE,PICK/2+PICK_RING);
    BODY_KINDS.forEach((kind,i)=>{
      const so=child(column,"Button",new vec3(0,yOf(i),0.2));
      const back=so.createComponent(BackPlate.getTypeName()) as BackPlate;
      back.style="simple";back.size=new vec2(PICK,PICK);
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
      const glyph=child(so,"Icon",new vec3(0,0,0.4));
      image(glyph,BODY_ICONS[kind],PICK_ICON,PICK_ICON,BODY_INK);
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
