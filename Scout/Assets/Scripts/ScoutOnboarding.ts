import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate";
import {IMAGE_MATERIAL_ASSET} from "SpectaclesUIKit.lspkg/Scripts/Utility/Assets";
import {addBackPlateHover} from "./ScoutHover";
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate";

const FONT=requireAsset("../Fonts/Inter.ttf") as Font;
// Brand inks: lavender titles (as in the bench header), cream body text, on a dark gear-grey panel.
export const TITLE_INK=new vec4(0xc1/255,0xad/255,0xff/255,1);
export const BODY_INK=new vec4(0.93,0.88,0.78,1);
export const PANEL_TINT=new vec4(0.1,0.1,0.11,1);

// Text sizes are set for reading in glasses, not on a monitor: at these distances the cap height is
// roughly 2-3cm. Nothing here goes below TIP_BODY.
// A tip sits well out in front, a little below eye line — at 70cm it filled half the view. TIP_SCALE
// enlarges it slightly so text stays readable out there (~38° wide); layout below is in unscaled cm.
const TIP_DISTANCE=110,TIP_DROP=30,TIP_SCALE=1.15,TIP_W=66,TIP_H=22;
const TIP_TITLE=150,TIP_BODY=110;
const CLOSE_SIZE=6;
const TIP_SECONDS=7,TIP_FOLLOW=3;
// v2: the intro moved onto the bench, so it shows once more for anyone who saw the old cards.
const INTRO_KEY="scout.intro.v2.seen",TIPS_KEY="scout.tips.seen";

export type IntroCard={title:string;body:string};
export type Tip={title:string;body:string;icon?:Texture};

/** The first-run intro is paged on the bench console (see ScoutWorkbench.buildIntro); this only
 * remembers, per device, whether it has been read. */
