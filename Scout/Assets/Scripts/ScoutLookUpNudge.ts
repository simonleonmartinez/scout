import {panel,child,image} from "./ScoutOnboarding";

// Cameras, lights and subjects stand tall: up close, their controls float above the top of Specs' view. When the user
// has looked at one of them for a moment without its controls in view, a small grey chevron appears near
// the top of the view, pointing up toward them (like the arrow Specs shows toward the home menu).
const DWELL_SECONDS=2;
// "Looking at it": the prop's body within this angle of the gaze, and within reach.
const LOOK_CONE=20*Math.PI/180,LOOK_REACH=450;
// The controls count as in view once they're this far inside the top edge (fraction of half the FOV).
const IN_VIEW=0.9;
// Where the chevron sits: this far out (cm), this high in the view (fraction of half the FOV).
const DISTANCE=80,HEIGHT_IN_VIEW=0.62,SIDE_LIMIT=0.6;
const SIZE=6.5,CHEVRON=6;
const BACK=new vec4(0.32,0.32,0.35,0.55),CHEVRON_TINT=new vec4(0.86,0.86,0.9,1);
const FADE=6,BOB=0.8,BOB_RATE=3;
const CHEVRON_ICON=requireAsset("../Icons/keyboard_arrow_down.png") as Texture;

export type NudgeTarget={body:vec3;controls:vec3};

export class ScoutLookUpNudge {
  private root:SceneObject;
  private visuals:SceneObject;
  private dwell=0;
  private alpha=0;
  private chevron:Image;
  private pos:vec3=null;

  constructor(private camera:Camera){
    this.root=global.scene.createSceneObject("Look up nudge");
    this.visuals=child(this.root,"Visuals",vec3.zero());
    const disc=child(this.visuals,"Disc",vec3.zero());
    panel(disc,SIZE,SIZE,BACK,SIZE/2);
    const arrow=child(this.visuals,"Chevron",new vec3(0,0,0.1));
    image(arrow,CHEVRON_ICON,CHEVRON,CHEVRON,CHEVRON_TINT);
    // The down-chevron icon, turned to point up.
    arrow.getTransform().setLocalRotation(quat.angleAxis(Math.PI,vec3.forward()));
    this.chevron=arrow.getComponent("Component.Image") as Image;
    this.root.enabled=false;
  }

  /** `targets`: the tall props (body centre and controls centre, world space). `allowed`: false while
   * something else owns the user's attention (setup, a guided capture, editing). */
  update(targets:NudgeTarget[],allowed:boolean):void {
    const dt=getDeltaTime();
    const cam=this.camera.getTransform(),eye=cam.getWorldPosition(),rot=cam.getWorldRotation();
    const gaze=cam.forward.uniformScale(-1);
    const toLocal=rot.invert();
    const halfV=this.camera.fov/2;
    let best:NudgeTarget=null,bestAngle=LOOK_CONE;
    if(allowed)for(const t of targets){
      const d=t.body.sub(eye);
      if(d.length>LOOK_REACH)continue;
      const a=gaze.angleTo(d);
      if(a<bestAngle){bestAngle=a;best=t;}
    }
    let local:vec3=null;
    if(best){
      const l=toLocal.multiplyVec3(best.controls.sub(eye));
      const up=Math.atan2(l.y,-l.z);
      if(l.z<0&&up>halfV*IN_VIEW)local=l;
    }
    this.dwell=local?this.dwell+dt:0;
    const show=this.dwell>=DWELL_SECONDS;
    this.alpha+=((show?1:0)-this.alpha)*Math.min(1,dt*FADE);
    if(this.alpha<0.02&&!show){this.root.enabled=false;this.pos=null;return}
    this.root.enabled=true;
    if(local){
      // Near the top of the view, leaning toward the controls' side.
      const el=halfV*HEIGHT_IN_VIEW;
      const az=Math.max(-halfV*SIDE_LIMIT,Math.min(halfV*SIDE_LIMIT,Math.atan2(local.x,-local.z)));
      const dir=new vec3(Math.sin(az)*Math.cos(el),Math.sin(el),-Math.cos(az)*Math.cos(el));
      const want=eye.add(rot.multiplyVec3(dir).uniformScale(DISTANCE));
      this.pos=this.pos?vec3.lerp(this.pos,want,Math.min(1,dt*10)):want;
    }
    if(!this.pos)return;
    const t=this.root.getTransform();
    t.setWorldPosition(this.pos);
    t.setWorldRotation(rot);
    // A small upward bob, so it reads as "look up" rather than a static badge.
    this.visuals.getTransform().setLocalPosition(new vec3(0,Math.abs(Math.sin(getTime()*BOB_RATE))*BOB,0));
    this.visuals.getTransform().setLocalScale(vec3.one().uniformScale(0.6+0.4*this.alpha));
    this.chevron.mainPass.baseColor=new vec4(CHEVRON_TINT.x,CHEVRON_TINT.y,CHEVRON_TINT.z,this.alpha);
  }
}
