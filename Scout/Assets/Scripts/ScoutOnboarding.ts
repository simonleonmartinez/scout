import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate";
import {IMAGE_MATERIAL_ASSET} from "SpectaclesUIKit.lspkg/Scripts/Utility/Assets";
import {addBackPlateHover} from "./ScoutHover";

const FONT=requireAsset("../Fonts/Inter.ttf") as Font;
// Brand inks: lavender titles (as in the bench header), cream body text, on a dark gear-grey panel.
const TITLE_INK=new vec4(0xc1/255,0xad/255,0xff/255,1);
const BODY_INK=new vec4(0.93,0.88,0.78,1);
const PANEL_TINT=new vec4(0.1,0.1,0.11,1);
const BUTTON_TINT=new vec4(0x5a/255,0x44/255,0xb8/255,1);
const DOT_IDLE=new vec4(0.35,0.33,0.4,1);

// Text sizes are set for reading in glasses, not on a monitor: at these distances the cap height is
// roughly 2-4cm. Nothing here goes below BODY on the cards or TIP_BODY on the tips.
const INTRO_DISTANCE=110,INTRO_DROP=8,INTRO_W=84,INTRO_H=56;
const INTRO_TITLE=230,INTRO_BODY=140,INTRO_BUTTON=140;
const TIP_DISTANCE=70,TIP_DROP=20,TIP_W=66,TIP_H=22;
const TIP_TITLE=150,TIP_BODY=110;
const TIP_SECONDS=7,TIP_FOLLOW=3;
const INTRO_KEY="scout.intro.seen",TIPS_KEY="scout.tips.seen";

export type IntroCard={title:string;body:string};
export type Tip={title:string;body:string;icon?:Texture};

/** First-run intro: a few cards on what ShotScout is and when to use it, shown once after the floor is
 * found and before the shoot-type bench. Plain class driven by ScoutMain. */
export class ScoutIntro {
  private root:SceneObject=null;
  private page=0;
  private finished=false;
  private store=global.persistentStorageSystem.store;

  constructor(private camera:Camera,private cards:IntroCard[],private schedule:(seconds:number,fn:()=>void)=>void,private onDone:()=>void){}

  /** Still to be shown on this device. */
  get pending():boolean {return !this.finished&&!readFlag(this.store,INTRO_KEY);}
  get active():boolean {return !!this.root&&!isNull(this.root);}

  show():void {
    if(this.active)return;
    this.page=0;
    this.root=global.scene.createSceneObject("Intro");
    placeInView(this.root,this.camera,INTRO_DISTANCE,INTRO_DROP);
    this.render();
  }
  private render():void {
    for(let i=this.root.getChildrenCount()-1;i>=0;i--)this.root.getChild(i).destroy();
    const card=this.cards[this.page],last=this.page===this.cards.length-1;
    const host=child(this.root,"Card",vec3.zero());
    host.createComponent("Component.Canvas");
    panel(host,INTRO_W,INTRO_H,PANEL_TINT,4);
    text(host,card.title,new vec3(0,INTRO_H/2-12,0.5),INTRO_W-10,10,INTRO_TITLE,TITLE_INK);
    text(host,card.body,new vec3(0,2,0.5),INTRO_W-12,22,INTRO_BODY,BODY_INK);
    // Page dots, then the one action: Next, or Get started on the last card.
    const dotsY=-INTRO_H/2+19;
    this.cards.forEach((_c,i)=>{
      const dot=child(host,"Dot",new vec3((i-(this.cards.length-1)/2)*4,dotsY,0.5));
      rect(dot,1.6,1.6,i===this.page?TITLE_INK:DOT_IDLE);
    });
    button(host,last?"Get started":"Next",new vec3(0,-INTRO_H/2+9,0.5),30,9,INTRO_BUTTON,()=>{
      if(last)this.finish();else{this.page++;this.render();}
    });
    sweepColliders(host,this.schedule);
  }
  private finish():void {
    this.finished=true;
    writeFlag(this.store,INTRO_KEY);
    if(this.active)this.root.destroy();
    this.root=null;
    this.onDone();
  }
}

/** One-time tips: a short line under the user's view the first time each action becomes useful, so the
 * app teaches itself as it's used. Each tip shows once per device (nudge() re-shows one on demand),
 * one at a time, queued; it fades after TIP_SECONDS or as soon as the user does the thing. */
