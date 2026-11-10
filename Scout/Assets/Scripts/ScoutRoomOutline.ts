import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import {Interactor} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import {addHoverFeedback} from "./ScoutHover";
import {buildLathe} from "./ScoutMarkerMesh";
import {placeInView,followView,child,panel,text,image,sweepColliders,pillButton,TITLE_INK,BODY_INK,PANEL_TINT} from "./ScoutOnboarding";

/** The outline's frame on the floor: its origin, and yaw about +Y — the same convention as ScoutMain's
 * user frame, so layouts can be stored relative to either. */
export type OutlineFrame={origin:vec3;yaw:number};

// New outlines start as a square this size (cm) centred on the user, squared to where they face.
const DEFAULT_HALF=150;
const LINE_WIDTH=3,LIFT=0.8;
const CORNER_RADIUS=7,PLUS_RADIUS=5,PUCK_RADIUS=9,HIT_SIZE=22;
// The turn puck sits this far beyond the outline's farthest corner from its centre.
const TURN_OFFSET=40;
const RAY_REACH=900;
const LINE_COLOR:[number,number,number,number]=[0.76,0.68,1,1];
const CORNER_COLOR:[number,number,number,number]=[0.76,0.68,1,1];
const PLUS_COLOR:[number,number,number,number]=[0.93,0.88,0.78,1];
const PUCK_COLOR:[number,number,number,number]=[1,0.66,0.25,1];
const MOVE_ICON=requireAsset("../Icons/pan_tool.png") as Texture;
const TURN_ICON=requireAsset("../Icons/rotate_right.png") as Texture;
const FONT=requireAsset("../Fonts/Inter.ttf") as Font;
// Instruction panel, like the tips: out in front, a little below eye line, readable at that distance.
const PANEL_DISTANCE=120,PANEL_DROP=34,PANEL_SCALE=1.2,PANEL_W=70,PANEL_H=30;
const TITLE_SIZE=150,BODY_SIZE=110,BUTTON_SIZE=110;

type Drag={interactor:Interactor;kind:"corner"|"move"|"turn";index:number;
  grab?:vec3;origin0?:vec3;yaw0?:number;center?:vec3;angle0?:number};

/** The room's floor outline, used to put a saved layout back exactly where it was.
 *  - define: a square on the floor; drag its corners to the walls, tap a "+" on an edge to add a corner
 *    for alcoves or odd angles, then save.
 *  - align: a saved outline appears as a ghost with its shape locked; move it with the centre puck and
 *    turn it with the ring puck until it sits on the real walls.
 * Plain class driven by ScoutMain each frame. */
export class ScoutRoomOutline {
  private root:SceneObject=null;
  private pts:vec2[]=[];
  private mode:"define"|"align"=null;
  private lines:RenderMeshVisual;
  private linesBuilder:MeshBuilder;
  private handles:SceneObject=null;
  private ui:SceneObject=null;
  private drag:Drag=null;
  private done:(ok:boolean)=>void=null;
  private lineMaterial:Material;

  constructor(private material:Material,private camera:Camera,private floorY:()=>number,
    private schedule:(seconds:number,fn:()=>void)=>void,private onChange:()=>void=()=>{}){
    this.lineMaterial=material.clone();
    // Drawn over the real floor's depth so the line never disappears into it.
    this.lineMaterial.mainPass.depthTest=false;this.lineMaterial.mainPass.depthWrite=false;
  }

  /** Editing or aligning right now (placement pinches should be ignored meanwhile). */
  get active():boolean {return this.mode!==null;}
  /** An outline exists this session (drawn, or aligned from a loaded layout). */
  get hasShape():boolean {return this.pts.length>=3;}
  get frame():OutlineFrame {
    const t=this.root.getTransform(),f=t.getWorldRotation().multiplyVec3(vec3.forward());
    return {origin:t.getWorldPosition(),yaw:Math.atan2(f.x,f.z)};
  }
  /** Corners in the outline's own frame (x/z, cm). */
  get points():vec2[] {return this.pts.map(p=>new vec2(p.x,p.y));}

