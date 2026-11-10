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

/** A Camera prop's rig: builds the parts under `parent` (feet at its origin) and raises the column. */
export class CameraRig {
  private column:SceneObject;
  private head:SceneObject;
  private bodyObject:SceneObject=null;
  private liftCm=0;
  private bodyKind:BodyKind;
  constructor(private parent:SceneObject,private prefabs:RigPrefabs,body:BodyKind,lift:number){
    // Legs first: the marker code measures the prop's feet from the first mesh it finds.
    const [legs,column,head]=prefabs.tripod.map(p=>p?p.instantiate(parent):null);
    if(legs)legs.name="Tripod legs";
    this.column=column;this.head=head;
    this.setBody(body);
    this.setLift(lift);
  }
  get lift():number {return this.liftCm;}
  get body():BodyKind {return this.bodyKind;}
  /** Swaps the camera on the head. */
  setBody(kind:BodyKind):void {
    this.bodyKind=kind;
    if(this.bodyObject&&!isNull(this.bodyObject))this.bodyObject.destroy();
    const prefab=this.prefabs.bodies[kind];
    this.bodyObject=prefab?prefab.instantiate(this.parent):null;
    if(this.bodyObject)this.bodyObject.name="Camera body";
    this.place();
  }
  /** Raises the centre column by `cm` (clamped to 0..MAX_LIFT); the head and body ride on top. */
  setLift(cm:number):void {
    this.liftCm=Math.max(0,Math.min(MAX_LIFT,cm));
    this.place();
  }
  private place():void {
    const c=this.liftCm;
    if(this.column&&!isNull(this.column)){
      const s=(HEAD_BASE-COLUMN_BOTTOM+c)/(COLUMN_TOP-COLUMN_BOTTOM);
      const t=this.column.getTransform();
      t.setLocalScale(new vec3(1,s,1));
      t.setLocalPosition(new vec3(0,COLUMN_BOTTOM*(1-s),0));
    }
    [this.head,this.bodyObject].forEach(so=>{
      if(so&&!isNull(so))so.getTransform().setLocalPosition(new vec3(0,HEAD_BASE+c,0));
    });
  }
}

const TRACK_W=7,TRACK_H=44,KNOB=6.5;
const TRAVEL=TRACK_H-KNOB-1;
const GLASS=new vec4(1,1,1,0.16);
const PURPLE=new vec4(0x8a/255,0x6c/255,0xf0/255,1);
const QUIET=new vec4(0x2a/255,0x26/255,0x36/255,1);
const KNOB_HOVER_SCALE=1.3;
// Height icon above the track.
const HEIGHT_ICON_SIZE=8,HEIGHT_ICON_Y=TRACK_H/2+HEIGHT_ICON_SIZE/2+3;
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
    const icon=child(this.root,"Height icon",new vec3(0,HEIGHT_ICON_Y,0.2));
    image(icon,HEIGHT_ICON,HEIGHT_ICON_SIZE,HEIGHT_ICON_SIZE,BODY_INK);
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
