import type {AngleScreen} from "./ScoutPaletteUI";

// Lined up = head within STAND_RADIUS (cm) of the camera's spot and facing within FACE_TOLERANCE
// (degrees) of its shot direction.
const STAND_RADIUS=30,FACE_TOLERANCE=12;
// Held lined up this long before the countdown starts, then one count per COUNT_SECONDS.
const SETTLE_SECONDS=0.4,COUNT_SECONDS=0.8,COUNT_FROM=3;
// After a capture the camera is "moved" once it drifts this far (cm) or turns this much (degrees).
const STALE_MOVE=8,STALE_TURN=5;
// Heads-up ring: how far in front of the eyes and how far below the eye line it floats (cm).
const HUD_DISTANCE=55,HUD_DROP=10,HUD_RADIUS=3.2;
const FLOOR_LIFT=0.6; // above the real floor, avoiding z-fighting
const AMBER=[1,0.66,0.25,1],CREAM=[0.93,0.88,0.78,1],DIM=[0.62,0.59,0.54,1],GREEN=[0.45,0.95,0.55,1],FLASH=[1,1,1,1];
const HINT_COLOR=new vec4(0.93,0.88,0.78,1);
const FONT=requireAsset("../Fonts/Inter.ttf") as Font;

export type AngleCameraRecord={root:SceneObject;screen:AngleScreen;photo:boolean;captured:{pos:vec3;dir:vec3}|null;stale:boolean};

/** Camera-angle capture flow: each Camera asset's monitor (an AngleScreen) starts empty; "Capture
 * this angle" walks the user to the camera's spot with a floor marker and a heads-up ring, counts
 * down once they're lined up, and puts the photo on the monitor. Plain class driven by ScoutMain.
 *
 * The photo is a stand-in for now: capture() shows a bundled mock image. The real version asks
 * CameraModule.requestImage for a still, cropped to the monitor's aspect. */
export class ScoutAngleCapture {
  private cameras:AngleCameraRecord[]=[];
  private active:AngleCameraRecord=null;
  private marker:SceneObject=null;
  private hud:SceneObject=null;
  private ring:RenderMeshVisual;
  private ringBuilder:MeshBuilder;
  private hint:Text;
  private alignedSince:number=null;

  constructor(private material:Material,private camera:Camera,private floorY:()=>number,private schedule:(seconds:number,fn:()=>void)=>void){}

  /** True while walking the user to a camera — placement pinches should be ignored meanwhile. */
  get guiding():boolean {return !!this.active;}

  register(root:SceneObject,screen:AngleScreen,photo:boolean):AngleCameraRecord {
    const rec:AngleCameraRecord={root,screen,photo,captured:null,stale:false};
    this.cameras.push(rec);
    return rec;
  }
  start(rec:AngleCameraRecord):void {
    if(this.active)this.cancel();
    this.active=rec;this.alignedSince=null;
    rec.screen.setState("guiding");
    this.buildMarker(rec.root);
    this.buildHud();
  }
  cancel():void {
    const rec=this.active;
    if(!rec)return;
    this.endGuide();
    if(!isNull(rec.root))rec.screen.setState(rec.captured?(rec.stale?"stale":"captured"):"empty");
  }

  update():void {
    this.cameras=this.cameras.filter(r=>!isNull(r.root));
    if(this.active&&isNull(this.active.root))this.endGuide();
    for(const rec of this.cameras)this.checkStale(rec);
    if(this.active)this.updateGuide(this.active);
  }

  private updateGuide(rec:AngleCameraRecord):void {
    const head=this.camera.getTransform().getWorldPosition();
    const look=flat(this.camera.getTransform().forward.uniformScale(-1));
    const spot=rec.root.getTransform().getWorldPosition();
    const shot=lensDirection(rec.root);
    const dist=new vec2(head.x-spot.x,head.z-spot.z).length;
    const turn=Math.acos(Math.max(-1,Math.min(1,look.dot(shot))))*180/Math.PI;
    const near=dist<=STAND_RADIUS,facing=turn<=FACE_TOLERANCE;
    const now=getTime();
    let status:string,progress=0,color=DIM;
    if(!near){
      status="Walk to the camera · "+(dist>=100?(dist/100).toFixed(1)+" m":Math.round(dist)+" cm");
      this.alignedSince=null;
    }else if(!facing){
      status="Turn to face the shot";
      progress=Math.max(0,1-turn/90)*0.5;color=AMBER;
      this.alignedSince=null;
    }else{
      if(this.alignedSince===null)this.alignedSince=now;
      const held=now-this.alignedSince-SETTLE_SECONDS;
      color=GREEN;
      if(held<0){status="Hold still";progress=0.5;}
      else{
        const count=COUNT_FROM-Math.floor(held/COUNT_SECONDS);
        progress=0.5+0.5*Math.min(1,held/(COUNT_FROM*COUNT_SECONDS));
        if(count<=0){this.capture(rec);return;}
        status=String(count);
      }
    }
    rec.screen.setStatus(status);
    this.hint.text=status;
    this.drawRing(progress,color);
    this.placeHud();
  }