  /** Draw (or redraw) the room outline. A first outline is a square around the user. */
  define(onDone:(ok:boolean)=>void):void {
    if(!this.hasShape){
      const cam=this.camera.getTransform(),p=cam.getWorldPosition(),f=cam.forward;
      this.ensureRoot();
      this.root.getTransform().setWorldPosition(new vec3(p.x,this.floorY(),p.z));
      this.root.getTransform().setWorldRotation(quat.angleAxis(Math.atan2(f.x,f.z),vec3.up()));
      const h=DEFAULT_HALF;
      this.pts=[new vec2(-h,-h),new vec2(h,-h),new vec2(h,h),new vec2(-h,h)];
    }
    this.start("define",onDone);
  }
  /** Show a saved outline at `frame` for the user to line up with the real room. */
  align(points:vec2[],frame:OutlineFrame,onDone:(ok:boolean)=>void):void {
    this.ensureRoot();
    this.pts=points.map(p=>new vec2(p.x,p.y));
    const t=this.root.getTransform();
    t.setWorldPosition(new vec3(frame.origin.x,this.floorY(),frame.origin.z));
    t.setWorldRotation(quat.angleAxis(frame.yaw,vec3.up()));
    this.start("align",onDone);
  }

  update():void {
    if(!this.mode)return;
    if(this.ui&&!isNull(this.ui))followView(this.ui,this.camera,PANEL_DISTANCE,PANEL_DROP,3);
    const d=this.drag;
    if(!d)return;
    if(!d.interactor.isTriggering){this.drag=null;return;}
    const hit=this.floorHit(d.interactor);
    if(!hit)return;
    const t=this.root.getTransform();
    if(d.kind==="corner"){
      const local=t.getInvertedWorldTransform().multiplyPoint(hit);
      this.pts[d.index]=new vec2(local.x,local.z);
      this.redraw(false);
    }else if(d.kind==="move"){
      const o=hit.add(d.grab);
      t.setWorldPosition(new vec3(o.x,this.floorY(),o.z));
      this.onChange();
    }else{
      // Turn about the outline's centre: the angle swept by the hand, measured like yaw (atan2(x,z)).
      const a=Math.atan2(hit.x-d.center.x,hit.z-d.center.z),delta=a-d.angle0;
      const off=d.origin0.sub(d.center),c=Math.cos(delta),s=Math.sin(delta);
      t.setWorldPosition(d.center.add(new vec3(off.x*c+off.z*s,0,-off.x*s+off.z*c)));
      t.setWorldRotation(quat.angleAxis(d.yaw0+delta,vec3.up()));
      this.onChange();
    }
  }

  private start(mode:"define"|"align",onDone:(ok:boolean)=>void):void {
    this.mode=mode;this.done=onDone;this.drag=null;
    this.root.enabled=true;
    this.redraw(true);
    this.buildPanel();
  }
  private finish(ok:boolean):void {
    const done=this.done;
    this.mode=null;this.done=null;this.drag=null;
    this.retire(this.handles);this.retire(this.ui);
    this.handles=null;this.ui=null;
    // The outline is kept (hidden) for later saves this session.
    this.root.enabled=false;
    if(done)done(ok);
  }

