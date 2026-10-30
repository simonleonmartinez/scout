/** First-run floor confirmation: the user points at the floor and holds steady while a ring on the floor
 * fills in, with the instructions in the middle of the ring. Plain class driven by ScoutMain's update —
 * ScoutMain owns hit testing and decides which hits are floor candidates. */
const RING_RADIUS=32,RING_WIDTH=2.4,RING_SEGMENTS=64;
const FILL_SECONDS=2;
const DRAIN_SECONDS=1;
// A hit farther than this (cm, horizontally) from the ring restarts the hold — the user moved on.
const MOVE_TOLERANCE=20;
const ANCHOR_EASE=0.3;
const LIFT=0.6; // above the real floor mesh, like the ground indicator
const DONE_SECONDS=1.2;
const SKIP_AFTER=20;
const TRACK_COLOR:[number,number,number,number]=[0.08,0.25,0.12,1];
const FILL_COLOR:[number,number,number,number]=[0.35,1,0.5,1];
const TEXT_COLOR=new vec4(0.75,1,0.8,1);
const FONT=requireAsset("../Fonts/Inter.ttf") as Font;

export class ScoutFloorSetup {
  private ring:SceneObject;
  private fill:RenderMeshVisual;
  private fillBuilder:MeshBuilder;
  private label:SceneObject;
  private text:Text;
  private anchor:vec3=null;
  private progress=0;
  private drawnSegments=-1;
  private started:number=null;
  private confirmedAt:number=null;
  private skipped=false;
  /** True once the floor is confirmed or skipped — placement may begin. */
  get done():boolean {return this.confirmedAt!==null||this.skipped;}
  /** Where on the floor the ring was confirmed (null if setup was skipped or isn't done). */
  get spot():vec3 {return this.confirmedAt!==null?this.anchor:null;}
  /** After a while without success, a pinch may skip setup (e.g. a floor depth sensing can't see). */
  get canSkip():boolean {return !this.done&&this.started!==null&&getTime()-this.started>SKIP_AFTER;}

  constructor(material:Material,private camera:Camera,private onConfirmed:(floorY:number)=>void){
    const mat=material.clone();
    mat.mainPass.depthTest=false;mat.mainPass.depthWrite=false;
    this.ring=global.scene.createSceneObject("FloorSetupRing");
    const track=this.meshObject("Track",mat);
    const tb=this.builder();this.arc(tb,1,TRACK_COLOR);track.mesh=tb.getMesh();tb.updateMesh();
    this.fill=this.meshObject("Fill",mat);
    this.fill.setRenderOrder(101);
    this.fillBuilder=this.builder();
    this.fill.mesh=this.fillBuilder.getMesh();
    this.label=global.scene.createSceneObject("FloorSetupLabel");
    const t=this.label.createComponent("Component.Text") as Text;
    t.font=FONT;t.size=150;t.textFill.color=TEXT_COLOR;t.depthTest=false;
    t.horizontalAlignment=HorizontalAlignment.Center;t.verticalAlignment=VerticalAlignment.Center;
    t.horizontalOverflow=HorizontalOverflow.Overflow;t.verticalOverflow=VerticalOverflow.Overflow;
    this.text=t;
    this.ring.enabled=false;
  }
  /** Runs setup again from the start (menu → Reset Floor). */
  restart():void {
    this.anchor=null;this.progress=0;this.started=null;this.confirmedAt=null;this.skipped=false;
    this.ring.enabled=false;
  }
  /** Pinch-to-skip: placement falls back to automatic floor detection. */
  skip():void {this.skipped=true;this.ring.enabled=false;this.label.enabled=false;}