export function introSeen():boolean {return readFlag(global.persistentStorageSystem.store,INTRO_KEY);}
export function markIntroSeen():void {writeFlag(global.persistentStorageSystem.store,INTRO_KEY);}

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

  /** While true (another guided step owns the view), no tip shows; one already up waits its turn again. */
  held=false;

  update():void {
    if(this.held){
      if(this.current){const id=this.current.id;this.hide();this.queue.unshift(id);}
      return;
    }
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
    root.getTransform().setLocalScale(vec3.one().uniformScale(TIP_SCALE));
    root.createComponent("Component.Canvas");
    panel(root,TIP_W,TIP_H,PANEL_TINT,3);
    // Round × in the top-right corner: dismisses this tip for good.
    closeButton(child(root,CLOSE_NAME,new vec3(TIP_W/2-CLOSE_SIZE/2-1.5,TIP_H/2-CLOSE_SIZE/2-1.5,0.6)),()=>{
      if(this.current?.root===root)this.hide();
    });
    // Text between the icon (left) and the close button (right).
    const textX=tip.icon?2:-3,textW=TIP_W-(tip.icon?16:6)-CLOSE_SIZE;
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
export function placeInView(so:SceneObject,camera:Camera,distance:number,drop:number):void {
  const ct=camera.getTransform(),eye=ct.getWorldPosition();
  const look=flatForward(ct);
  const pos=eye.add(look.uniformScale(distance)).add(new vec3(0,-drop,0));
  so.getTransform().setWorldPosition(pos);
  so.getTransform().setWorldRotation(quat.lookAt(look.uniformScale(-1),vec3.up()));
}
/** Lazily drifts `so` back in front of the user as they turn, so a tip stays readable without being
 * glued to the head. */
export function followView(so:SceneObject,camera:Camera,distance:number,drop:number,rate:number):void {
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
export function child(parent:SceneObject,name:string,pos:vec3):SceneObject {
  const so=global.scene.createSceneObject(name);so.setParent(parent);so.getTransform().setLocalPosition(pos);return so;
}
export function styleBack(back:BackPlate,color:vec4,radius:number):void {
  const r=(back as unknown as {roundedRectangle:{gradient:boolean;backgroundColor:vec4;cornerRadius:number}}).roundedRectangle;
  r.gradient=false;r.backgroundColor=color;r.cornerRadius=radius;
}
export function panel(so:SceneObject,w:number,h:number,color:vec4,radius:number):void {
  const back=so.createComponent(BackPlate.getTypeName()) as BackPlate;
  back.style="simple";back.size=new vec2(w,h);
  back.onInitialized.add(()=>{styleBack(back,color,radius);back.interactable.enabled=false;back.interactionPlane.enabled=false;});
}
export function text(parent:SceneObject,value:string,pos:vec3,w:number,h:number,size:number,color:vec4):Text {
  const so=child(parent,"Text",pos);
  const t=so.createComponent("Component.Text") as Text;
  t.text=value;t.font=FONT;t.size=size;t.textFill.color=color;t.depthTest=true;
  t.horizontalAlignment=HorizontalAlignment.Center;t.verticalAlignment=VerticalAlignment.Center;
  t.horizontalOverflow=HorizontalOverflow.Wrap;t.verticalOverflow=VerticalOverflow.Overflow;
  t.layoutRect=Rect.create(-w/2,w/2,-h/2,h/2);
  return t;
}
export function image(so:SceneObject,tex:Texture,w:number,h:number,tint:vec4):void {
  so.getTransform().setLocalScale(new vec3(w,h,1));
  const img=so.createComponent("Component.Image") as Image;
  img.mainMaterial=IMAGE_MATERIAL_ASSET.clone();img.mainPass.baseTex=tex;img.mainPass.baseColor=tint;
}
const CLOSE_ICON=requireAsset("../Icons/close.png") as Texture;
const CLOSE_NAME="Close",BUTTON_NAME="Button";
const CLOSE_TINT=new vec4(0x3e/255,0x30/255,0x82/255,1);
/** A small round × button (BackPlate circle with the close icon) that calls `onTap`. */
function closeButton(so:SceneObject,onTap:()=>void,size=CLOSE_SIZE):void {
  const back=so.createComponent(BackPlate.getTypeName()) as BackPlate;
  back.style="simple";back.size=new vec2(size,size);
  back.onInitialized.add(()=>{
    styleBack(back,CLOSE_TINT,size/2);
    back.interactionPlane.enabled=false;
    back.interactable.onTriggerEnd.add(()=>onTap());
    addBackPlateHover(back,so,CLOSE_TINT);
  });
  const icon=child(so,"Icon",new vec3(0,0,0.3));
  image(icon,CLOSE_ICON,size*0.55,size*0.55,BODY_INK);
}
/** Panels are read-only apart from their buttons: the panel's own collider would otherwise catch pinches
 * (and hover) meant for whatever is behind it. Close buttons and pill buttons keep theirs. */
export function sweepColliders(root:SceneObject,schedule:(seconds:number,fn:()=>void)=>void):void {
  schedule(0.1,()=>{
    const visit=(node:SceneObject)=>{
      if(isNull(node)||node.name===CLOSE_NAME||node.name===BUTTON_NAME)return;
      node.getComponents("Physics.ColliderComponent").forEach(c=>c.enabled=false);
      for(let i=0;i<node.getChildrenCount();i++)visit(node.getChild(i));
    };visit(root);
  });
}
const BUTTON_TINT=new vec4(0x5a/255,0x44/255,0xb8/255,1),BUTTON_QUIET=new vec4(0x2a/255,0x26/255,0x36/255,1);
/** A pill button (named BUTTON_NAME so sweepColliders spares it): purple, or dark grey when `quiet`. */
export function pillButton(parent:SceneObject,label:string,pos:vec3,w:number,h:number,size:number,quiet:boolean,onTap:()=>void):void {
  const so=child(parent,BUTTON_NAME,pos);
  const tint=quiet?BUTTON_QUIET:BUTTON_TINT;
  const back=so.createComponent(BackPlate.getTypeName()) as BackPlate;
  back.style="simple";back.size=new vec2(w,h);
  back.onInitialized.add(()=>{
    styleBack(back,tint,h/2);
    back.interactionPlane.enabled=false;
    back.interactable.onTriggerEnd.add(()=>onTap());
    addBackPlateHover(back,so,tint);
  });
  text(so,label,new vec3(0,0,0.4),w-2,h-1,size,BODY_INK);
}

// Toolkit card: shown once the shoot type is picked on the bench, introducing what can be placed.
// Shown at arm's length so the × can be reached by hand. Specs' view is narrow, so KIT_SCALE keeps it to
// ~60% of the view wide (~23 cm across at 55 cm); layout below is in unscaled cm, text sized up to match.
const KIT_DISTANCE=55,KIT_DROP=3,KIT_SCALE=0.27;
const KIT_W=86,KIT_H=58,KIT_TITLE=175,KIT_LABEL=150,KIT_CLOSE=12;
const KIT_CARD_W=21,KIT_CARD_H=25,KIT_CARD_GAP=23,KIT_FAN=8,KIT_ICON=11;
const KIT_CARD_TINT=new vec4(0x24/255,0x1c/255,0x48/255,1);
const KIT_DEAL=0.22,KIT_STAGGER=0.12;
export type KitCard={label:string;icon:Texture};

/** "Place gear from your toolkit…" pop-up: a small fanned deck of the things that can be placed, with a ×
 * to close. It drifts with the view like a tip and closes itself once the user places something. */
export class ScoutToolkitCard {
  private root:SceneObject=null;
  constructor(private camera:Camera,private schedule:(seconds:number,fn:()=>void)=>void){}
  get active():boolean {return !!this.root&&!isNull(this.root)&&this.root.enabled;}
  show(title:string,cards:KitCard[]):void {
    this.close();
    const root=global.scene.createSceneObject("Toolkit card");
    placeInView(root,this.camera,KIT_DISTANCE,KIT_DROP);
    root.getTransform().setLocalScale(vec3.one().uniformScale(KIT_SCALE));
    root.createComponent("Component.Canvas");
    panel(root,KIT_W,KIT_H,PANEL_TINT,4);
    closeButton(child(root,CLOSE_NAME,new vec3(KIT_W/2-KIT_CLOSE/2-2,KIT_H/2-KIT_CLOSE/2-2,0.6)),()=>this.close(),KIT_CLOSE);
    text(root,title,new vec3(0,KIT_H/2-13,0.5),KIT_W-2*KIT_CLOSE-6,16,KIT_TITLE,TITLE_INK);
    // The deck: fanned out from the middle card, outer cards tipped and dropped a little.
    const mid=(cards.length-1)/2;
    cards.forEach((card,i)=>{
      const k=i-mid;
      const so=child(root,"Card "+card.label,new vec3(k*KIT_CARD_GAP,-9-Math.abs(k)*1.5,0.5+i*0.05));
      const t=so.getTransform();
      t.setLocalRotation(quat.angleAxis(-k*KIT_FAN*Math.PI/180,vec3.forward()));
      panel(so,KIT_CARD_W,KIT_CARD_H,KIT_CARD_TINT,2.5);
      image(child(so,"Icon",new vec3(0,3.5,0.3)),card.icon,KIT_ICON,KIT_ICON,TITLE_INK);
      text(so,card.label,new vec3(0,-7.5,0.3),KIT_CARD_W-2,6,KIT_LABEL,BODY_INK);
      // Dealt in one at a time.
      t.setLocalScale(vec3.one().uniformScale(0.01));
      this.schedule(0.15+i*KIT_STAGGER,()=>{
        if(isNull(so))return;
        animate({duration:KIT_DEAL,easing:"ease-out-back",update:p=>{if(!isNull(so))t.setLocalScale(vec3.one().uniformScale(Math.max(0.01,p)));}});
      });
    });
    sweepColliders(root,this.schedule);
    this.root=root;
  }
  /** Hides it now and destroys it a moment later (never inside the × button's own callback). */
  close():void {
    const root=this.root;
    this.root=null;
    if(!root||isNull(root))return;
    root.enabled=false;
    this.schedule(0.5,()=>{if(!isNull(root))root.destroy();});
  }
  update():void {
    if(this.active)followView(this.root,this.camera,KIT_DISTANCE,KIT_DROP,TIP_FOLLOW);
  }
}
