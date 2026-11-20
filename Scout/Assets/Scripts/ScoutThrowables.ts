import {HandInputData} from "InteractionKit.lspkg/Providers/HandInputData/HandInputData";
import {Interactable} from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import {Interactor,TargetingMode} from "InteractionKit.lspkg/Core/Interactor/Interactor";
import {addHoverFeedback} from "./ScoutHover";
import {fingerCurl,FIST_ON,FIST_OFF} from "./ScoutGrabMove";

// How long a target stays grabbable after the cursor slips off it (s): the ray drifts as a hand closes.
const GRAB_GRACE=0.4;
// How quickly a held item catches up with the hand (per second) — it glides over rather than snapping.
const FOLLOW=10;
// The last stretch of the hand's path that sets the throw (s).
const THROW_WINDOW=0.1;
// Slow motion: the item leaves at this fraction of the hand's speed, no faster than THROW_MAX (cm/s)...
const SLOW_MO=0.3,THROW_MAX=160;
// ...then eases off (per second) toward a drift it keeps forever: no gravity, it never falls.
const DRAG=0.35,DRIFT=0.35;
// Tumble while floating: degrees per second per cm/s of throw speed, capped.
const SPIN_PER_SPEED=0.6,SPIN_MAX=70;
const HANDS=["left","right"] as const;
// A hovering item's bob: height (cm) and speed (radians per second).
const HOVER_BOB=1.5,HOVER_RATE=2.2;

type Item={so:SceneObject;vel:vec3;launch:number;spinAxis:vec3;spin:number;hover:{base:vec3;phase:number}|null};
type Hold={item:Item;point:()=>vec3|null;offset:vec3;path:{t:number;p:vec3}[];hand:number;interactor:Interactor|null};

/** A workbench easter egg: some of the gear on the bench can be grabbed — a fist while pointing at it, or
 * a pinch — and thrown. Thrown gear goes weightless: it drifts off in slow motion the way it was thrown,
 * gently tumbling, and never falls. Plain class the workbench drives each frame. */
export class ScoutThrowables {
  private items:Item[]=[];
  private hold:Hold=null;
  private hovered:{item:Item;time:number}=null;
  private fist=[false,false];

  constructor(private camera:Camera){}

  /** Makes a piece of mesh throwable. Its pivot moves to the middle of the mesh so it tumbles about its
   * own centre. Returns the new holder. */
  add(mesh:SceneObject,parent:SceneObject,hover=false):SceneObject {
    const visual=mesh.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    if(!visual)return null;
    const mt=mesh.getTransform();
    const lo=visual.localAabbMin(),hi=visual.localAabbMax();
    const holder=global.scene.createSceneObject(mesh.name+" (throwable)");holder.setParent(parent);
    const ht=holder.getTransform();
    ht.setWorldPosition(mt.getWorldTransform().multiplyPoint(lo.add(hi).uniformScale(0.5)));
    ht.setWorldRotation(mt.getWorldRotation());
    // The mesh's own origin is the whole bench's, far from this piece: hover-grow a pivot at its middle.
    const pivot=global.scene.createSceneObject("Pivot");pivot.setParent(holder);
    mesh.setParentPreserveWorldTransform(pivot);
    const col=holder.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const box=Shape.createBoxShape();
    box.size=hi.sub(lo).mult(mt.getWorldScale()).add(vec3.one().uniformScale(3));
    col.shape=box;
    const input=holder.createComponent(Interactable.getTypeName()) as Interactable;
    input.targetingMode=3;input.enableInstantDrag=true;
    addHoverFeedback(input,pivot);
    const item:Item={so:holder,vel:vec3.zero(),launch:0,spinAxis:vec3.up(),spin:0,
      hover:hover?{base:ht.getLocalPosition(),phase:Math.random()*Math.PI*2}:null};
    this.items.push(item);
    const seen=()=>{this.hovered={item,time:getTime()};};
    input.onHoverEnter.add(seen);input.onHoverUpdate.add(seen);
    // Pinch to grab, too: a ray point at the distance it was caught (or the fingertip up close).
    input.onTriggerStart.add(e=>{
      if(this.hold)return;
      const it=e.interactor,direct=it.activeTargetingMode===TargetingMode.Direct;
      const hit=direct?it.startPoint:(it.targetHitPosition??it.startPoint);
      if(!hit||!it.startPoint)return;
      const dist=hit.distance(it.startPoint);
      this.begin(item,()=>{
        if(!it.startPoint)return null;
        return direct||!it.direction?it.startPoint:it.startPoint.add(it.direction.uniformScale(dist));
      },-1,it);
    });
    const end=(e:{interactor:Interactor})=>{if(this.hold&&this.hold.interactor===e.interactor)this.release();};
    input.onTriggerEnd.add(end);input.onTriggerEndOutside.add(end);input.onTriggerCanceled.add(end);
    return holder;
  }

