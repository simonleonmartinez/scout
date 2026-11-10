/** A layout's frame on the floor: origin plus yaw about +Y (same convention as ScoutMain's user frame). */
export type AnchorFrame={origin:vec3;yaw:number};

// Saved anchors live in this area; one area keeps them all together for this Lens.
const AREA="shotscout";

/** Spatial Anchors for saved layouts (Specs only, private to the user): each saved layout gets one
 * anchor at its frame, so when Specs recognises the room the layout snaps back exactly where it was.
 * Everything here is best-effort — where anchors aren't available (Lens Studio's preview, an
 * unrecognised room) callers fall back to the room outline. */
export class ScoutAnchors {
  private session:AnchorModule.AnchorSession=null;
  private opening:Promise<AnchorModule.AnchorSession>=null;
  private trackers:SceneObject[]=[];

  constructor(private module:AnchorModule){}

  /** Anchors `frame` and saves it; resolves with the anchor's id, or null if anchoring isn't possible. */
  async saveFrame(frame:AnchorFrame):Promise<string> {
    const session=await this.open();
    if(!session)return null;
    try{
      const pose=mat4.compose(frame.origin,quat.angleAxis(frame.yaw,vec3.up()),vec3.one());
      const anchor=await session.createWorldAnchor(pose);
      await session.saveAnchor(anchor);
      return anchor.id;
    }catch(e){
      console.warn("Scout anchors: couldn't save — "+e);
      return null;
    }
  }

  /** Looks for a saved anchor. Calls `onFound` with its frame once Specs is tracking it, or `onMissing`
   * if it isn't found within `timeout` seconds (or anchoring isn't available) — exactly one of the two. */
  find(id:string,timeout:number,schedule:(seconds:number,fn:()=>void)=>void,
    onFound:(frame:AnchorFrame)=>void,onMissing:()=>void):void {
    let settled=false,so:SceneObject=null;
    const settle=(found:AnchorFrame)=>{
      if(settled)return;
      settled=true;
      // The layout is placed once from the anchor (or falls back), so stop tracking either way.
      if(so&&!isNull(so))so.destroy();
      if(found)onFound(found);else onMissing();
    };
    schedule(timeout,()=>settle(null));
    this.open().then(async session=>{
      if(!session||settled){settle(null);return;}
      const anchor=await session.resolveAnchor(id);
      if(settled)return;
      so=global.scene.createSceneObject("Layout anchor");
      this.trackers.push(so);
      const tracker=so.createComponent("Component.AnchorComponent");
      const check=()=>{
        if(settled||isNull(so))return;
        const state=tracker.state;
        if(state===AnchorModule.AnchorTrackingState.Tracking){
          const t=so.getTransform(),f=t.getWorldRotation().multiplyVec3(vec3.forward());
          settle({origin:t.getWorldPosition(),yaw:Math.atan2(f.x,f.z)});
        }else if(state===AnchorModule.AnchorTrackingState.Error)settle(null);
      };
      tracker.onStateChanged.add(()=>check());
      tracker.anchor=anchor;
      check();
    }).catch(e=>{
      console.warn("Scout anchors: couldn't resolve "+id+" — "+e);
      settle(null);
    });
  }

  /** Deletes a saved anchor (a deleted layout's), if anchoring is available. */
  async remove(id:string):Promise<void> {
    const session=await this.open();
    if(!session)return;
    try{await session.deleteAnchor(await session.resolveAnchor(id));}
    catch(e){console.warn("Scout anchors: couldn't delete "+id+" — "+e);}
  }

  /** Stops tracking anchors found for earlier loads (the layout has already been placed from them). */
  release():void {
    this.trackers.forEach(so=>{if(!isNull(so))so.destroy();});
    this.trackers=[];
  }

  /** Opens the session once, lazily; resolves null where anchors aren't supported. */
  private open():Promise<AnchorModule.AnchorSession> {
    if(this.session)return Promise.resolve(this.session);
    if(!this.module)return Promise.resolve(null);
    if(!this.opening){
      const options=new AnchorModule.AnchorSessionOptions();
      options.area=AREA;
      this.opening=this.module.openSession(options).then(s=>{this.session=s;return s;}).catch(e=>{
        console.warn("Scout anchors: unavailable — "+e);
        return null;
      });
    }
    return this.opening;
  }
}
