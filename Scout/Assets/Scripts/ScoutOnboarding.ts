import {BackPlate} from "UIKit.lspkg/Scripts/BackPlate";
import {IMAGE_MATERIAL_ASSET} from "UIKit.lspkg/Scripts/Utility/Assets";
import {addBackPlateHover} from "./ScoutHover";
import animate from "InteractionKit.lspkg/Utils/animate";
import {TargetingPriority} from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable";

const FONT=requireAsset("../Fonts/Inter.ttf") as Font;
// Brand inks: lavender titles (as in the bench header), cream body text, on a dark gear-grey panel.
export const TITLE_INK=new vec4(0xc1/255,0xad/255,0xff/255,1);
export const BODY_INK=new vec4(0.93,0.88,0.78,1);
export const PANEL_TINT=new vec4(0.1,0.1,0.11,1);

// Text sizes are set for reading in glasses, not on a monitor: at these distances the cap height is
// roughly 2-3cm. Nothing here goes below TIP_BODY.
// A tip sits at arm's length, just below the gaze, about 23 cm wide: Specs' view is narrow, and out at
// 110 cm and 76 cm wide it filled it. TIP_SCALE shrinks the layout below (unscaled cm) to fit; the text
// sizes are set for that scale so it still reads at least as large as before.
const TIP_DISTANCE=55,TIP_DROP=8,TIP_SCALE=0.35,TIP_W=66,TIP_H=22;
const TIP_TITLE=150,TIP_BODY=110;
const CLOSE_SIZE=9;
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
    if(this.current)followGaze(this.current.root,this.camera,TIP_DISTANCE,TIP_DROP,TIP_FOLLOW);
  }

  private present(id:string):void {
    const tip=this.tips[id];
    if(!tip)return;
    this.markSeen(id);
    const root=global.scene.createSceneObject("Tip "+id);
    followGaze(root,this.camera,TIP_DISTANCE,TIP_DROP,TIP_FOLLOW,true);
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
/** Like followView, but tracks the full gaze (looking down at the floor included), so `so` stays in view
 * wherever the user looks; `drop` is below the gaze line. Faces the eyes. With `snap`, jumps there now. */
export function followGaze(so:SceneObject,camera:Camera,distance:number,drop:number,rate:number,snap=false,side=0):void {
  const ct=camera.getTransform(),eye=ct.getWorldPosition();
  const gaze=ct.forward.uniformScale(-1).normalize();
  const goal=eye.add(gaze.uniformScale(distance)).add(ct.up.uniformScale(-drop)).add(ct.right.uniformScale(side));
  const face=quat.lookAt(eye.sub(goal).normalize(),vec3.up());
  const t=so.getTransform(),k=snap?1:Math.min(1,getDeltaTime()*rate);
  t.setWorldPosition(vec3.lerp(t.getWorldPosition(),goal,k));
  t.setWorldRotation(quat.slerp(t.getWorldRotation(),face,k));
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
    // Tips and cards float in front of everything: their buttons win a pinch over a note or prop behind.
    back.interactable.targetingPriority=TargetingPriority.High;
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
    // Tips and cards float in front of everything: their buttons win a pinch over a note or prop behind.
    back.interactable.targetingPriority=TargetingPriority.High;
    back.interactable.onTriggerEnd.add(()=>onTap());
    addBackPlateHover(back,so,tint);
  });
  text(so,label,new vec3(0,0,0.4),w-2,h-1,size,BODY_INK);
}

// Toolkit card: shown once the shoot type is picked on the bench, introducing what can be placed.
// Shown at arm's length so the × can be reached by hand. Specs' view is narrow, so KIT_SCALE keeps it to
// ~60% of the view wide (~23 cm across at 55 cm); layout below is in unscaled cm, text sized up to match.
const KIT_DISTANCE=55,KIT_DROP=3,KIT_SCALE=0.27;
// It follows the gaze (not just turning), a little quicker than tips, so it's never left behind.
const KIT_FOLLOW=5;
const KIT_CLOSE=12;
// How long the toolkit card stays (s) if not closed; beside the menu, the gap to it (cm at the card's
// design distance) and the arrow's size and colour.
// The tour popover: size, notch, gap to the button (design cm), text sizes, follow rate.
const TOUR_W=78,TOUR_H=36,TOUR_NOTCH=6,TOUR_REACH=5;
const TOUR_TITLE=185,TOUR_BODY=135,TOUR_COUNT=115,TOUR_BTN_W=22,TOUR_BTN_TEXT=140,TOUR_FOLLOW=6;
const TOUR_COUNT_TINT=new vec4(0xc1/255,0xad/255,0xff/255,0.8);
// A muted lavender, not near-black: Specs' display adds light, so a dark panel (and its notch) barely shows.
const TOUR_TINT=new vec4(0x3a/255,0x30/255,0x5e/255,1);
export type KitCard={label:string;icon:Texture};

