import {HandInputData} from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import {BaseHand} from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/BaseHand";

// Fist detection from hand keypoints: how far the middle/ring/pinky tips sit from the wrist, as a
// fraction of their knuckles' distance. Measured in the preview: fist ~0.8, pinch ~1.67, relaxed
// ~1.8, open palm ~1.9. A gap between the two thresholds keeps a half-closed hand from flickering.
const FIST_ON=1.05,FIST_OFF=1.3;
// A pinch whose other fingers are curled this far is a fist closing, not a deliberate pinch.
export const PINCH_IS_FIST=1.25;
// How quickly the tracked hand point is smoothed (per second) — hand keypoints jitter.
const SMOOTHING=18;
const HANDS=["left","right"] as const;

/** Middle/ring/pinky curl (see FIST_ON), or null when the hand isn't tracked. */
export function fingerCurl(hand:BaseHand):number|null {
  if(!hand.isTracked())return null;
  const w=hand.wrist.position;
  const ratio=(tip:vec3,knuckle:vec3)=>tip.distance(w)/Math.max(0.01,knuckle.distance(w));
  return (ratio(hand.middleTip.position,hand.middleKnuckle.position)
    +ratio(hand.ringTip.position,hand.ringKnuckle.position)
    +ratio(hand.pinkyTip.position,hand.pinkyKnuckle.position))/3;
}

export type GrabHooks={
  /** The prop to pick up when a fist closes (the one under the cursor just before), or null. */
  target():SceneObject|null;
  onStart(root:SceneObject):void;
  /** `moved` is false for a fist that never really dragged (under 2 cm). */
  onEnd(root:SceneObject,moved:boolean):void;
};

/** Grab-to-move: close a fist while pointing at a placed prop and it slides across the floor with the
 * hand, amplified by how much farther away it is than the hand (like SIK's far-field dragging); open
 * the hand to drop it. Moves in the floor plane only — the floor clamp owns height. A plain class
 * ScoutMain drives each frame, so pinch stays free for placing, buttons, dials and the gizmo. */
export class ScoutGrabMove {
  private fist=[false,false];
  private grab:{hand:number;root:SceneObject;fromHand:vec3;fromRoot:vec3;gain:number;smoothed:vec3}=null;

  constructor(private camera:Camera,private hooks:GrabHooks){}

  /** The prop currently held, if any. */
  get holding():SceneObject {return this.grab&&!isNull(this.grab.root)?this.grab.root:null;}

  update():void {
    HANDS.forEach((side,i)=>{
      const hand=HandInputData.getInstance().getHand(side);
      const curl=fingerCurl(hand);
      const fist=curl!==null&&curl<(this.fist[i]?FIST_OFF:FIST_ON);
      if(fist&&!this.fist[i]&&!this.grab)this.begin(i,hand);
      if(!fist&&this.fist[i]&&this.grab?.hand===i)this.end();
      this.fist[i]=fist;
    });
    if(this.grab)this.follow();
  }

  private begin(index:number,hand:BaseHand):void {
    const root=this.hooks.target();
    if(!root||isNull(root))return;
    const head=this.camera.getTransform().getWorldPosition();
    const point=hand.middleKnuckle.position;
    const fromRoot=root.getTransform().getWorldPosition();
    // Fixed for the whole grab: recomputing it as the prop approaches would feed back on itself.
    const gain=Math.max(1,flatDistance(head,fromRoot)/Math.max(10,flatDistance(head,point)));
    this.grab={hand:index,root,fromHand:point,fromRoot,gain,smoothed:point};
    this.hooks.onStart(root);
  }
  private follow():void {
    const g=this.grab;
    if(isNull(g.root)){this.grab=null;return;}
    const hand=HandInputData.getInstance().getHand(HANDS[g.hand]);
    if(!hand.isTracked())return; // hold still until tracking returns; opening the hand still drops it
    const k=Math.min(1,getDeltaTime()*SMOOTHING);
    g.smoothed=vec3.lerp(g.smoothed,hand.middleKnuckle.position,k);
    const d=g.smoothed.sub(g.fromHand);
    const t=g.root.getTransform(),p=t.getWorldPosition();
    t.setWorldPosition(new vec3(g.fromRoot.x+d.x*g.gain,p.y,g.fromRoot.z+d.z*g.gain));
  }
  private end():void {
    const g=this.grab;
    this.grab=null;
    if(!g||isNull(g.root))return;
    this.hooks.onEnd(g.root,flatDistance(g.root.getTransform().getWorldPosition(),g.fromRoot)>2);
  }
}

function flatDistance(a:vec3,b:vec3):number {
  return new vec2(a.x-b.x,a.z-b.z).length;
}
