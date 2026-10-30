import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import {Interactor} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import {addBox} from "./ScoutMarkerMesh";

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
export class ScoutRotaryDial {
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
  }
  private buildRing():void {
    const host=this.obj(this.root,"DialKnob",vec3.zero());
    this.ringVisual=host.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    this.ringVisual.mainMaterial=this.material.clone();
    this.rebuildRingMesh(this.theme.idleColor);
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
      this.index=idx;this.updateValueText();this.refreshFill();
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
  private buildTicks():void {
    this.config.steps.forEach((_,i)=>{
      const host=this.obj(this.root,"Tick",vec3.zero());
      host.getTransform().setLocalRotation(quat.angleAxis(-this.angleForIndex(i),vec3.forward()));
      const tick=this.obj(host,"TickMark",new vec3(0,this.ringRadius+this.tubeRadius+0.55,0.05));
      const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
      b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;
      const ix:number[]=[];
      addBox(b,ix,0,0,0,0.05,0.22,0.03,this.colorArr(this.theme.tickColor),0);
      b.appendIndices(ix);
      const visual=tick.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
      visual.mesh=b.getMesh();visual.mainMaterial=this.material.clone();b.updateMesh();
    });
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
    const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
    b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;
    const u=vec3.right(),v=vec3.up(),axis=vec3.forward();
    const ringSeg=32,tubeSeg=8;
    const lx=-0.45,ly=0.55,lz=0.7;const llen=Math.sqrt(lx*lx+ly*ly+lz*lz);
    const nlx=lx/llen,nly=ly/llen,nlz=lz/llen;
    type PN={p:vec3;n:vec3};
    const point=(a:number,t:number):PN=>{
      const radial=u.uniformScale(Math.cos(a)).add(v.uniformScale(Math.sin(a)));
      const n=radial.uniformScale(Math.cos(t)).add(axis.uniformScale(Math.sin(t)));
      const p=radial.uniformScale(this.ringRadius).add(n.uniformScale(this.tubeRadius));
      return {p,n};
    };
    const shade=(n:vec3):number=>{
      const diffuse=Math.max(0,n.x*nlx+n.y*nly+n.z*nlz);
      return Math.min(1.3,0.5+diffuse*0.6+Math.pow(diffuse,20)*1.1);
    };
    let vi=0;const indices:number[]=[];
    const addTri=(a:PN,b2:PN,c2:PN)=>{
      const fn=a.n.add(b2.n).add(c2.n).normalize();
      const s=shade(fn);
      const col=[Math.min(1,color.x*s),Math.min(1,color.y*s),Math.min(1,color.z*s),color.w];
      [a,b2,c2].forEach(({p,n})=>b.appendVerticesInterleaved([p.x,p.y,p.z,n.x,n.y,n.z,...col]));
      indices.push(vi,vi+1,vi+2);vi+=3;
    };
    for(let j=0;j<ringSeg;j++)for(let k=0;k<tubeSeg;k++){
      const a0=j*2*Math.PI/ringSeg,a1=(j+1)*2*Math.PI/ringSeg,t0=k*2*Math.PI/tubeSeg,t1=(k+1)*2*Math.PI/tubeSeg;
      const p00=point(a0,t0),p10=point(a1,t0),p01=point(a0,t1),p11=point(a1,t1);
      addTri(p00,p10,p01);addTri(p01,p10,p11);
    }
    b.appendIndices(indices);
    this.ringVisual.mesh=b.getMesh();b.updateMesh();
  }
  private buildFill():void {
    // A small fixed forward offset, not tubeRadius-scaled: the previous -tubeRadius*0.4 (meant to sit
    // the fill just inside the ring) put it at a bigger radius behind the panel's own opaque background
    // plate (ControlsContent's +0.5 minus this dial's own more-negative offset nets negative overall) —
    // invisible under real depth-tested rendering (an isolated/ortho capture doesn't show this at all).
    // A small positive offset keeps it comfortably in front of the panel regardless of dial size.
    const host=this.obj(this.root,"Fill",new vec3(0,0,0.1));
    this.fillVisual=host.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    this.fillVisual.mainMaterial=this.material.clone();
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