  /** `floorHit` is a fresh floor-candidate hit where the user is pointing, or null; `aim` places the
   * prompt when there's nothing to anchor the ring to yet. */
  update(floorHit:vec3,aim:vec3):void {
    if(this.skipped)return;
    if(this.started===null)this.started=getTime();
    if(this.confirmedAt!==null){this.finishing();return}
    const dt=getDeltaTime();
    if(floorHit){
      const far=!this.anchor||Math.hypot(floorHit.x-this.anchor.x,floorHit.z-this.anchor.z)>MOVE_TOLERANCE;
      if(far){this.anchor=floorHit;this.progress=0;}
      else this.anchor=vec3.lerp(this.anchor,floorHit,ANCHOR_EASE);
      this.progress=Math.min(1,this.progress+dt/FILL_SECONDS);
    }else{
      this.progress=Math.max(0,this.progress-dt/DRAIN_SECONDS);
      if(this.progress===0)this.anchor=null;
    }
    this.ring.enabled=!!this.anchor;
    this.drawFill(this.progress);
    const skipLine=this.canSkip?"\nPinch to skip":"";
    if(this.anchor){
      this.text.text=(floorHit?"Hold steady to\nset the floor":"Point at the floor")+skipLine;
      this.placeRing(this.anchor);
    }else{
      this.text.text="Point at the floor"+skipLine;
      this.placeLabel(aim);
    }
    if(this.progress>=1){
      this.confirmedAt=getTime();
      this.text.text="Floor set";
      this.onConfirmed(this.anchor.y);
    }
  }
  /** Holds the full ring and "Floor set" briefly, then tidies away. */
  private finishing():void {
    const t=getTime()-this.confirmedAt;
    if(t>DONE_SECONDS){this.ring.enabled=false;this.label.enabled=false;return}
    this.placeRing(this.anchor);
  }
  private placeRing(center:vec3):void {
    const camPos=this.camera.getTransform().getWorldPosition();
    const ringT=this.ring.getTransform();
    ringT.setWorldPosition(center.add(new vec3(0,LIFT,0)));
    // Local +Z toward the user, so the fill starts at the ring's far side and sweeps clockwise.
    ringT.setWorldRotation(quat.angleAxis(Math.atan2(camPos.x-center.x,camPos.z-center.z),vec3.up()));
    this.placeLabel(center.add(new vec3(0,4,0)));
  }
  /** Copy floats at the given point, turned to face the user. */
  private placeLabel(position:vec3):void {
    this.label.enabled=true;
    const toCamera=this.camera.getTransform().getWorldPosition().sub(position).normalize();
    this.label.getTransform().setWorldPosition(position);
    this.label.getTransform().setWorldRotation(quat.lookAt(toCamera,vec3.up()));
  }
  private drawFill(progress:number):void {
    const segments=Math.round(progress*RING_SEGMENTS);
    if(segments===this.drawnSegments)return;
    this.drawnSegments=segments;
    const b=this.fillBuilder;
    // Erasing an already-empty range throws, so only clear what's there.
    if(b.getIndicesCount()>0)b.eraseIndices(0,b.getIndicesCount());
    if(b.getVerticesCount()>0)b.eraseVertices(0,b.getVerticesCount());
    if(segments>0)this.arc(b,segments/RING_SEGMENTS,FILL_COLOR);
    b.updateMesh();
  }
  /** Flat ring band in the floor plane, from the far side (local -Z) clockwise seen from above. */
  private arc(b:MeshBuilder,fraction:number,color:[number,number,number,number]):void {
    const segs=Math.max(1,Math.round(fraction*RING_SEGMENTS));
    const inner=RING_RADIUS-RING_WIDTH/2,outer=RING_RADIUS+RING_WIDTH/2;
    const ix:number[]=[];
    for(let i=0;i<=segs;i++){
      const a=fraction*2*Math.PI*i/segs,s=Math.sin(a),c=-Math.cos(a);
      b.appendVerticesInterleaved([inner*s,0,inner*c,0,1,0,...color]);
      b.appendVerticesInterleaved([outer*s,0,outer*c,0,1,0,...color]);
      // Both windings so the band shows from above whichever way it's rotated.
      if(i<segs){const v=i*2;ix.push(v,v+1,v+3,v,v+3,v+2,v,v+3,v+1,v,v+2,v+3);}
    }
    b.appendIndices(ix);
  }
  private meshObject(name:string,material:Material):RenderMeshVisual {
    const so=global.scene.createSceneObject(name);so.setParent(this.ring);
    const visual=so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mainMaterial=material;visual.setRenderOrder(100);
    return visual;
  }
  private builder():MeshBuilder {
    const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
    b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;return b;
  }
}
