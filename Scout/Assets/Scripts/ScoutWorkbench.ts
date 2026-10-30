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
const HEADER_TINT=new vec4(0xc1/255,0xad/255,0xff/255,1);
const QUESTION="What are you planning?",WELCOME="Welcome to ShotScout";

// The bench stands where the user confirmed the floor, but never so close that its ~1.8m width spills
// out of Specs' field of view (nor across the room): cm from the user. Without a confirmed spot (setup
// skipped) it goes straight ahead at the minimum.
const BENCH_MIN_DISTANCE=220,BENCH_MAX_DISTANCE=350;
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
// Console: a chunky base with an operator panel tilted up toward the user. Wide and deep enough to hold
// the first-run intro pages at a readable size before the Photo/Video buttons take their place.
const CONSOLE_W=92,CONSOLE_H=8,CONSOLE_D=34,CONSOLE_Z=14,PANEL_TILT=30;
const BUTTON_X=22,CAP_RADIUS=6.5,BEZEL_RADIUS=8.8,PRESS_DEPTH=1.8;
// Keys sit toward the back of the panel (panel space: z runs from 0 at the front edge to -CONSOLE_D).
const KEY_Z=-CONSOLE_D/2-3;
// Intro pages on the panel face: text block on the left, the Next key on the right. Sizes are for
// reading from where the user stands (~1.5m away), so they're large.
const INTRO_TEXT_X=-13,INTRO_TEXT_W=60,NEXT_KEY_X=31;
const INTRO_TITLE=190,INTRO_BODY=140;
const NEXT_COLOR=new vec4(0x8a/255,0x6c/255,0xf0/255,1);
const NEXT_ICON=requireAsset("../Icons/arrow_forward.png") as Texture;
const DOT_IDLE=new vec4(0.4,0.4,0.43,1);
const WHITE=requireAsset("../Textures/white.png") as Texture;
const POP_SECONDS=0.25;
// Info key beside the console: cap radius, gap from the console's side, and its "i" size.
const INFO_RADIUS=3.2,INFO_GAP=3,INFO_GLYPH=150;

export type BenchIntro={cards:{title:string;body:string}[];onDone:()=>void};
// Styled as film-set kit to sit with the bench model: a matte-black road case (like the bench frame and
// gear) with brushed-aluminium corner guards and trim (like its drawer pulls), on a gunmetal panel.
const HOUSING:[number,number,number,number]=[0.1,0.1,0.11,1];
const PANEL:[number,number,number,number]=[0.22,0.22,0.23,1];
const BEZEL:[number,number,number,number]=[0.72,0.72,0.74,1];
const TRIM:[number,number,number,number]=[0.62,0.62,0.65,1];
const GUARD=1.4; // corner-guard half-thickness (cm)
const LABEL_PLATE:[number,number,number,number]=[0.06,0.06,0.07,1];
const LABEL_INK=new vec4(0.93,0.88,0.78,1); // chalk cream, like the slate's lettering
// Film-set pair: tungsten amber for photo, record red for video.
const PHOTO_COLOR=new vec4(1,0.66,0.25,1);
const VIDEO_COLOR=new vec4(0.92,0.2,0.16,1);
const GLOW_IDLE=0.2,GLOW_HOVER=0.8;
const HIDE_SECONDS=0.35;

/** First-run "What are you planning?" bench: camera gear on a workbench and two physical buttons —
 * Photo Shoot / Video Shoot. Plain class driven by ScoutMain. */
export class ScoutWorkbench {
  private root:SceneObject=null;
  private chosen=false;
  get active():boolean {return !!this.root&&!isNull(this.root)&&this.root.enabled&&!this.chosen;}

  constructor(private material:Material,private camera:Camera,private gear:WorkbenchGear,private onChoose:(type:ShootType)=>void){}