  private ensureRoot():void {
    if(this.root&&!isNull(this.root))return;
    this.root=global.scene.createSceneObject("RoomOutline");
    const lineSo=child(this.root,"Lines",vec3.zero());
    this.linesBuilder=builder();
    this.lines=lineSo.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    this.lines.mesh=this.linesBuilder.getMesh();this.lines.mainMaterial=this.lineMaterial;
    this.lines.setRenderOrder(100);
  }
  /** Rebuilds the floor line, and with `handles` the draggable pucks too (not while a corner is being
   * dragged — rebuilding would destroy the puck in the user's hand). */
  private redraw(handles:boolean):void {
    const b=this.linesBuilder;
    if(b.getIndicesCount()>0)b.eraseIndices(0,b.getIndicesCount());
    if(b.getVerticesCount()>0)b.eraseVertices(0,b.getVerticesCount());
    const ix:number[]=[];let v=0;
    const n=this.pts.length;
    for(let i=0;i<n;i++){
      const a=this.pts[i],c=this.pts[(i+1)%n];
      const dx=c.x-a.x,dz=c.y-a.y,len=Math.max(0.01,Math.hypot(dx,dz));
      const nx=-dz/len*LINE_WIDTH/2,nz=dx/len*LINE_WIDTH/2;
      for(const q of [[a.x+nx,a.y+nz],[a.x-nx,a.y-nz],[c.x-nx,c.y-nz],[c.x+nx,c.y+nz]])
        b.appendVerticesInterleaved([q[0],LIFT,q[1],0,1,0,...LINE_COLOR]);
      ix.push(v,v+1,v+2,v,v+2,v+3,v,v+2,v+1,v,v+3,v+2);v+=4;
    }
    b.appendIndices(ix);b.updateMesh();
    if(handles)this.buildHandles();
    else this.placeHandles();
  }
  /** Disables now, destroys a moment later: SIK keeps a reference to the button just released (the one
   * whose press got us here), and destroying it outright leaves SIK erroring on a dead object every frame. */
  private retire(so:SceneObject):void {
    if(!so||isNull(so))return;
    so.enabled=false;
    this.schedule(0.5,()=>{if(!isNull(so))so.destroy();});
  }
  private buildHandles():void {
    this.retire(this.handles);
    this.handles=child(this.root,"Handles",vec3.zero());
    if(this.mode==="define"){
      this.pts.forEach((_p,i)=>{
        const h=this.puck(this.handles,"Corner"+i,CORNER_RADIUS,CORNER_COLOR,null);
        this.onPress(h,e=>{this.drag={interactor:e,kind:"corner",index:i};});
        const plus=this.puck(this.handles,"Add"+i,PLUS_RADIUS,PLUS_COLOR,null,"+");
        this.onPress(plus,()=>this.addCorner(i));
      });
    }else{
      const move=this.puck(this.handles,"Move",PUCK_RADIUS,PUCK_COLOR,MOVE_ICON);
      this.onPress(move,e=>{
        const hit=this.floorHit(e);
        if(hit)this.drag={interactor:e,kind:"move",index:-1,grab:this.root.getTransform().getWorldPosition().sub(hit)};
      });
      const turn=this.puck(this.handles,"Turn",PUCK_RADIUS,PUCK_COLOR,TURN_ICON);
      this.onPress(turn,e=>{
        const hit=this.floorHit(e),center=this.centerWorld();
        if(hit)this.drag={interactor:e,kind:"turn",index:-1,center,
          origin0:this.root.getTransform().getWorldPosition(),yaw0:this.frame.yaw,
          angle0:Math.atan2(hit.x-center.x,hit.z-center.z)};
      });
    }
    this.placeHandles();
  }
  /** Puts each puck where it belongs: corners on the corners, "+" at edge midpoints, the move puck in the
   * middle and the turn puck just beyond the far side. */
  private placeHandles():void {
    if(!this.handles||isNull(this.handles))return;
    const n=this.pts.length;
    const set=(name:string,x:number,z:number)=>{
      for(let i=0;i<this.handles.getChildrenCount();i++){
        const c=this.handles.getChild(i);
        if(c.name===name){c.getTransform().setLocalPosition(new vec3(x,LIFT,z));return;}
      }
    };
    if(this.mode==="define"){
      for(let i=0;i<n;i++){
        const a=this.pts[i],c=this.pts[(i+1)%n];
        set("Corner"+i,a.x,a.y);
        set("Add"+i,(a.x+c.x)/2,(a.y+c.y)/2);
      }
    }else{
      const ctr=this.centerLocal();
      let far=0;for(const p of this.pts)far=Math.max(far,Math.hypot(p.x-ctr.x,p.y-ctr.y));
      set("Move",ctr.x,ctr.y);
      set("Turn",ctr.x+far+TURN_OFFSET,ctr.y);
    }
  }
  private addCorner(edge:number):void {
    const n=this.pts.length,a=this.pts[edge],c=this.pts[(edge+1)%n];
    this.pts.splice(edge+1,0,new vec2((a.x+c.x)/2,(a.y+c.y)/2));
    // Rebuilt a beat later, outside the "+" puck's own press handler (it's retired with the old pucks).
    this.schedule(0.05,()=>{if(this.mode==="define")this.redraw(true);});
  }