/** One stop on the toolbar tour: which tool, and what it's for. */
export type TourStep={title:string;body:string};

/** The toolbar tour shown after the shoot type is picked: a popover beside the menu whose pointer (a
 * notch) aims at one toolbar button at a time, top to bottom, saying what it's for.
 * Next steps through; × closes it at any point. While it's up nothing gets placed (ScoutMain). */
export class ScoutToolkitCard {
  private root:SceneObject=null;
  private content:SceneObject=null;
  private caret:SceneObject=null;
  private steps:TourStep[]=[];
  private step=0;
  private anchorFor:((i:number)=>SceneObject|null)|null=null;
  constructor(private camera:Camera,private schedule:(seconds:number,fn:()=>void)=>void){}
  get active():boolean {return !!this.root&&!isNull(this.root)&&this.root.enabled;}
  show(_title:string,steps:TourStep[],anchorFor:((i:number)=>SceneObject|null)|null=null):void {
    this.close();
    this.steps=steps;this.step=0;this.anchorFor=anchorFor;
    const root=global.scene.createSceneObject("Toolbar tour");
    followGaze(root,this.camera,KIT_DISTANCE,KIT_DROP,KIT_FOLLOW,true);
    root.getTransform().setLocalScale(vec3.one().uniformScale(KIT_SCALE));
    root.createComponent("Component.Canvas");
    panel(root,TOUR_W,TOUR_H,TOUR_TINT,4);
    // The notch: a turned square half tucked under the card's edge, on the side facing the button.
    this.caret=child(root,"Notch",vec3.zero());
    panel(this.caret,TOUR_NOTCH,TOUR_NOTCH,TOUR_TINT,1.2);
    this.caret.getTransform().setLocalRotation(quat.angleAxis(Math.PI/4,vec3.forward()));
    closeButton(child(root,CLOSE_NAME,new vec3(TOUR_W/2-KIT_CLOSE/2-2,TOUR_H/2-KIT_CLOSE/2-2,0.6)),()=>this.close(),KIT_CLOSE);
    this.root=root;
    this.buildStep();
    this.place(true);
  }
  private buildStep():void {
    if(this.content&&!isNull(this.content))this.content.destroy();
    const c=child(this.root,"Step",vec3.zero());this.content=c;
    const s=this.steps[this.step],last=this.step===this.steps.length-1;
    const left=-TOUR_W/2+5,textW=TOUR_W-KIT_CLOSE-12;
    const title=text(c,s.title,new vec3(left+textW/2,TOUR_H/2-8,0.5),textW,9,TOUR_TITLE,TITLE_INK);
    title.horizontalAlignment=HorizontalAlignment.Left;
    const body=text(c,s.body,new vec3(left+(TOUR_W-10)/2,TOUR_H/2-19,0.5),TOUR_W-10,12,TOUR_BODY,BODY_INK);
    body.horizontalAlignment=HorizontalAlignment.Left;
    const count=text(c,(this.step+1)+" of "+this.steps.length,new vec3(left+10,-TOUR_H/2+7,0.5),20,7,TOUR_COUNT,TOUR_COUNT_TINT);
    count.horizontalAlignment=HorizontalAlignment.Left;
    pillButton(c,last?"Got it":"Next",new vec3(TOUR_W/2-5-TOUR_BTN_W/2,-TOUR_H/2+7,0.5),TOUR_BTN_W,9,TOUR_BTN_TEXT,false,()=>{
      // Swap a beat later, not inside the button's own tap.
      this.schedule(0.05,()=>{
        if(!this.active)return;
        if(last){this.close();return}
        this.step++;this.buildStep();
      });
    });
    sweepColliders(this.root,this.schedule);
  }
  /** Beside the current step's toolbar button, level with it, on the side toward the middle of the view;
   * turned to face the user and scaled to keep its size to the eye. Without the menu, it floats ahead. */
  private place(snap:boolean):void {
    const a=this.anchorFor?this.anchorFor(this.step):null;
    if(!a){followGaze(this.root,this.camera,KIT_DISTANCE,KIT_DROP,KIT_FOLLOW,snap);this.showPointer(false);return}
    const cam=this.camera.getTransform(),eye=cam.getWorldPosition(),ap=a.getTransform().getWorldPosition();
    const k=Math.max(20,ap.distance(eye))/KIT_DISTANCE,s=KIT_SCALE*k;
    const right=cam.right,side=ap.sub(eye).dot(right)>=0?-1:1;
    const goal=ap.add(right.uniformScale(side*(TOUR_W/2+TOUR_NOTCH+TOUR_REACH)*s));
    const t=this.root.getTransform();
    t.setWorldPosition(snap?goal:vec3.lerp(t.getWorldPosition(),goal,Math.min(1,getDeltaTime()*TOUR_FOLLOW)));
    const look=eye.sub(t.getWorldPosition());
    if(look.length>1)t.setWorldRotation(quat.lookAt(look.normalize(),vec3.up()));
    t.setWorldScale(vec3.one().uniformScale(s));
    // Notch on the near edge, level with the button.
    const local=t.getInvertedWorldTransform().multiplyPoint(ap);
    const edgeX=-side*TOUR_W/2,y=Math.max(-TOUR_H/2+TOUR_NOTCH,Math.min(TOUR_H/2-TOUR_NOTCH,local.y));
    this.caret.getTransform().setLocalPosition(new vec3(edgeX,y,-0.05));
    this.showPointer(true);
  }
  private showPointer(on:boolean):void {
    if(this.caret&&!isNull(this.caret))this.caret.enabled=on;
  }
  /** Hides it now and destroys it a moment later (never inside the × button's own callback). */
  close():void {
    const root=this.root;
    this.root=null;this.content=null;this.caret=null;
    if(!root||isNull(root))return;
    root.enabled=false;
    this.schedule(0.5,()=>{if(!isNull(root))root.destroy();});
  }
  update():void {
    if(this.active)this.place(false);
  }
}

