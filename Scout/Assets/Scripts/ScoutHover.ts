import animate,{CancelFunction} from "SpectaclesInteractionKit.lspkg/Utils/animate";
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import {InteractorEvent} from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent";
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate";

/** Shared purple used for every hover glow, so anything interactive reads the same way under the cursor. */
export const HOVER_GLOW=new vec4(0.66,0.5,1,1);
const HOVER_SCALE=1.08;
const HOVER_SECONDS=0.12;
// How far a button's own color leans toward HOVER_GLOW at full hover — "very slight", not a recolor.
const HOVER_GLOW_MIX=0.4;

/** Grows `target` slightly (and drives an optional glow) while any interactor hovers `interactable`, then
 * eases back on hover-off. `setGlow` receives 0..1. Buttons get destroyed mid-hover (wizard rebuilds,
 * Delete), so every frame of the animation checks the target is still alive before touching it.
 * `scale` overrides the grow factor (big props want less than buttons). With `ownOnly`, hovering one of
 * the interactable's child interactables (SIK bubbles their hover up) doesn't count — only the
 * interactable's own collider does. */
export function addHoverFeedback(interactable:Interactable,target:SceneObject,setGlow?:(amount:number)=>void,scale:number=HOVER_SCALE,ownOnly:boolean=false):void {
  const t=target.getTransform();
  const base=t.getLocalScale();
  let level=0,goal=0;
  let cancel:CancelFunction=null;
  const go=(to:number)=>{
    if(to===goal)return;
    goal=to;    if(cancel)cancel();
    const from=level;
    cancel=animate({duration:HOVER_SECONDS,easing:"ease-out-quad",update:k=>{
      if(isNull(target))return;
      level=from+(to-from)*k;
      t.setLocalScale(base.uniformScale(1+(scale-1)*level));
      if(setGlow)setGlow(level);
    }});
  };
  const own=(e:InteractorEvent)=>!ownOnly||e.target===interactable;
  interactable.onHoverEnter.add(e=>go(own(e)?1:0));
  // The cursor can slide from the interactable onto a child (or back) without a fresh enter/exit.
  if(ownOnly)interactable.onHoverUpdate.add(e=>go(own(e)?1:0));
  interactable.onHoverExit.add(()=>go(0));
}

/** addHoverFeedback for a BackPlate button: grows it and tints its background a little toward purple.
 * `idle` is passed in rather than read at hover time, so a missed hover-exit can never stack the glow.
 * Call from inside the BackPlate's onInitialized, once `interactable` exists. */
export function addBackPlateHover(back:BackPlate,target:SceneObject,idle:vec4):void {
  const rect=(back as unknown as {roundedRectangle:{backgroundColor:vec4}}).roundedRectangle;
  addHoverFeedback(back.interactable,target,amount=>{
    rect.backgroundColor=vec4.lerp(idle,HOVER_GLOW,HOVER_GLOW_MIX*amount);
  });
}