  /** Stands the bench on the floor in front of the user, facing them. With `startWithIntro`, the console
   * first pages through the intro cards and the Photo/Video buttons appear after the last one; either
   * way a small info key beside the console replays the intro. `spot` is where the user confirmed the
   * floor; the bench stands there (within BENCH_MIN/MAX_DISTANCE of the user), facing them. */
  show(floorY:number,intro:BenchIntro,startWithIntro:boolean,spot:vec3=null):void {
    if(this.root&&!isNull(this.root))this.root.destroy();
    this.chosen=false;
    const cam=this.camera.getTransform(),p=cam.getWorldPosition();
    const look=cam.forward.uniformScale(-1);
    let f=new vec3(look.x,0,look.z).normalize(),dist=BENCH_MIN_DISTANCE;
    const toSpot=spot?new vec3(spot.x-p.x,0,spot.z-p.z):null;
    if(toSpot&&toSpot.length>1){
      f=toSpot.normalize();
      dist=Math.min(BENCH_MAX_DISTANCE,Math.max(BENCH_MIN_DISTANCE,toSpot.length));
    }
    this.root=global.scene.createSceneObject("Workbench");
    const t=this.root.getTransform();
    t.setWorldPosition(new vec3(p.x+f.x*dist,floorY,p.z+f.z*dist));
    // Local +Z toward the user.
    t.setWorldRotation(quat.angleAxis(Math.atan2(-f.x,-f.z),vec3.up()));
    const top=this.buildBench();
    this.buildGear(top);
    this.buildHeader(top,startWithIntro?WELCOME:QUESTION);
    const panel=this.buildConsole(top);
    this.info=this.buildInfoKey(top,()=>this.replayIntro(panel,intro));
    if(startWithIntro)this.startIntro(panel,intro);
    else this.buildChoice(panel,false);
  }
  private header:Text=null;
  private choice:SceneObject[]=[];
  private info:SceneObject=null;