  update():void {
    this.items=this.items.filter(i=>!isNull(i.so));
    if(this.hold&&isNull(this.hold.item.so))this.hold=null;
    this.updateFists();
    const dt=Math.min(getDeltaTime(),0.05);
    if(this.hold)this.follow(dt);
    for(const it of this.items){
      if(this.hold&&this.hold.item===it)continue;
      // Hovering in place until it's first picked up: a gentle bob and a slow turn.
      if(it.launch<=0&&it.hover){
        const t=getTime()+it.hover.phase,tr=it.so.getTransform();
        tr.setLocalPosition(it.hover.base.add(new vec3(0,Math.sin(t*HOVER_RATE)*HOVER_BOB,0)));
        continue;
      }
      if(it.launch<=0)continue;
      // Ease off toward a slow drift, then keep it: weightless, it never stops or falls.
      const speed=it.vel.length;
      if(speed>it.launch*DRIFT)it.vel=it.vel.uniformScale(Math.max(it.launch*DRIFT/speed,Math.exp(-DRAG*dt)));
      const t=it.so.getTransform();
      t.setWorldPosition(t.getWorldPosition().add(it.vel.uniformScale(dt)));
      if(it.spin>0)t.setWorldRotation(quat.angleAxis(it.spin*dt*Math.PI/180,it.spinAxis).multiply(t.getWorldRotation()));
    }
  }

  /** A fist while pointing at (or just after pointing at) an item picks it up; opening the hand throws. */
  private updateFists():void {
    HANDS.forEach((side,i)=>{
      const hand=HandInputData.getInstance().getHand(side);
      const curl=fingerCurl(hand);
      const fist=curl!==null&&curl<(this.fist[i]?FIST_OFF:FIST_ON);
      if(fist&&!this.fist[i]&&!this.hold){
        const target=this.hovered&&getTime()-this.hovered.time<GRAB_GRACE?this.hovered.item:null;
        if(target&&!isNull(target.so)){
          // Held out along the line from the eyes through the fist, at the distance it was grabbed from,
          // so moving the hand swings it around (farther items swing farther — like far-field dragging).
          const dist=target.so.getTransform().getWorldPosition().distance(this.camera.getTransform().getWorldPosition());
          this.begin(target,()=>{
            if(!hand.isTracked())return null;
            const k=hand.middleKnuckle.position,h=this.camera.getTransform().getWorldPosition();
            return h.add(k.sub(h).normalize().uniformScale(dist));
          },i,null);
        }
      }
      if(!fist&&this.fist[i]&&this.hold?.hand===i)this.release();
      this.fist[i]=fist;
    });
  }
  private begin(item:Item,point:()=>vec3|null,hand:number,interactor:Interactor|null):void {
    const p=point();
    if(!p)return;
    item.vel=vec3.zero();item.launch=0;item.spin=0;item.hover=null;
    // Keep the grab point where it is on the item, so it doesn't jump to centre on the hand.
    const offset=item.so.getTransform().getWorldPosition().sub(p);
    this.hold={item,point,offset,path:[{t:getTime(),p}],hand,interactor};
  }
  private follow(dt:number):void {
    const h=this.hold,p=h.point();
    if(!p)return; // tracking lost: hold still; letting go still throws
    const now=getTime();
    h.path.push({t:now,p});
    while(h.path.length>2&&now-h.path[0].t>THROW_WINDOW)h.path.shift();
    // The grab offset melts away, so the item ends up right on the hand's point.
    h.offset=h.offset.uniformScale(Math.exp(-4*dt));
    const t=h.item.so.getTransform(),goal=p.add(h.offset);
    t.setWorldPosition(vec3.lerp(t.getWorldPosition(),goal,Math.min(1,dt*FOLLOW)));
  }
  private release():void {
    const h=this.hold;
    this.hold=null;
    if(!h||isNull(h.item.so))return;
    const a=h.path[0],b=h.path[h.path.length-1];
    const span=b.t-a.t;
    const hand=span>0.01?b.p.sub(a.p).uniformScale(1/span):vec3.zero();
    let v=hand.uniformScale(SLOW_MO);
    if(v.length>THROW_MAX)v=v.normalize().uniformScale(THROW_MAX);
    const it=h.item;
    it.vel=v;it.launch=Math.max(v.length,0.001);
    // Tumble end over end in the direction of the throw.
    const flat=new vec3(v.x,0,v.z);
    it.spinAxis=flat.length>1?vec3.up().cross(flat).normalize():vec3.right();
    it.spin=Math.min(SPIN_MAX,v.length*SPIN_PER_SPEED);
  }
}