  /** Stand-in capture: shows the mock photo. Records the camera's pose so a later move marks it stale. */
  private capture(rec:AngleCameraRecord):void {
    // The monitor already carries the mock photo as its texture; the real capture will setImage here.
    rec.captured={pos:rec.root.getTransform().getWorldPosition(),dir:lensDirection(rec.root)};
    rec.stale=false;
    rec.screen.setState("captured");
    this.hint.text="Captured";
    this.drawRing(1,FLASH);
    this.active=null;
    // Leave the "Captured" confirmation up for a beat before clearing the guide — unless another
    // capture has started meanwhile and replaced it.
    const hud=this.hud;
    this.schedule(0.7,()=>{if(this.hud===hud&&!this.active)this.endGuide();});
  }
  private checkStale(rec:AngleCameraRecord):void {
    if(!rec.captured||rec.stale)return;
    const p=rec.root.getTransform().getWorldPosition(),d=lensDirection(rec.root);
    const moved=new vec2(p.x-rec.captured.pos.x,p.z-rec.captured.pos.z).length>STALE_MOVE;
    const turned=Math.acos(Math.max(-1,Math.min(1,d.dot(rec.captured.dir))))*180/Math.PI>STALE_TURN;
    if(moved||turned){rec.stale=true;rec.screen.setState("stale");}
  }

  private endGuide():void {
    this.active=null;
    if(this.marker&&!isNull(this.marker))this.marker.destroy();
    if(this.hud&&!isNull(this.hud))this.hud.destroy();
    this.marker=null;this.hud=null;
  }