  /** The two shoot-type buttons; `pop` grows them in (after the intro) instead of just appearing. */
  private buildChoice(panel:SceneObject,pop:boolean):void {
    const choose=(type:ShootType)=>()=>{this.chosen=true;this.onChoose(type);this.hide();};
    this.choice=[
      this.buildKey(panel,-BUTTON_X,"PHOTO SHOOT",PHOTO_ICON,PHOTO_COLOR,choose("photo")),
      this.buildKey(panel,BUTTON_X,"VIDEO SHOOT",VIDEO_ICON,VIDEO_COLOR,choose("video")),
    ];
    if(pop)this.choice.forEach(k=>this.popIn(k));
  }
  /** Info key → the intro again, in place of the Photo/Video buttons (which come back after Start). */
  private replayIntro(panel:SceneObject,intro:BenchIntro):void {
    this.choice.forEach(k=>{if(!isNull(k))k.destroy();});
    this.choice=[];
    if(this.header&&!isNull(this.header))this.header.text=WELCOME;
    this.startIntro(panel,intro);
  }
  private startIntro(panel:SceneObject,intro:BenchIntro):void {
    if(this.info&&!isNull(this.info))this.info.enabled=false;
    this.buildIntro(panel,intro,0);
  }
  /** One intro page flat on the panel face: title and body on the left, page dots under them, and a
   * Next key on the right (Start on the last page, which swaps in the shoot-type buttons). */
  private buildIntro(panel:SceneObject,intro:BenchIntro,page:number):void {
    const host=this.child(panel,"Intro");
    const card=intro.cards[page],last=page===intro.cards.length-1;
    this.flatText(host,card.title,new vec3(INTRO_TEXT_X,1.2,-CONSOLE_D+7),INTRO_TEXT_W,9,INTRO_TITLE,HEADER_TINT);
    this.flatText(host,card.body,new vec3(INTRO_TEXT_X,1.2,-CONSOLE_D/2+1),INTRO_TEXT_W,12,INTRO_BODY,LABEL_INK);
    intro.cards.forEach((_c,i)=>{
      const dot=this.image(host,WHITE,new vec3(INTRO_TEXT_X+(i-(intro.cards.length-1)/2)*4.5,1.2,-4),2,2,i===page?HEADER_TINT:DOT_IDLE);
      dot.getSceneObject().getTransform().setLocalRotation(quat.angleAxis(-Math.PI/2,vec3.right()));
    });
    let pressed=false;
    const key=this.buildKey(host,NEXT_KEY_X,last?"START":"NEXT",NEXT_ICON,NEXT_COLOR,()=>{
      if(pressed)return;
      pressed=true;
      // Swap pages a beat later: the key's own release animation finishes first, and it isn't destroyed
      // from inside its own interaction callback.
      animate({duration:0.12,update:()=>{},ended:()=>{
        if(isNull(host)||isNull(panel))return;
        // Disabled now (so SIK's cursor lets go of the key it's on), destroyed a beat later — destroying
        // the hovered key outright leaves the cursor pointing at a dead object for a few frames.
        host.enabled=false;
        animate({duration:0.1,update:()=>{},ended:()=>{if(!isNull(host))host.destroy();}});
        if(last){
          intro.onDone();
          if(this.header&&!isNull(this.header))this.header.text=QUESTION;
          this.buildChoice(panel,true);
          if(this.info&&!isNull(this.info)){this.info.enabled=true;this.popIn(this.info);}
        }else this.buildIntro(panel,intro,page+1);
      }});
    });
    if(page>0)this.popIn(key);
  }
  /** A small round purple "i" key on the bench top just right of the console, for anyone curious to
   * read the intro again. Same press/hover feel as the console keys, a quarter of the size. */
  private buildInfoKey(top:number,onPress:()=>void):SceneObject {
    const host=this.child(this.root,"Info key");
    host.getTransform().setLocalPosition(new vec3(CONSOLE_W/2+INFO_GAP+INFO_RADIUS,top,CONSOLE_Z+CONSOLE_D/2-INFO_RADIUS-2));
    const bezelB=this.builder();
    buildLathe(bezelB,[[0,0],[INFO_RADIUS+1,0],[INFO_RADIUS+1,0.8],[INFO_RADIUS+0.2,1.1],[0,1.1]],24,BEZEL);
    this.visual(this.child(host,"Bezel"),bezelB);
    const cap=this.child(host,"Cap");
    const capT=cap.getTransform();
    const capB=this.builder();
    const c:[number,number,number,number]=[NEXT_COLOR.x,NEXT_COLOR.y,NEXT_COLOR.z,1];
    buildLathe(capB,[[0,1.1],[INFO_RADIUS,1.1],[INFO_RADIUS,2.6],[INFO_RADIUS*0.85,3.2],[0,3.4]],24,c);
    this.visual(cap,capB);
    // A bold "i", lying on the cap facing up and reading toward the user.
    const glyph=this.text(cap,"i",new vec3(0,3.5,0),BODY_FONT,INFO_GLYPH,LABEL_INK);
    glyph.getSceneObject().getTransform().setLocalRotation(quat.angleAxis(-Math.PI/2,vec3.right()));
    const collider=cap.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const shape=Shape.createBoxShape();shape.size=new vec3(INFO_RADIUS*2+2,6,INFO_RADIUS*2+2);collider.shape=shape;
    const input=cap.createComponent(Interactable.getTypeName()) as Interactable;
    input.targetingMode=3;
    addHoverFeedback(input,cap);
    const press=(down:boolean)=>{
      const from=capT.getLocalPosition().y,to=down?-1:0;
      animate({duration:0.08,easing:"ease-out-quad",update:k=>{
        if(isNull(cap))return;
        const p=capT.getLocalPosition();capT.setLocalPosition(new vec3(p.x,from+(to-from)*k,p.z));
      }});
    };
    input.onTriggerStart.add(()=>{if(!this.chosen)press(true);});
    input.onTriggerEnd.add(()=>{press(false);if(!this.chosen&&host.enabled)onPress();});
    input.onTriggerCanceled.add(()=>press(false));
    return host;
  }
  /** Grows a freshly built key in from nothing. */
  private popIn(so:SceneObject):void {
    const t=so.getTransform();
    t.setLocalScale(vec3.one().uniformScale(0.001));
    animate({duration:POP_SECONDS,easing:"ease-out-back",update:k=>{
      if(isNull(so))return;
      t.setLocalScale(vec3.one().uniformScale(Math.max(0.001,k)));
    }});
  }