  private buildPanel():void {
    this.retire(this.ui);
    const ui=global.scene.createSceneObject("RoomOutlinePanel");
    placeInView(ui,this.camera,PANEL_DISTANCE,PANEL_DROP);
    ui.getTransform().setLocalScale(vec3.one().uniformScale(PANEL_SCALE));
    ui.createComponent("Component.Canvas");
    panel(ui,PANEL_W,PANEL_H,PANEL_TINT,3);
    const define=this.mode==="define";
    text(ui,define?"Outline the room":"Line up the room",new vec3(0,10,0.5),PANEL_W-6,7,TITLE_SIZE,TITLE_INK);
    text(ui,define?"Drag the corners to your walls. Tap + to add a corner."
      :"Drag the outline onto your walls. Turn it with the ring.",new vec3(0,1,0.5),PANEL_W-8,10,BODY_SIZE,BODY_INK);
    if(define){
      pillButton(ui,"Skip",new vec3(-17,-10,0.5),24,7,BUTTON_SIZE,true,()=>this.finish(false));
      pillButton(ui,"Save layout",new vec3(13,-10,0.5),34,7,BUTTON_SIZE,false,()=>this.finish(true));
    }else{
      pillButton(ui,"Done",new vec3(0,-10,0.5),30,7,BUTTON_SIZE,false,()=>this.finish(true));
    }
    sweepColliders(ui,this.schedule);
    this.ui=ui;
  }

  /** A flat round puck on the floor with a "+" or an icon on top; pressable from a distance. */
  private puck(parent:SceneObject,name:string,radius:number,color:[number,number,number,number],icon:Texture,glyph?:string):SceneObject {
    const so=child(parent,name,vec3.zero());
    const top=child(so,"Top",vec3.zero());
    const b=builder();
    buildLathe(b,[[0,0],[radius,0],[radius,1.6],[radius*0.85,2.2],[0,2.3]],24,color);
    const v=top.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    v.mesh=b.getMesh();v.mainMaterial=this.material;b.updateMesh();
    if(icon){
      const img=child(top,"Icon",new vec3(0,2.4,0));
      image(img,icon,radius*1.1,radius*1.1,new vec4(0.08,0.06,0.12,1));
      img.getTransform().setLocalRotation(quat.angleAxis(-Math.PI/2,vec3.right()));
    }
    if(glyph){
      const g=child(top,"Glyph",new vec3(0,2.5,0));
      const t=g.createComponent("Component.Text") as Text;
      t.text=glyph;t.font=FONT;t.size=200;t.textFill.color=new vec4(0.1,0.08,0.14,1);t.depthTest=true;
      t.horizontalAlignment=HorizontalAlignment.Center;t.verticalAlignment=VerticalAlignment.Center;
      t.horizontalOverflow=HorizontalOverflow.Overflow;t.verticalOverflow=VerticalOverflow.Overflow;
      g.getTransform().setLocalRotation(quat.angleAxis(-Math.PI/2,vec3.right()));
    }
    const col=so.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const shape=Shape.createBoxShape();shape.size=new vec3(Math.max(HIT_SIZE,radius*2.4),12,Math.max(HIT_SIZE,radius*2.4));col.shape=shape;
    const input=so.createComponent(Interactable.getTypeName()) as Interactable;
    input.targetingMode=3;
    addHoverFeedback(input,top);
    return so;
  }
  private onPress(so:SceneObject,fn:(interactor:Interactor)=>void):void {
    const input=so.getComponent(Interactable.getTypeName()) as Interactable;
    input.onTriggerStart.add(e=>{if(this.mode&&e.interactor)fn(e.interactor);});
  }
  /** Where the interactor's ray meets the floor, or null if it isn't pointing down at it. A near-field
   * interaction (hand right at the puck) has no ray: then it's the floor point under the hand. */
  private floorHit(interactor:Interactor):vec3 {
    const start=interactor.startPoint,dir=interactor.direction;
    if(!start)return null;
    if(!dir||dir.length<1e-3)return new vec3(start.x,this.floorY(),start.z);
    const d=dir.normalize();
    if(d.y>-0.05)return null;
    const t=(this.floorY()-start.y)/d.y;
    if(t<0||t>RAY_REACH)return null;
    return start.add(d.uniformScale(t));
  }
  private centerLocal():vec2 {
    let x=0,z=0;for(const p of this.pts){x+=p.x;z+=p.y;}
    return new vec2(x/this.pts.length,z/this.pts.length);
  }
  private centerWorld():vec3 {
    const c=this.centerLocal();
    return this.root.getTransform().getWorldTransform().multiplyPoint(new vec3(c.x,0,c.y));
  }
}

function builder():MeshBuilder {
  const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
  b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;return b;
}