export class ScoutTips {
  private seen:string[];
  private queue:string[]=[];
  private current:{id:string;root:SceneObject;until:number}=null;
  private lastNudge:{[id:string]:number}={};
  private store=global.persistentStorageSystem.store;

  constructor(private camera:Camera,private tips:{[id:string]:Tip},private schedule:(seconds:number,fn:()=>void)=>void){
    let list:string[]=[];
    try{list=this.store.has(TIPS_KEY)?JSON.parse(this.store.getString(TIPS_KEY)):[];}catch(e){list=[];}
    this.seen=Array.isArray(list)?list:[];
  }

  /** Queue a tip unless it's been seen on this device before. */
  show(id:string):void {
    if(this.seen.indexOf(id)>=0||this.queue.indexOf(id)>=0||this.current?.id===id)return;
    this.queue.push(id);
  }
  /** Show a tip again (e.g. the user tried the wrong gesture), at most once every `cooldown` seconds. */
  nudge(id:string,cooldown=20):void {
    if(this.current?.id===id||getTime()-(this.lastNudge[id]??-1e9)<cooldown)return;
    this.lastNudge[id]=getTime();
    this.queue=this.queue.filter(q=>q!==id);
    this.queue.unshift(id);
    if(this.current)this.hide();
  }
  /** The user did what the tip teaches: drop it now (and never show it again). */
  done(id:string):void {
    this.markSeen(id);
    this.queue=this.queue.filter(q=>q!==id);
    if(this.current?.id===id)this.hide();
  }

  update():void {
    if(this.current&&(isNull(this.current.root)||getTime()>this.current.until))this.hide();
    if(!this.current&&this.queue.length)this.present(this.queue.shift());
    if(this.current)followView(this.current.root,this.camera,TIP_DISTANCE,TIP_DROP,TIP_FOLLOW);
  }

  private present(id:string):void {
    const tip=this.tips[id];
    if(!tip)return;
    this.markSeen(id);
    const root=global.scene.createSceneObject("Tip "+id);
    placeInView(root,this.camera,TIP_DISTANCE,TIP_DROP);
    root.createComponent("Component.Canvas");
    panel(root,TIP_W,TIP_H,PANEL_TINT,3);
    const textX=tip.icon?5:0,textW=TIP_W-(tip.icon?16:6);
    if(tip.icon){
      const icon=child(root,"Icon",new vec3(-TIP_W/2+7,0,0.5));
      image(icon,tip.icon,9,9,TITLE_INK);
    }
    // Title on one line, body allowed to wrap onto two.
    text(root,tip.title,new vec3(textX,5.6,0.5),textW,6,TIP_TITLE,TITLE_INK);
    text(root,tip.body,new vec3(textX,-3.6,0.5),textW,10,TIP_BODY,BODY_INK);
    sweepColliders(root,this.schedule);
    this.current={id,root,until:getTime()+TIP_SECONDS};
  }
  private hide():void {
    if(this.current&&!isNull(this.current.root))this.current.root.destroy();
    this.current=null;
  }
  private markSeen(id:string):void {
    if(this.seen.indexOf(id)>=0)return;
    this.seen.push(id);
    try{this.store.putString(TIPS_KEY,JSON.stringify(this.seen));}catch(e){}
  }
}

function readFlag(store:GeneralDataStore,key:string):boolean {
  try{return store.has(key)&&store.getBool(key);}catch(e){return false;}
}
function writeFlag(store:GeneralDataStore,key:string):void {
  try{store.putBool(key,true);}catch(e){}
}
/** Stands `so` `distance` cm ahead of the eyes (level, ignoring head pitch), `drop` cm below eye line,
 * facing the user. */
function placeInView(so:SceneObject,camera:Camera,distance:number,drop:number):void {
  const ct=camera.getTransform(),eye=ct.getWorldPosition();
  const look=flatForward(ct);
  const pos=eye.add(look.uniformScale(distance)).add(new vec3(0,-drop,0));
  so.getTransform().setWorldPosition(pos);
  so.getTransform().setWorldRotation(quat.lookAt(look.uniformScale(-1),vec3.up()));
}
/** Lazily drifts `so` back in front of the user as they turn, so a tip stays readable without being
 * glued to the head. */