  /** The generated bench if there is one, else a plain stand-in. The generated bench carries its gear
   * baked in, so its mesh top isn't the table top: it's authored with the table top at BENCH_TOP. */
  private buildBench():number {
    if(this.gear.bench){
      const model=this.gear.bench.instantiate(this.root);
      model.getTransform().setLocalRotation(quat.angleAxis(Math.PI,vec3.up()));
      return BENCH_TOP;
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
  /** Mascot + wordmark (same art as the menu header) over a line of text: a welcome during the intro,
   * then "What are you planning?". */
  private buildHeader(top:number,line:string):void {
    const header=this.child(this.root,"Header");
    header.getTransform().setLocalPosition(new vec3(0,top+62,-20));
    const h=18;
    this.image(header,MASCOT,new vec3(-(h*LOGO_ASPECT)/2-2,0,0),h*MASCOT_ASPECT,h,null);
    this.image(header,LOGO,new vec3(h*MASCOT_ASPECT/2+2,0,0),h*LOGO_ASPECT,h,null);
    this.header=this.text(header,line,new vec3(0,-20,0),BODY_FONT,220,HEADER_TINT);
  }
  /** Returns the tilted panel the buttons mount on (its local +Y is the panel's face). */
  private buildConsole(top:number):SceneObject {
    const base=this.child(this.root,"Console");
    base.getTransform().setLocalPosition(new vec3(0,top,CONSOLE_Z));
    const b=this.builder(),ix:number[]=[];
    let v=addBox(b,ix,0,CONSOLE_H/2,0,CONSOLE_W/2,CONSOLE_H/2,CONSOLE_D/2,HOUSING,0);
    // Aluminium trim strip along the front edge and road-case guards on the four vertical corners.
    v=addBox(b,ix,0,CONSOLE_H*0.55,CONSOLE_D/2+0.2,CONSOLE_W/2-2,0.6,0.3,TRIM,v);
    for(const sx of [-1,1])for(const sz of [-1,1]){
      v=addBox(b,ix,sx*(CONSOLE_W/2-GUARD+0.3),CONSOLE_H/2,sz*(CONSOLE_D/2-GUARD+0.3),GUARD,CONSOLE_H/2+0.2,GUARD,TRIM,v);
    }
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
  /** A chunky industrial push button: aluminium bezel, soft halo, coloured cap with an icon, and a
   * label plate. Hover grows the cap and brightens the halo; pressing sinks the cap and, on release,
   * runs `onPress` (once a shoot type is chosen, no key does anything). Returns the key's root. */
  private buildKey(panel:SceneObject,x:number,label:string,icon:Texture,color:vec4,onPress:()=>void):SceneObject {
    const host=this.child(panel,label);
    // Keys toward the back of the panel, labels between them and the front edge.
    host.getTransform().setLocalPosition(new vec3(x,1,KEY_Z));
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
    // Cream lettering on a dark plate, like the labels on the gear.
    const plateB=this.builder(),plateIx:number[]=[];
    addBox(plateB,plateIx,0,0.2,BEZEL_RADIUS+5,BEZEL_RADIUS+4.5,0.15,3.4,LABEL_PLATE,0);
    plateB.appendIndices(plateIx);
    this.visual(this.child(host,"LabelPlate"),plateB);
    const labelText=this.text(host,label,new vec3(0,0.4,BEZEL_RADIUS+5),BODY_FONT,130,LABEL_INK);
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
      onPress();
    });
    input.onTriggerCanceled.add(()=>press(false));
    return host;
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
  /** Wrapped text lying flat on the panel face (reading "up" toward the back of the panel). */
  private flatText(parent:SceneObject,value:string,pos:vec3,w:number,h:number,size:number,color:vec4):Text {
    const t=this.text(parent,value,pos,BODY_FONT,size,color);
    t.horizontalOverflow=HorizontalOverflow.Wrap;
    t.layoutRect=Rect.create(-w/2,w/2,-h/2,h/2);
    t.getSceneObject().getTransform().setLocalRotation(quat.angleAxis(-Math.PI/2,vec3.right()));
    return t;
  }
}
