import animate from "SpectaclesInteractionKit.lspkg/Utils/animate";
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import {IMAGE_MATERIAL_ASSET} from "SpectaclesUIKit.lspkg/Scripts/Utility/Assets";
import {addHoverFeedback} from "./ScoutHover";
import {addBox,buildLathe} from "./ScoutMarkerMesh";

export type ShootType="photo"|"video";
/** Optional generated gear models, each placed in its own slot on the bench top. */
export type WorkbenchGear={bench?:ObjectPrefab;cinemaCamera?:ObjectPrefab;gimbal?:ObjectPrefab;lens?:ObjectPrefab;clapperboard?:ObjectPrefab;filmReel?:ObjectPrefab;photoCamera?:ObjectPrefab};

const LOGO=requireAsset("../Logo/shotscout_wordmark.png") as Texture;
const MASCOT=requireAsset("../Logo/shotscout_mascot.png") as Texture;
const MASCOT_ASPECT=550/720,LOGO_ASPECT=25.4/12;
const PHOTO_ICON=requireAsset("../Icons/photo_camera.png") as Texture;
const VIDEO_ICON=requireAsset("../Icons/videocam.png") as Texture;
const GLOW=requireAsset("../Icons/hover_glow.png") as Texture;
const BODY_FONT=requireAsset("../Fonts/Inter.ttf") as Font;
const TECH_FONT=requireAsset("../Fonts/Orbitron.ttf") as Font;
const HEADER_TINT=new vec4(0xc1/255,0xad/255,0xff/255,1);

const BENCH_DISTANCE=140; // cm in front of the user
// Stand-in bench (until a generated workbench model is wired in): top surface height and footprint.
const BENCH_TOP=85,BENCH_W=150,BENCH_D=64;
// Gear slots on the bench top, in bench space (+Z toward the user). Kept clear of the console, which
// takes the front-centre of the top.
const GEAR_SLOTS:{key:keyof WorkbenchGear;x:number;z:number;yaw:number}[]=[
  {key:"cinemaCamera",x:-50,z:-12,yaw:30},
  {key:"gimbal",x:-22,z:-18,yaw:-10},
  {key:"clapperboard",x:8,z:-22,yaw:-8},
  {key:"photoCamera",x:34,z:-12,yaw:-25},
  {key:"lens",x:56,z:8,yaw:0},
  {key:"filmReel",x:-56,z:16,yaw:15},
];
// Console: a chunky base with an operator panel tilted up toward the user.
const CONSOLE_W=64,CONSOLE_H=8,CONSOLE_D=26,CONSOLE_Z=14,PANEL_TILT=30;
const BUTTON_X=16,CAP_RADIUS=6.5,BEZEL_RADIUS=8.8,PRESS_DEPTH=1.8;
const HOUSING:[number,number,number,number]=[0.13,0.12,0.16,1];
const PANEL:[number,number,number,number]=[0.2,0.18,0.25,1];
const BEZEL:[number,number,number,number]=[0.62,0.62,0.68,1];
const TRIM:[number,number,number,number]=[0.42,0.32,0.82,1];
// Retro-futuristic pair: amber for photo, cyan for video.
const PHOTO_COLOR=new vec4(1,0.62,0.18,1);
const VIDEO_COLOR=new vec4(0.3,0.9,1,1);
const GLOW_IDLE=0.3,GLOW_HOVER=0.95;
const HIDE_SECONDS=0.35;

/** First-run "What are you planning?" bench: camera gear on a workbench and two physical buttons —
 * Photo Shoot / Video Shoot. Plain class driven by ScoutMain. */
export class ScoutWorkbench {
  private root:SceneObject=null;
  private chosen=false;
  get active():boolean {return !!this.root&&!isNull(this.root)&&this.root.enabled&&!this.chosen;}

  constructor(private material:Material,private camera:Camera,private gear:WorkbenchGear,private onChoose:(type:ShootType)=>void){}