function followView(so:SceneObject,camera:Camera,distance:number,drop:number,rate:number):void {
  const ct=camera.getTransform(),eye=ct.getWorldPosition(),look=flatForward(ct);
  const goal=eye.add(look.uniformScale(distance)).add(new vec3(0,-drop,0));
  const t=so.getTransform(),k=Math.min(1,getDeltaTime()*rate);
  t.setWorldPosition(vec3.lerp(t.getWorldPosition(),goal,k));
  t.setWorldRotation(quat.slerp(t.getWorldRotation(),quat.lookAt(look.uniformScale(-1),vec3.up()),k));
}
function flatForward(t:Transform):vec3 {
  const f=t.forward.uniformScale(-1);
  const flat=new vec3(f.x,0,f.z);
  return flat.length>1e-4?flat.normalize():new vec3(0,0,-1);
}
function child(parent:SceneObject,name:string,pos:vec3):SceneObject {
  const so=global.scene.createSceneObject(name);so.setParent(parent);so.getTransform().setLocalPosition(pos);return so;
}
function styleBack(back:BackPlate,color:vec4,radius:number):void {
  const r=(back as unknown as {roundedRectangle:{gradient:boolean;backgroundColor:vec4;cornerRadius:number}}).roundedRectangle;
  r.gradient=false;r.backgroundColor=color;r.cornerRadius=radius;
}
function panel(so:SceneObject,w:number,h:number,color:vec4,radius:number):void {
  const back=so.createComponent(BackPlate.getTypeName()) as BackPlate;
  back.style="simple";back.size=new vec2(w,h);
  back.onInitialized.add(()=>{styleBack(back,color,radius);back.interactable.enabled=false;back.interactionPlane.enabled=false;});
}
function button(parent:SceneObject,label:string,pos:vec3,w:number,h:number,size:number,onTap:()=>void):void {
  const so=child(parent,"Button",pos);
  const back=so.createComponent(BackPlate.getTypeName()) as BackPlate;
  back.style="simple";back.size=new vec2(w,h);
  back.onInitialized.add(()=>{
    styleBack(back,BUTTON_TINT,h/2);
    back.interactionPlane.enabled=false;
    back.interactable.onTriggerEnd.add(()=>onTap());
    addBackPlateHover(back,so,BUTTON_TINT);
  });
  text(so,label,new vec3(0,0,0.4),w-2,h-1,size,BODY_INK);
}
function text(parent:SceneObject,value:string,pos:vec3,w:number,h:number,size:number,color:vec4):Text {
  const so=child(parent,"Text",pos);
  const t=so.createComponent("Component.Text") as Text;
  t.text=value;t.font=FONT;t.size=size;t.textFill.color=color;t.depthTest=true;
  t.horizontalAlignment=HorizontalAlignment.Center;t.verticalAlignment=VerticalAlignment.Center;
  t.horizontalOverflow=HorizontalOverflow.Wrap;t.verticalOverflow=VerticalOverflow.Overflow;
  t.layoutRect=Rect.create(-w/2,w/2,-h/2,h/2);
  return t;
}
function image(so:SceneObject,tex:Texture,w:number,h:number,tint:vec4):void {
  so.getTransform().setLocalScale(new vec3(w,h,1));
  const img=so.createComponent("Component.Image") as Image;
  img.mainMaterial=IMAGE_MATERIAL_ASSET.clone();img.mainPass.baseTex=tex;img.mainPass.baseColor=tint;
}
const WHITE=requireAsset("../Textures/white.png") as Texture;
function rect(so:SceneObject,w:number,h:number,tint:vec4):void {image(so,WHITE,w,h,tint);}
/** BackPlate panels bring their own collider, which would sit in front of (and block) the buttons. */
function sweepColliders(root:SceneObject,schedule:(seconds:number,fn:()=>void)=>void):void {
  schedule(0.1,()=>{
    const visit=(node:SceneObject)=>{
      if(isNull(node)||node.name==="Button")return;
      node.getComponents("Physics.ColliderComponent").forEach(c=>c.enabled=false);
      for(let i=0;i<node.getChildrenCount();i++)visit(node.getChild(i));
    };visit(root);
  });
}
