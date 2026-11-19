import {Interactable,TargetingPriority} from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import {Interactor,TargetingMode} from "InteractionKit.lspkg/Core/Interactor/Interactor";
import {buildLathe} from "./ScoutMarkerMesh";
import {RING_GLOW,RING_GLOW_TUBE,RING_GLOW_LINGER} from "./ScoutCameraRig";

const AXES=[vec3.right(),vec3.up(),vec3.forward()];
const COLORS:[number,number,number,number][]=[[1,.15,.15,1],[.15,1,.3,1],[.2,.5,1,1]];
// The turn ring is pale see-through glass (like the height slider and tilt wheel) rather than bright green.
const RING_GLASS:[number,number,number,number]=[1,1,1,0.35];
const RING_TUBE=1.2;
// How close (cm) a closed hand must be to the ring to take hold of it.
const HAND_REACH=12;
const RADIUS=46; // the rotate wheel (cm); smaller keeps it inside the glasses' view
/** One world-axis gizmo shared by all placements. SIK supplies mouse and hand input. */
export class ScoutTransformGizmo {
  private root:SceneObject;
  private move:SceneObject;
  private moveVertical:SceneObject;
  private rotate:SceneObject;
  private target:SceneObject=null;
  private mode="Show handles";
  private allowVertical=false;
  private ringGlow:SceneObject=null;
  /** Called after a sideways move with the move arrows ends. */
  onMoved:(target:SceneObject)=>void=null;
  private ringHoverAt=-1;
  private floorY=-Infinity;
  private drag:{interactor:Interactor;axis:vec3;normal:vec3;origin:vec3;position:vec3;rotation:quat;previous:vec3;angle:number;direct:boolean;rotate:boolean;edge:boolean;tangent:vec3}=null;
  constructor(private material:Material,private camera:Camera,private touched:()=>void){
    this.material=material.clone();
    this.material.mainPass.depthTest=false;
    this.material.mainPass.depthWrite=false;
    // Blended, so the glass ring is see-through; the arrows are fully opaque and look the same.
    this.material.mainPass.blendMode=BlendMode.Normal;
    this.root=this.object("Transform handles");
    this.move=this.object("Move handles",this.root);
    this.moveVertical=this.object("Move vertical handle",this.root);
    this.rotate=this.object("Rotate handles",this.root);
    AXES.forEach((axis,i)=>{
      {
        const arrow=this.object("Move "+"XYZ"[i],i===1?this.moveVertical:this.move);
        arrow.getTransform().setLocalRotation(quat.rotationFromTo(vec3.up(),axis));
        this.mesh(arrow,b=>buildLathe(b,[[0,-14],[.9,-14],[.9,6],[3.5,6],[0,14]],16,COLORS[i]));
        const collider=arrow.createComponent("Physics.ColliderComponent") as ColliderComponent;
        const box=Shape.createBoxShape();box.size=new vec3(9,30,9);collider.shape=box;
        // Keep the collider centered on the shaft without offsetting the axis origin.
        arrow.getTransform().setLocalPosition(axis.uniformScale(77));
        this.bind(arrow,axis,false);
      }
      // Facing direction uses world up; translation handles stay in the horizontal plane.
      if(i!==1)return;
      const ring=this.object("Rotate "+"XYZ"[i],this.rotate);
      const u=AXES[(i+1)%3],v=axis.cross(u);
      this.mesh(ring,b=>this.torus(b,u,v,RING_GLASS,RING_TUBE));
      // Soft purple glow while the ring is hovered (it's a thin target).
      this.ringGlow=this.object("Rotate glow",ring);
      this.mesh(this.ringGlow,b=>this.torus(b,u,v,RING_GLOW,RING_TUBE*RING_GLOW_TUBE));
      this.ringGlow.enabled=false;
      // Separate arc hit boxes leave the center empty, so equipment remains selectable.
      for(let j=0;j<24;j++){
        const angle=j*Math.PI/12;
        const radial=u.uniformScale(Math.cos(angle)).add(v.uniformScale(Math.sin(angle)));
        const hit=this.object("Rotate "+"XYZ"[i]+" arc "+j,ring);
        hit.getTransform().setLocalPosition(radial.uniformScale(RADIUS));
        hit.getTransform().setLocalRotation(quat.rotationFromTo(vec3.up(),axis.cross(radial)));
        const col=hit.createComponent("Physics.ColliderComponent") as ColliderComponent;
        const shape=Shape.createBoxShape();shape.size=new vec3(7,15,7);col.shape=shape;
        this.bind(hit,axis,true);
      }
    });
    this.update();
  }
  select(target:SceneObject,allowVertical=false,floorY=-Infinity):void {
    if(target!==this.target)this.drag=null;
    this.target=target;this.allowVertical=allowVertical;this.floorY=floorY;this.update();
  }
  setMode(mode:string):void {this.drag=null;this.mode=mode;this.update();}
  /** Whether the handles are currently visible for this exact target — used to toggle off on a repeat edit tap. */
  isEditing(target:SceneObject):boolean {return this.target===target&&this.mode!=="Hide handles";}
  update():void {
    const valid=this.target&&!isNull(this.target);
    this.root.enabled=!!valid&&this.mode!=="Hide handles";
    this.move.enabled=true;this.rotate.enabled=true;this.moveVertical.enabled=this.allowVertical;
    if(valid)this.root.getTransform().setWorldPosition(this.target.getTransform().getWorldPosition());
    if(this.ringGlow){
      const on=getTime()-this.ringHoverAt<RING_GLOW_LINGER||!!this.drag?.rotate;
      if(this.ringGlow.enabled!==on)this.ringGlow.enabled=on;
    }
  }
  private hand:{origin:vec3;rotation:quat;previous:vec3;angle:number}=null;
  /** A fist closing on the turn ring up close (`point` within reach of it) starts turning the target
   * with the hand. Returns whether it caught the ring. */
  handTurnBegin(point:vec3):boolean {
    if(!this.root.enabled||!this.target||isNull(this.target)||this.drag)return false;
    const t=this.target.getTransform(),origin=t.getWorldPosition(),d=point.sub(origin);
    if(Math.abs(Math.hypot(d.x,d.z)-RADIUS)>HAND_REACH||Math.abs(d.y)>HAND_REACH)return false;
    this.hand={origin,rotation:t.getWorldRotation(),previous:point,angle:0};
    this.touched();
    return true;
  }
  handTurnUpdate(point:vec3):void {
    const h=this.hand;
    if(!h||!this.target||isNull(this.target))return;
    const a=h.previous.sub(h.origin),b=point.sub(h.origin);
    const from=new vec3(a.x,0,a.z),to=new vec3(b.x,0,b.z);
    if(from.length>1&&to.length>1){
      h.angle+=Math.atan2(vec3.up().dot(from.cross(to)),from.dot(to));
      this.target.getTransform().setWorldRotation(quat.angleAxis(h.angle,vec3.up()).multiply(h.rotation));
    }
    h.previous=point;this.touched();this.update();
  }
  handTurnEnd():void {this.hand=null;this.touched();}
  private bind(object:SceneObject,axis:vec3,rotate:boolean):void {
    const input=object.createComponent(Interactable.getTypeName()) as Interactable;
    input.targetingMode=3;input.enableInstantDrag=true;
    // Drawn on top of everything, so they win the pinch too — not the posable limb behind an arrow.
    input.targetingPriority=TargetingPriority.High;
    if(rotate){
      input.onHoverEnter.add(()=>{this.ringHoverAt=getTime();});
      input.onHoverUpdate.add(()=>{this.ringHoverAt=getTime();});
    }
    input.onTriggerStart.add(e=>{
      e.stopPropagation();this.touched();
      if(!this.target||isNull(this.target)||this.drag)return;
      const t=this.target.getTransform(),origin=t.getWorldPosition();
      const view=this.camera.getTransform().getWorldPosition().sub(origin).normalize();
      const direct=e.interactor.activeTargetingMode===TargetingMode.Direct;
      const edge=rotate&&!direct&&Math.abs(view.dot(axis))<.15;
      let normal=rotate?(edge?view:axis):view.sub(axis.uniformScale(view.dot(axis)));
      if(normal.length<.05)normal=this.camera.getTransform().up;
      normal=normal.normalize();
      const point=direct?e.interactor.startPoint:this.intersection(e.interactor,origin,normal);
      if(!point)return;
      this.drag={interactor:e.interactor,axis,normal,origin,position:origin,rotation:t.getWorldRotation(),previous:point,angle:0,direct,rotate,edge,tangent:edge?view.cross(axis).normalize():vec3.zero()};
      console.log("Scout handle: "+object.name+" on "+this.target.name);
    });
    input.onTriggerUpdate.add(e=>{
      if(!this.drag||this.drag.interactor!==e.interactor)return;
      e.stopPropagation();this.touched();
      const d=this.drag,t=this.target.getTransform();
      const point=d.direct?e.interactor.startPoint:this.intersection(e.interactor,d.origin,d.normal);
      if(!point)return;
      if(d.rotate){
        const a=d.previous.sub(d.origin),b=point.sub(d.origin);
        const from=a.sub(d.axis.uniformScale(a.dot(d.axis))),to=b.sub(d.axis.uniformScale(b.dot(d.axis)));
        if(d.edge||(from.length>1&&to.length>1)){
          d.angle+=d.edge?point.sub(d.previous).dot(d.tangent)/RADIUS:Math.atan2(d.axis.dot(from.cross(to)),from.dot(to));
          t.setWorldRotation(quat.angleAxis(d.angle,d.axis).multiply(d.rotation));
        }
      }else{
        d.position=d.position.add(d.axis.uniformScale(point.sub(d.previous).dot(d.axis)));
        // Vertical handle only: keep the object from being dragged down into the floor.
        if(Math.abs(d.axis.y)>0.9)d.position=new vec3(d.position.x,Math.max(d.position.y,this.floorY),d.position.z);
        t.setWorldPosition(d.position);
      }
      d.previous=point;this.update();
    });
    const end=()=>{
      const d=this.drag;
      this.drag=null;this.touched();
      // A sideways move ends with the asset dropped onto whatever surface is now under it (ScoutMain).
      if(d&&!d.rotate&&Math.abs(d.axis.y)<0.9&&this.target&&!isNull(this.target)&&this.onMoved)this.onMoved(this.target);
    };
    input.onTriggerEnd.add(end);input.onTriggerEndOutside.add(end);input.onTriggerCanceled.add(end);
  }
  private intersection(interactor:Interactor,origin:vec3,normal:vec3):vec3 {
    const start=interactor.startPoint,direction=interactor.direction;
    if(!start||!direction)return null;
    const denominator=direction.dot(normal);
    if(Math.abs(denominator)<.015)return null;
    const distance=origin.sub(start).dot(normal)/denominator;
    if(distance<0||distance>10000)return null;
    return start.add(direction.uniformScale(distance));
  }
  private object(name:string,parent?:SceneObject):SceneObject {
    const so=global.scene.createSceneObject(name);if(parent)so.setParent(parent);return so;
  }
  private mesh(object:SceneObject,build:(b:MeshBuilder)=>void):void {
    const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
    b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;build(b);
    const visual=object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh=b.getMesh();visual.mainMaterial=this.material;visual.setRenderOrder(100);b.updateMesh();
  }
  private torus(b:MeshBuilder,u:vec3,v:vec3,color:number[],tube:number):void {
    const axis=u.cross(v),indices:number[]=[];
    for(let j=0;j<=64;j++)for(let k=0;k<=8;k++){
      const a=j*Math.PI/32,t=k*Math.PI/4;
      const radial=u.uniformScale(Math.cos(a)).add(v.uniformScale(Math.sin(a)));
      const n=radial.uniformScale(Math.cos(t)).add(axis.uniformScale(Math.sin(t)));
      const p=radial.uniformScale(RADIUS).add(n.uniformScale(tube));
      b.appendVerticesInterleaved([p.x,p.y,p.z,n.x,n.y,n.z,...color]);
      if(j<64&&k<8){const x=j*9+k;indices.push(x,x+9,x+1,x+1,x+9,x+10);}
    }
    b.appendIndices(indices);
  }
}

  