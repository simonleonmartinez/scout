import {Interactable} from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import {Interactor} from "InteractionKit.lspkg/Core/Interactor/Interactor";
import animate from "InteractionKit.lspkg/Utils/animate";

/** One selectable stop on a dial — the underlying numeric value plus how it's displayed. */
export type DialStep = {value:number; text:string};

export type RotaryDialTheme = {
  font:Font;
  textColor:vec4;
  idleColor:vec4;
  hoverColor:vec4;
  activeColor:vec4;
  tickColor:vec4;
};

export type RotaryDialConfig = {
  label:string;
  steps:DialStep[];
  initialIndex:number;
  radius?:number;
  onChange:(index:number,value:number)=>void;
  /** WB/Kelvin-style dials only: fills the ring's hole with the color the current value represents,
   * so the dial itself previews the change instead of needing a needle. */
  fillColorForValue?:(value:number)=>vec4;
};

// A physical dial sweeps a bit short of full circle, leaving a visible gap at the bottom so the
// current position always reads unambiguously (a full 360° dial has no "start").
const ARC_HALF=135*Math.PI/180;

/** A compact, physical-looking rotary dial: a metal torus ring (grey, matching the camera/light gear
 * it sits above) with subtle tick marks, a label above and the current value as text below — the
 * number is the readout, not a needle. Click/drag (direct or indirect) selects one of `config.steps`,
 * snapping as you go. Purely a view — callers own what a value change actually does. */
// How close (cm) a closed hand must be to a dial's face to take hold of it.
const DIAL_REACH=8;
// Grooves round a dial's rim.
const KNURL_TEETH=40;
/** Ring meshes by size and colour, shared by every dial (see rebuildRingMesh). */
const RING_MESHES=new Map<string,RenderMesh>();