  /** Stands the bench on the floor in front of the user, facing them. */
  show(floorY:number):void {
    if(this.root&&!isNull(this.root))this.root.destroy();
    this.chosen=false;
    const cam=this.camera.getTransform(),p=cam.getWorldPosition();
    const look=cam.forward.uniformScale(-1);
    const f=new vec3(look.x,0,look.z).normalize();
    this.root=global.scene.createSceneObject("Workbench");
    const t=this.root.getTransform();
    t.setWorldPosition(new vec3(p.x+f.x*BENCH_DISTANCE,floorY,p.z+f.z*BENCH_DISTANCE));
    // Local +Z toward the user.
    t.setWorldRotation(quat.angleAxis(Math.atan2(-f.x,-f.z),vec3.up()));
    const top=this.buildBench();
    this.buildGear(top);
    this.buildHeader(top);
    const panel=this.buildConsole(top);
    this.buildButton(panel,-BUTTON_X,"PHOTO SHOOT",PHOTO_ICON,PHOTO_COLOR,"photo");
    this.buildButton(panel,BUTTON_X,"VIDEO SHOOT",VIDEO_ICON,VIDEO_COLOR,"video");
  }

  /** The generated bench if there is one (its top measured from the mesh), else a plain stand-in. */
  private buildBench():number {
    if(this.gear.bench){
      const model=this.gear.bench.instantiate(this.root);
      model.getTransform().setLocalRotation(quat.angleAxis(Math.PI,vec3.up()));
      const visual=findVisual(model);
      if(visual)return visual.worldAabbMax().y-this.root.getTransform().getWorldPosition().y;
    }
    const b=this.builder(),ix:number[]=[];
    let v=addBox(b,ix,0,BENCH_TOP-2,0,BENCH_W/2,2,BENCH_D/2,[0.45,0.32,0.22,1],0);
    for(const sx of [-1,1])for(const sz of [-1,1]){
      v=addBox(b,ix,sx*(BENCH_W/2-5),(BENCH_TOP-4)/2,sz*(BENCH_D/2-5),2,(BENCH_TOP-4)/2,2,[0.18,0.18,0.2,1],v);
    }
    b.appendIndices(ix);
    this.visual(this.child(this.root,"Bench"),b);
    return BENCH_TOP;
  }
  private buildGear(top:number):void {
    for(const slot of GEAR_SLOTS){
      const prefab=this.gear[slot.key];
      if(!prefab)continue;
      const model=prefab.instantiate(this.root);
      const mt=model.getTransform();
      mt.setLocalPosition(new vec3(slot.x,top,slot.z));
      // Generated meshes are baked facing -Z; turn them to face the user, plus a casual angle.
      mt.setLocalRotation(quat.angleAxis(Math.PI+slot.yaw*Math.PI/180,vec3.up()));
    }
  }
  /** Mascot + wordmark (same art as the menu header) over "What are you planning?". */
  private buildHeader(top:number):void {
    const header=this.child(this.root,"Header");
    header.getTransform().setLocalPosition(new vec3(0,top+62,-20));
    const h=18;
    this.image(header,MASCOT,new vec3(-(h*LOGO_ASPECT)/2-2,0,0),h*MASCOT_ASPECT,h,null);
    this.image(header,LOGO,new vec3(h*MASCOT_ASPECT/2+2,0,0),h*LOGO_ASPECT,h,null);
    this.text(header,"What are you planning?",new vec3(0,-20,0),BODY_FONT,220,HEADER_TINT);
  }
  /** Returns the tilted panel the buttons mount on (its local +Y is the panel's face). */
  private buildConsole(top:number):SceneObject {
    const base=this.child(this.root,"Console");
    base.getTransform().setLocalPosition(new vec3(0,top,CONSOLE_Z));
    const b=this.builder(),ix:number[]=[];
    let v=addBox(b,ix,0,CONSOLE_H/2,0,CONSOLE_W/2,CONSOLE_H/2,CONSOLE_D/2,HOUSING,0);
    // Accent trim strip along the front edge — the bit of colour that makes it read as a device.
    v=addBox(b,ix,0,CONSOLE_H*0.55,CONSOLE_D/2+0.2,CONSOLE_W/2-2,0.6,0.3,TRIM,v);
    b.appendIndices(ix);
    this.visual(base,b);
    // The operator panel hinges at the base's front-top edge and rises toward the back, so its face (+Y)
    // tilts toward the user (+Z); a solid wedge fills the space under it.
    const tilt=PANEL_TILT*Math.PI/180,run=CONSOLE_D*Math.cos(tilt),rise=CONSOLE_D*Math.sin(tilt);
    const wedge=this.builder();
    this.wedge(wedge,CONSOLE_W/2,CONSOLE_D/2,CONSOLE_D/2-run,rise,HOUSING);
    const wedgeHost=this.child(base,"Wedge");
    wedgeHost.getTransform().setLocalPosition(new vec3(0,CONSOLE_H,0));
    this.visual(wedgeHost,wedge);
    const panel=this.child(base,"Panel");
    panel.getTransform().setLocalPosition(new vec3(0,CONSOLE_H,CONSOLE_D/2));
    panel.getTransform().setLocalRotation(quat.angleAxis(tilt,vec3.right()));
    const pb=this.builder(),pix:number[]=[];
    addBox(pb,pix,0,0.5,-CONSOLE_D/2,CONSOLE_W/2,0.5,CONSOLE_D/2,PANEL,0);
    pb.appendIndices(pix);
    this.visual(panel,pb);
    return panel;
  }
  /** A chunky arcade-style push button: metal bezel, glowing halo, coloured cap with an icon, and an
   * engraved-style label. Hover grows the cap and brightens the halo; pressing sinks the cap. */
  private buildButton(panel:SceneObject,x:number,label:string,icon:Texture,color:vec4,type:ShootType):void {
    const host=this.child(panel,label);
    // Buttons toward the back of the panel, labels between them and the front edge.
    host.getTransform().setLocalPosition(new vec3(x,1,-CONSOLE_D/2-3));
    const bezelB=this.builder();
    buildLathe(bezelB,[[0,0],[BEZEL_RADIUS,0],[BEZEL_RADIUS,1.2],[CAP_RADIUS+0.4,1.6],[0,1.6]],32,BEZEL);
    this.visual(this.child(host,"Bezel"),bezelB);
    const halo=this.image(host,GLOW,new vec3(0,0.3,0),BEZEL_RADIUS*3.4,BEZEL_RADIUS*3.4,new vec4(color.x,color.y,color.z,GLOW_IDLE));
    halo.getSceneObject().getTransform().setLocalRotation(quat.angleAxis(-Math.PI/2,vec3.right()));
    const cap=this.child(host,"Cap");
    const capT=cap.getTransform();
    const capB=this.builder();
    const c:[number,number,number,number]=[color.x,color.y,color.z,1];
    buildLathe(capB,[[0,1.6],[CAP_RADIUS,1.6],[CAP_RADIUS,4.2],[CAP_RADIUS*0.85,5.2],[0,5.5]],32,c);
    this.visual(cap,capB);
    const iconImg=this.image(cap,icon,new vec3(0,5.6,0),CAP_RADIUS*1.1,CAP_RADIUS*1.1,new vec4(0.08,0.06,0.12,1));
    iconImg.getSceneObject().getTransform().setLocalRotation(quat.angleAxis(-Math.PI/2,vec3.right()));
    const labelText=this.text(host,label,new vec3(0,0.4,BEZEL_RADIUS+4.5),TECH_FONT,90,new vec4(color.x,color.y,color.z,1));
    labelText.getSceneObject().getTransform().setLocalRotation(quat.angleAxis(-Math.PI/2,vec3.right()));
    const collider=cap.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const shape=Shape.createBoxShape();shape.size=new vec3(BEZEL_RADIUS*2,8,BEZEL_RADIUS*2);collider.shape=shape;
    const input=cap.createComponent(Interactable.getTypeName()) as Interactable;
    input.targetingMode=3;
    addHoverFeedback(input,cap,amount=>{
      halo.mainPass.baseColor=new vec4(color.x,color.y,color.z,GLOW_IDLE+(GLOW_HOVER-GLOW_IDLE)*amount);
    });
    const press=(down:boolean)=>{
      const from=capT.getLocalPosition().y,to=down?-PRESS_DEPTH:0;
      animate({duration:0.08,easing:"ease-out-quad",update:k=>{
        if(isNull(cap))return;
        const p=capT.getLocalPosition();capT.setLocalPosition(new vec3(p.x,from+(to-from)*k,p.z));
      }});
    };
    input.onTriggerStart.add(()=>{if(!this.chosen)press(true);});
    input.onTriggerEnd.add(()=>{
      press(false);
      if(this.chosen)return;
      this.chosen=true;
      this.onChoose(type);
      this.hide();
    });
    input.onTriggerCanceled.add(()=>press(false));
  }
  /** Shrinks the whole bench away, then removes it. */
  private hide():void {
    const root=this.root,t=root.getTransform(),from=t.getLocalScale();
    animate({duration:HIDE_SECONDS,easing:"ease-in-quad",ended:()=>{if(!isNull(root))root.destroy();},update:k=>{
      if(isNull(root))return;
      t.setLocalScale(from.uniformScale(Math.max(0.001,1-k)));
    }});
  }
  /** Right-triangle prism under the tilted panel: front-bottom edge at z=front, rising to `rise` at z=back. */
  private wedge(b:MeshBuilder,halfW:number,front:number,back:number,rise:number,color:[number,number,number,number]):void {
    const p=(x:number,y:number,z:number)=>[x,y,z];
    const L=-halfW,R=halfW;
    const quads=[
      [p(L,0,back),p(R,0,back),p(R,rise,back),p(L,rise,back)], // back wall
      [p(L,0,front),p(L,0,back),p(L,rise,back),p(L,0,front)],  // left side (triangle)
      [p(R,0,front),p(R,rise,back),p(R,0,back),p(R,0,front)],  // right side (triangle)
      [p(L,0,front),p(R,0,front),p(R,rise,back),p(L,rise,back)], // top slope
    ];
    let vi=0;const ix:number[]=[];
    for(const q of quads){
      q.forEach(v=>b.appendVerticesInterleaved([v[0],v[1],v[2],0,1,0,...color]));
      // Both windings, so every face shows whichever way it was wound.
      ix.push(vi,vi+1,vi+2,vi,vi+2,vi+3,vi,vi+2,vi+1,vi,vi+3,vi+2);
      vi+=4;
    }
    b.appendIndices(ix);
  }
  private child(parent:SceneObject,name:string):SceneObject {
    const so=global.scene.createSceneObject(name);so.setParent(parent);return so;
  }
  private builder():MeshBuilder {
    const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
    b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;return b;
  }
  private visual(so:SceneObject,b:MeshBuilder):RenderMeshVisual {
    const v=so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    v.mesh=b.getMesh();v.mainMaterial=this.material;b.updateMesh();return v;
  }
  private image(parent:SceneObject,tex:Texture,pos:vec3,w:number,h:number,tint:vec4):Image {
    const so=this.child(parent,"Image");
    so.getTransform().setLocalPosition(pos);so.getTransform().setLocalScale(new vec3(w,h,1));
    const img=so.createComponent("Component.Image") as Image;
    img.mainMaterial=IMAGE_MATERIAL_ASSET.clone();img.mainPass.baseTex=tex;
    if(tint)img.mainPass.baseColor=tint;
    return img;
  }
  private text(parent:SceneObject,value:string,pos:vec3,font:Font,size:number,color:vec4):Text {
    const so=this.child(parent,"Text");so.getTransform().setLocalPosition(pos);
    const t=so.createComponent("Component.Text") as Text;
    t.text=value;t.font=font;t.size=size;t.textFill.color=color;t.depthTest=true;
    t.horizontalAlignment=HorizontalAlignment.Center;t.verticalAlignment=VerticalAlignment.Center;
    t.horizontalOverflow=HorizontalOverflow.Overflow;t.verticalOverflow=VerticalOverflow.Overflow;
    return t;
  }
}
function findVisual(root:SceneObject):RenderMeshVisual {
  const v=root.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
  if(v)return v;
  for(let i=0;i<root.getChildrenCount();i++){const f=findVisual(root.getChild(i));if(f)return f;}
  return null;
}