  /** Floor marker on the camera's spot: a ring the size of the "close enough" zone, with an arrow
   * pointing the way the camera shoots. Lies flat on the floor; stays put if the camera moves. */
  private buildMarker(root:SceneObject):void {
    const so=global.scene.createSceneObject("AngleCaptureMarker");
    const p=root.getTransform().getWorldPosition(),shot=lensDirection(root);
    so.getTransform().setWorldPosition(new vec3(p.x,this.floorY()+FLOOR_LIFT,p.z));
    // Local +Z along the shot direction.
    so.getTransform().setWorldRotation(quat.lookAt(shot,vec3.up()));
    const b=builder(),ix:number[]=[];
    let v=ringStrip(b,ix,0,STAND_RADIUS-1.6,STAND_RADIUS,48,1,AMBER);
    // Arrow: a shaft and head from the centre out past the ring, toward the shot.
    const quad=(pts:number[][],c:number[])=>{
      pts.forEach(q=>b.appendVerticesInterleaved([q[0],0,q[1],0,1,0,...c]));
      ix.push(v,v+1,v+2,v,v+2,v+3,v,v+2,v+1,v,v+3,v+2);v+=4;
    };
    quad([[-1.6,4],[1.6,4],[1.6,STAND_RADIUS+6],[-1.6,STAND_RADIUS+6]],CREAM);
    quad([[-6,STAND_RADIUS+6],[6,STAND_RADIUS+6],[0.01,STAND_RADIUS+15],[-0.01,STAND_RADIUS+15]],CREAM);
    // Two footprints at the centre, toes toward the shot.
    for(const sx of [-1,1])quad([[sx*5-2.2,-8],[sx*5+2.2,-8],[sx*5+2.2,6],[sx*5-2.2,6]],CREAM);
    b.appendIndices(ix);
    this.visual(so,b);
    this.marker=so;
  }
  private buildHud():void {
    const so=global.scene.createSceneObject("AngleCaptureHud");
    const ringSo=global.scene.createSceneObject("Ring");ringSo.setParent(so);
    this.ringBuilder=builder();
    this.ring=this.visual(ringSo,this.ringBuilder);
    const textSo=global.scene.createSceneObject("Hint");textSo.setParent(so);
    textSo.getTransform().setLocalPosition(new vec3(0,-HUD_RADIUS-2.2,0));
    const t=textSo.createComponent("Component.Text") as Text;
    t.font=FONT;t.size=48;t.textFill.color=HINT_COLOR;t.depthTest=false;
    t.horizontalAlignment=HorizontalAlignment.Center;t.verticalAlignment=VerticalAlignment.Center;
    t.horizontalOverflow=HorizontalOverflow.Overflow;t.verticalOverflow=VerticalOverflow.Overflow;
    this.hint=t;
    this.hud=so;
    this.drawRing(0,DIM);
    this.placeHud();
  }
  /** Keeps the heads-up ring just below the centre of view, facing the user. */
  private placeHud():void {
    if(!this.hud||isNull(this.hud))return;
    const ct=this.camera.getTransform(),look=ct.forward.uniformScale(-1);
    const pos=ct.getWorldPosition().add(look.uniformScale(HUD_DISTANCE)).add(vec3.up().uniformScale(-HUD_DROP));
    const t=this.hud.getTransform();
    t.setWorldPosition(pos);
    t.setWorldRotation(quat.lookAt(ct.getWorldPosition().sub(pos).normalize(),vec3.up()));
  }
  /** Track ring plus a filled arc for `progress` (0..1), clockwise from the top. */
  private drawRing(progress:number,color:number[]):void {
    if(!this.ringBuilder)return;
    const b=this.ringBuilder;
    // DynamicMesh rejects erasing an empty range, which is what a fresh builder has.
    if(b.getIndicesCount()>0)b.eraseIndices(0,b.getIndicesCount());
    if(b.getVerticesCount()>0)b.eraseVertices(0,b.getVerticesCount());
    const ix:number[]=[];
    let v=ringStripXY(b,ix,0,HUD_RADIUS-0.35,HUD_RADIUS,40,1,DIM);
    if(progress>0)v=ringStripXY(b,ix,v,HUD_RADIUS-0.5,HUD_RADIUS+0.15,Math.max(2,Math.round(40*progress)),progress,color);
    b.appendIndices(ix);
    b.updateMesh();
  }
  private visual(so:SceneObject,b:MeshBuilder):RenderMeshVisual {
    const v=so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    v.mesh=b.getMesh();v.mainMaterial=this.material;b.updateMesh();return v;
  }
}

function builder():MeshBuilder {
  const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
  b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;return b;
}
/** The Camera asset shoots along its local +X (see ScoutMain.spawnMarker's camera correction). */
function lensDirection(root:SceneObject):vec3 {
  return flat(root.getTransform().getWorldRotation().multiplyVec3(vec3.right()));
}
function flat(v:vec3):vec3 {
  const f=new vec3(v.x,0,v.z);
  return f.length>1e-4?f.normalize():new vec3(0,0,1);
}
/** Flat ring (or arc of `fraction`) in the XZ plane, double-sided. Returns the next vertex index. */
function ringStrip(b:MeshBuilder,ix:number[],v:number,inner:number,outer:number,segs:number,fraction:number,c:number[]):number {
  for(let i=0;i<=segs;i++){
    const a=fraction*2*Math.PI*i/segs,s=Math.sin(a),co=Math.cos(a);
    b.appendVerticesInterleaved([s*inner,0,co*inner,0,1,0,...c]);
    b.appendVerticesInterleaved([s*outer,0,co*outer,0,1,0,...c]);
  }
  for(let i=0;i<segs;i++){
    const a=v+i*2;
    ix.push(a,a+1,a+3,a,a+3,a+2,a,a+3,a+1,a,a+2,a+3);
  }
  return v+(segs+1)*2;
}
/** Same as ringStrip but upright in the XY plane (for the heads-up ring), starting at the top. */
function ringStripXY(b:MeshBuilder,ix:number[],v:number,inner:number,outer:number,segs:number,fraction:number,c:number[]):number {
  for(let i=0;i<=segs;i++){
    const a=fraction*2*Math.PI*i/segs,s=Math.sin(a),co=Math.cos(a);
    b.appendVerticesInterleaved([s*inner,co*inner,0,0,0,1,...c]);
    b.appendVerticesInterleaved([s*outer,co*outer,0,0,0,1,...c]);
  }
  for(let i=0;i<segs;i++){
    const a=v+i*2;
    ix.push(a,a+1,a+3,a,a+3,a+2,a,a+3,a+1,a,a+2,a+3);
  }
  return v+(segs+1)*2;
}