export class ScoutRotaryDial {
  /** Every dial alive, for up-close fist turning (ScoutMain looks for one within reach of the hand). */
  static readonly all:ScoutRotaryDial[]=[];
  /** Called whenever any dial clicks to a new step, with how many steps it jumped (for the click sound). */
  static onStep:((steps:number)=>void)|null=null;
  /** A fist closing on this dial up close starts turning it; returns whether it caught. */
  handTurnBegin(point:vec3):boolean {
    if(isNull(this.root)||!this.root.isEnabledInHierarchy)return false;
    const t=this.root.getTransform(),d=point.sub(t.getWorldPosition());
    const scale=t.getWorldScale().x;
    const off=d.dot(t.forward),inPlane=d.sub(t.forward.uniformScale(off)).length;
    if(Math.abs(off)>DIAL_REACH||inPlane>(this.ringRadius+this.tubeRadius)*scale+DIAL_REACH*0.5)return false;
    this.active=true;this.refreshRingColor();
    this.applyAngle(this.angleFromPoint(point));
    return true;
  }
  handTurnUpdate(point:vec3):void {this.applyAngle(this.angleFromPoint(point));}
  handTurnEnd():void {this.active=false;this.refreshRingColor();}
  private angleFromPoint(point:vec3):number|null {
    const t=this.root.getTransform(),v=point.sub(t.getWorldPosition());
    const x=v.dot(t.right),y=v.dot(t.up);
    if(Math.abs(x)<1e-5&&Math.abs(y)<1e-5)return null;
    return Math.atan2(x,y);
  }
  private applyAngle(angle:number|null):void {
    if(angle===null)return;
    const idx=this.indexFromAngle(angle);
    if(idx!==this.index){
      ScoutRotaryDial.onStep?.(Math.abs(idx-this.index));
      this.index=idx;this.updateValueText();this.refreshFill();this.spinTo(idx);
      this.config.onChange(idx,this.config.steps[idx].value);
    }
  }
  private index:number;
  private ringRadius:number;
  private tubeRadius:number;
  private ringVisual:RenderMeshVisual;
  private fillVisual:RenderMeshVisual|null=null;
  private valueText:Text;
  private hovered=false;
  private active=false;
  readonly root:SceneObject;
  constructor(parent:SceneObject,pos:vec3,private material:Material,private theme:RotaryDialTheme,private config:RotaryDialConfig){
    this.index=config.initialIndex;
    const radius=config.radius??5.2;
    // Bigger hole relative to the tube (0.75/0.25 split, up from 0.72/0.28) so the centered value text
    // has more room to sit inside the ring without crowding the metal.
    this.ringRadius=radius*0.75;
    this.tubeRadius=radius*0.25;
    this.root=this.obj(parent,"Dial",pos);
    const outer=this.ringRadius+this.tubeRadius;
    this.text(this.root,config.label,new vec3(0,outer+3.4,0.2),outer*2+6,2.2,theme.textColor,70);
    this.buildTicks();
    this.buildRing();
    if(config.fillColorForValue)this.buildFill();
    // Value sits inside the ring's hole instead of below it. Built last (and so painted last, per this
    // engine's hierarchy-order rendering) so it lands on top of the fill instead of underneath it —
    // built earlier, the fill fully hid it despite sitting at a nearer z. Against a bright WB/Kelvin
    // color swatch the theme's light text would wash out, so those dials get a fixed dark value color
    // instead — blackbody colors are never dark enough themselves to make dark text unreadable.
    const holeDiameter=(this.ringRadius-this.tubeRadius)*2;
    const valueColor=config.fillColorForValue?new vec4(0.08,0.08,0.09,1):theme.textColor;
    this.valueText=this.text(this.root,"",new vec3(0,0,this.tubeRadius+0.15),holeDiameter*0.92,holeDiameter*0.6,valueColor,56);
    this.updateValueText();
    this.refreshFill();
    ScoutRotaryDial.all.push(this);
  }
  private buildRing():void {
    const host=this.obj(this.root,"DialKnob",vec3.zero());
    // The puck itself lives on a child that turns with the value; the hit box on `host` stays put.
    this.ridges=this.obj(host,"Knurl",vec3.zero());
    this.ringVisual=this.ridges.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    this.ringVisual.mainMaterial=this.material;
    this.rebuildRingMesh(this.theme.idleColor);
    this.spinTo(this.index,false);
    const col=host.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const shape=Shape.createBoxShape();
    const outer=(this.ringRadius+this.tubeRadius)*2;
    shape.size=new vec3(outer,outer,this.tubeRadius*2);
    col.shape=shape;
    const input=host.createComponent(Interactable.getTypeName()) as Interactable;
    input.targetingMode=3;input.enableInstantDrag=true;
    input.onHoverEnter.add(()=>{this.hovered=true;this.refreshRingColor();});
    input.onHoverExit.add(()=>{this.hovered=false;this.refreshRingColor();});
    input.onTriggerStart.add(e=>{
      e.stopPropagation();this.active=true;this.refreshRingColor();
      this.applyFromInteractor(e.interactor);
    });
    input.onTriggerUpdate.add(e=>{
      e.stopPropagation();
      this.applyFromInteractor(e.interactor);
    });
    const endDrag=()=>{this.active=false;this.refreshRingColor();};
    input.onTriggerEnd.add(endDrag);input.onTriggerEndOutside.add(endDrag);input.onTriggerCanceled.add(endDrag);
  }
  private applyFromInteractor(interactor:Interactor):void {
    const angle=this.angleFromInteractor(interactor);
    if(angle===null)return;
    const idx=this.indexFromAngle(angle);
    if(idx!==this.index){
      ScoutRotaryDial.onStep?.(Math.abs(idx-this.index));
      this.index=idx;this.updateValueText();this.refreshFill();this.spinTo(idx);
      this.config.onChange(idx,this.config.steps[idx].value);
    }
  }
  private angleFromInteractor(interactor:Interactor):number|null {
    const t=this.root.getTransform();
    const origin=t.getWorldPosition(),normal=t.forward,right=t.right,up=t.up;
    const point=this.planeIntersect(interactor,origin,normal);
    if(!point)return null;
    const v=point.sub(origin);
    const x=v.dot(right),y=v.dot(up);
    if(Math.abs(x)<1e-5&&Math.abs(y)<1e-5)return null;
    return Math.atan2(x,y);
  }
  private planeIntersect(interactor:Interactor,origin:vec3,normal:vec3):vec3|null {
    const start=interactor.startPoint,direction=interactor.direction;
    if(!start||!direction)return null;
    const denom=direction.dot(normal);
    if(Math.abs(denom)<0.015)return null;
    const dist=origin.sub(start).dot(normal)/denom;
    if(dist<0||dist>10000)return null;
    return start.add(direction.uniformScale(dist));
  }
  private indexFromAngle(angle:number):number {
    const clamped=Math.max(-ARC_HALF,Math.min(ARC_HALF,angle));
    const frac=(clamped+ARC_HALF)/(2*ARC_HALF);
    return Math.round(frac*(this.config.steps.length-1));
  }
  private angleForIndex(i:number):number {
    const n=this.config.steps.length;
    return n<=1?0:-ARC_HALF+(i/(n-1))*(2*ARC_HALF);
  }
  /** Subtle engraved tick marks around the ring's rim — small and low-contrast, reference marks rather
   * than the dial's main readout (the value text below is). */
  /** The fixed pointer just above the dial: a small wedge pointing down at the knurled rim, so the
   * puck visibly turns under it as the value changes. */
  private buildTicks():void {
    const pb=this.builder(),pix:number[]=[];
    const top=this.ringRadius+this.tubeRadius+0.35,w=this.tubeRadius*0.45,h=this.tubeRadius*0.6,pc=this.colorArr(this.theme.textColor);
    const tri=[[-w,top+h],[w,top+h],[0,top]];
    for(const zf of [0.08,-0.08])for(const [x,y] of tri)pb.appendVerticesInterleaved([x,y,zf,0,0,1,...pc]);
    pix.push(0,1,2,0,2,1,3,4,5,3,5,4);
    pb.appendIndices(pix);
    const pv=this.obj(this.root,"Pointer",vec3.zero()).createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    pv.mesh=pb.getMesh();pv.mainMaterial=this.material;pb.updateMesh();
  }
  private ridges:SceneObject=null;
  private ridgeAngle=0;
  private spinCancel:(()=>void)|null=null;
  /** Turns the knurled puck so the dial reads as rotating with the value (clockwise as it goes up). */
  private spinTo(index:number,animated=true):void {
    if(!this.ridges)return;
    const target=-this.angleForIndex(index);
    const t=this.ridges.getTransform();
    if(this.spinCancel){this.spinCancel();this.spinCancel=null;}
    if(!animated){this.ridgeAngle=target;t.setLocalRotation(quat.angleAxis(target,vec3.forward()));return;}
    const from=this.ridgeAngle;
    this.spinCancel=animate({duration:0.14,easing:"ease-out-quad",update:k=>{
      if(isNull(this.ridges))return;
      this.ridgeAngle=from+(target-from)*k;
      t.setLocalRotation(quat.angleAxis(this.ridgeAngle,vec3.forward()));
    }});
  }
  private builder():MeshBuilder {
    const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
    b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;return b;
  }
  /** A box with half-size `h`, centred at `centre` then turned by `rot`; faces shaded for a front light. */
  private box(b:MeshBuilder,ix:number[],vi:number,rot:quat,centre:vec3,h:number[],c:[number,number,number,number]):number {
    const faces:[number,number,number][]=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    for(const n of faces){
      const a=n[0]!==0?[0,1,0]:[1,0,0],bb=[n[1]*a[2]-n[2]*a[1],n[2]*a[0]-n[0]*a[2],n[0]*a[1]-n[1]*a[0]];
      const nw=rot.multiplyVec3(new vec3(n[0],n[1],n[2]));
      const s=Math.min(1.25,0.6+Math.max(0,nw.x*-0.45+nw.y*0.55+nw.z*0.7)*0.7);
      const col=[Math.min(1,c[0]*s),Math.min(1,c[1]*s),Math.min(1,c[2]*s),c[3]];
      for(const [sa,sb] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
        const local=new vec3((n[0]+a[0]*sa+bb[0]*sb)*h[0],(n[1]+a[1]*sa+bb[1]*sb)*h[1],(n[2]+a[2]*sa+bb[2]*sb)*h[2]);
        const p=rot.multiplyVec3(centre.add(local));
        b.appendVerticesInterleaved([p.x,p.y,p.z,nw.x,nw.y,nw.z,...col]);
      }
      ix.push(vi,vi+1,vi+2,vi,vi+2,vi+3,vi,vi+2,vi+1,vi,vi+3,vi+2);
      vi+=4;
    }
    return vi;
  }
  private refreshRingColor():void {
    const color=this.active?this.theme.activeColor:this.hovered?this.theme.hoverColor:this.theme.idleColor;
    this.rebuildRingMesh(color);
  }
  /** A real torus (not a flat ring image) built directly in the dial's own facing plane (local right/up,
   * normal local forward) — same construction ScoutTransformGizmo uses for its rotate handles, just
   * scaled down and closed into a full ring instead of a partial arc. Per-triangle vertices (not a
   * shared indexed grid) with a fixed-light diffuse shade baked into each face's color — this project's
   * vertex-color material renders flat-shaded, so without this the tube's own roundness (its whole
   * reason for reading as "3D" rather than a flat ring) is invisible at a glance; the badge spheres
   * elsewhere in this file use the identical technique. */
  private rebuildRingMesh(color:vec4):void {
    // Hover and drag only change the ring's colour: each size+colour is built once and shared by every
    // dial, so hovering just swaps meshes instead of rebuilding a 512-triangle torus on Specs.
    const key=[this.ringRadius,this.tubeRadius,color.x,color.y,color.z,color.w].map(n=>n.toFixed(3)).join("|");
    const cached=RING_MESHES.get(key);
    if(cached){this.ringVisual.mesh=cached;return;}
    const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
    b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;
    // A knurled metal puck, like a camera's command dial: flat front face, a hole in the middle for the
    // value, and grooves all the way round the rim that turn with it. Faces are shaded for a light from
    // the upper left so the teeth catch the light.
    const outer=this.ringRadius+this.tubeRadius,inner=this.ringRadius-this.tubeRadius;
    const depth=this.tubeRadius*0.22,front=this.tubeRadius*0.6,back=-this.tubeRadius*0.6;
    const teeth=KNURL_TEETH,ix:number[]=[];let vi=0;
    const L=new vec3(-0.45,0.55,0.7).normalize();
    const shade=(n:vec3)=>Math.min(1.3,0.5+Math.max(0,n.dot(L))*0.65+Math.pow(Math.max(0,n.dot(L)),16)*0.6);
    const col=(n:vec3,k=1)=>{const s2=shade(n)*k;return [Math.min(1,color.x*s2),Math.min(1,color.y*s2),Math.min(1,color.z*s2),color.w];};
    const quad=(a:vec3,b2:vec3,c:vec3,d:vec3,n:vec3,k=1)=>{
      const cc=col(n,k);
      for(const p of [a,b2,c,d])b.appendVerticesInterleaved([p.x,p.y,p.z,n.x,n.y,n.z,...cc]);
      ix.push(vi,vi+1,vi+2,vi,vi+2,vi+3);vi+=4;
    };
    const at=(a:number,r:number,z:number)=>new vec3(Math.sin(a)*r,Math.cos(a)*r,z);
    // Rim profile: each tooth is a flat top then a groove (four points per tooth).
    const prof:{a:number;r:number}[]=[];
    for(let t=0;t<teeth;t++){
      const a0=t*2*Math.PI/teeth,step=2*Math.PI/teeth;
      prof.push({a:a0,r:outer-depth},{a:a0+step*0.18,r:outer},{a:a0+step*0.62,r:outer},{a:a0+step*0.8,r:outer-depth});
    }
    const fn=vec3.forward();
    for(let i2=0;i2<prof.length;i2++){
      const p0=prof[i2],p1=prof[(i2+1)%prof.length];
      // Front face: from the hole out to the toothed rim.
      quad(at(p0.a,inner,front),at(p0.a,p0.r,front),at(p1.a,p1.r,front),at(p1.a,inner,front),fn,0.92);
      // Rim wall between the two profile points, facing outward.
      const e0=at(p0.a,p0.r,0),e1=at(p1.a,p1.r,0),edge=e1.sub(e0);
      let n=edge.cross(fn).normalize();
      if(n.dot(e0.add(e1))<0)n=n.uniformScale(-1);
      quad(at(p0.a,p0.r,front),at(p0.a,p0.r,back),at(p1.a,p1.r,back),at(p1.a,p1.r,front),n);
      // Inner wall of the hole.
      const mid=(p0.a+p1.a)/2,ni=new vec3(-Math.sin(mid),-Math.cos(mid),0);
      quad(at(p0.a,inner,back),at(p0.a,inner,front),at(p1.a,inner,front),at(p1.a,inner,back),ni,0.8);
    }
    // Both windings: the puck shows from any angle.
    const n0=ix.length;for(let i2=0;i2<n0;i2+=3)ix.push(ix[i2],ix[i2+2],ix[i2+1]);
    b.appendIndices(ix);
    const mesh=b.getMesh();b.updateMesh();
    RING_MESHES.set(key,mesh);
    this.ringVisual.mesh=mesh;
  }
  private buildFill():void {
    // A small fixed forward offset, not tubeRadius-scaled: the previous -tubeRadius*0.4 (meant to sit
    // the fill just inside the ring) put it at a bigger radius behind the panel's own opaque background
    // plate (ControlsContent's +0.5 minus this dial's own more-negative offset nets negative overall) —
    // invisible under real depth-tested rendering (an isolated/ortho capture doesn't show this at all).
    // A small positive offset keeps it comfortably in front of the panel regardless of dial size.
    const host=this.obj(this.root,"Fill",new vec3(0,0,0.1));
    this.fillVisual=host.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    this.fillVisual.mainMaterial=this.material;
  }
  private refreshFill():void {
    if(!this.fillVisual||!this.config.fillColorForValue)return;
    const color=this.config.fillColorForValue(this.config.steps[this.index].value);
    this.rebuildFillMesh(color);
  }
  /** Flat filled circle sitting inside the ring's hole, facing the same way as the ring — a plain
   * triangle fan in the local right/up plane, so it needs no corrective rotation either. */
  private rebuildFillMesh(color:vec4):void {
    if(!this.fillVisual)return;
    const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
    b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;
    const c=this.colorArr(color);
    const segs=24,r=this.ringRadius-this.tubeRadius*0.6;
    b.appendVerticesInterleaved([0,0,0, 0,0,1, ...c]);
    for(let i=0;i<=segs;i++){
      const a=i*2*Math.PI/segs;
      b.appendVerticesInterleaved([r*Math.cos(a),r*Math.sin(a),0, 0,0,1, ...c]);
    }
    const indices:number[]=[];
    // (center, i, i+1): consecutive CCW-ordered rim points with center first winds CCW as seen by a
    // +Z-side viewer (this dial's established "front"), matching the ring's own front-facing winding.
    for(let i=1;i<=segs;i++)indices.push(0,i,i+1);
    b.appendIndices(indices);
    this.fillVisual.mesh=b.getMesh();b.updateMesh();
  }
  private updateValueText():void {
    this.valueText.text=this.config.steps[this.index].text;
  }
  private colorArr(c:vec4):[number,number,number,number] {return [c.x,c.y,c.z,c.w];}
  private obj(parent:SceneObject,name:string,pos:vec3):SceneObject {
    const so=global.scene.createSceneObject(name);so.setParent(parent);so.getTransform().setLocalPosition(pos);return so;
  }
  private text(parent:SceneObject,value:string,pos:vec3,w:number,h:number,color:vec4,size:number):Text {
    const so=this.obj(parent,"Text",pos);
    const t=so.createComponent("Component.Text") as Text;
    t.text=value;t.depthTest=true;t.font=this.theme.font;t.size=size;t.textFill.color=color;
    t.horizontalAlignment=HorizontalAlignment.Center;t.verticalAlignment=VerticalAlignment.Center;
    t.horizontalOverflow=HorizontalOverflow.Overflow;t.verticalOverflow=VerticalOverflow.Overflow;
    t.layoutRect=Rect.create(-w/2,w/2,-h/2,h/2);
    return t;
  }
}