// Welcome: the first thing seen when the lens opens — the ShotScout wordmark over the crew artwork (the centrepiece),
// floating a little beyond arm's reach (following the user's view lazily, level), and a "Set floor" button
// that starts floor setup.
const WELCOME_ART=requireAsset("../Logo/shotscout_start.png") as Texture;
const WELCOME_LOGO=requireAsset("../Logo/shotscout_wordmark.png") as Texture;
const WELCOME_ART_ASPECT=1008/1024,WELCOME_LOGO_ASPECT=25.4/12;
const WELCOME_DISTANCE=100,WELCOME_DROP=6,WELCOME_FOLLOW=2.5;
const WELCOME_ART_H=34,WELCOME_LOGO_H=5.5,WELCOME_BUTTON_W=22,WELCOME_BUTTON_H=7,WELCOME_BUTTON_TEXT=125;
const WELCOME_FADE=0.3;
export class ScoutWelcome {
  readonly root:SceneObject;
  private pressed=false;
  private placed=false;
  /** True once "Set floor" has been pressed (or the welcome was skipped). */
  get done():boolean {return this.pressed;}
  constructor(private camera:Camera,onSetFloor:()=>void){
    this.root=global.scene.createSceneObject("Welcome");
    // Stacked top to bottom: wordmark, artwork (centred on the card's origin), button.
    const artY=0,logoY=WELCOME_ART_H/2+1.5+WELCOME_LOGO_H/2,buttonY=-WELCOME_ART_H/2-2-WELCOME_BUTTON_H/2;
    image(child(this.root,"Art",new vec3(0,artY,0)),WELCOME_ART,WELCOME_ART_H*WELCOME_ART_ASPECT,WELCOME_ART_H,new vec4(1,1,1,1));
    image(child(this.root,"Wordmark",new vec3(0,logoY,0)),WELCOME_LOGO,WELCOME_LOGO_H*WELCOME_LOGO_ASPECT,WELCOME_LOGO_H,new vec4(1,1,1,1));
    pillButton(this.root,"Set floor",new vec3(0,buttonY,0),WELCOME_BUTTON_W,WELCOME_BUTTON_H,WELCOME_BUTTON_TEXT,false,()=>{
      if(this.pressed)return;
      this.pressed=true;
      const t=this.root.getTransform();
      animate({duration:WELCOME_FADE,easing:"ease-in-quad",update:k=>{if(!isNull(this.root))t.setLocalScale(vec3.one().uniformScale(Math.max(0.001,1-k)));},
        ended:()=>{if(!isNull(this.root))this.root.enabled=false;}});
      onSetFloor();
    });
  }
  /** Keeps the welcome in front of the user until it's dismissed. */
  update():void {
    if(this.pressed)return;
    if(!this.placed){placeInView(this.root,this.camera,WELCOME_DISTANCE,WELCOME_DROP);this.placed=true;return}
    followView(this.root,this.camera,WELCOME_DISTANCE,WELCOME_DROP,WELCOME_FOLLOW);
  }
}
