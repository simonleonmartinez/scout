import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import {addBackPlateHover} from "./ScoutHover";
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate";
import {IMAGE_MATERIAL_ASSET} from "SpectaclesUIKit.lspkg/Scripts/Utility/Assets";
import {addBox} from "./ScoutMarkerMesh";
import {NoteAssetState, SHOT_TYPE_STEPS, MOVEMENT_STEPS, PHOTO_SHOT_TYPE_STEPS, PHOTO_ANGLE_STEPS} from "./ScoutAssetState";

const CLOSE_ICON=requireAsset("../Icons/close.png") as Texture;
const EDIT_ICON=requireAsset("../Icons/edit.png") as Texture;

export type NoteWizardTheme={
  font:Font;
  textColor:vec4;
  accent:vec4;
  idleColor:vec4;
  hoverColor:vec4;
  activeColor:vec4;
  panelColor:vec4;
};

// Sized to sit alongside the Camera/Light props rather than dwarf them — roughly the Camera's own
// footprint width, with the whole pin+card assembly (see NOTE_PIN_HEIGHT in ScoutMarkerMesh) topping
// out at about the Camera's own height. Font sizes below are deliberately NOT scaled down by the same
// amount as the panel — they stay large and a little oversized for their cells (Overflow intentionally
// lets them spill slightly), since that big chunky lettering was the one thing worth keeping.
const PANEL_W=80,PANEL_H=90;
const HEADER_H=28;
// Notepad-only decoration colors, kept out of NoteWizardTheme since nothing else in the project uses
// a paper look — lavender/grey family throughout, no blue or cyan anywhere in this asset.
const HEADER_BAND=new vec4(0.74,0.70,0.82,1);
const RULE_LINE=new vec4(0.79,0.76,0.86,1);
const SPIRAL_RING=new vec4(0.52,0.49,0.58,1);

/** The Note asset's entire interface: a step-by-step notepad (shot #, shot type, movement) with a
 * spiral-bound top edge and ruled lines, so it reads as a physical notepad rather than a UI panel.
 * Mounted like the Camera/Light control panels — on the marker's operator-facing side — so it's usable
 * the instant it's placed. `scheduleDelay` is injected rather than self-created: this is a plain class,
 * not a component, so it borrows the caller's (a real BaseScriptComponent's) createEvent access for the
 * one timed callback. */
export class ScoutNoteWizard {
  readonly root:SceneObject;
  private contentHost:SceneObject;
  constructor(parent:SceneObject,pos:vec3,private material:Material,private theme:NoteWizardTheme,label:string,private state:NoteAssetState,private onChange:(patch:Partial<NoteAssetState>)=>void,onEdit:()=>void,onDelete:()=>void,private scheduleDelay:(seconds:number,fn:()=>void)=>void,private photo=false){
    this.root=this.obj(parent,"Note wizard",new vec3(pos.x,pos.y,4));
    this.root.createComponent("Component.Canvas");
    const back=this.root.createComponent(BackPlate.getTypeName()) as BackPlate;
    back.style="simple";
    back.size=new vec2(PANEL_W,PANEL_H);
    back.onInitialized.add(()=>{
      this.style(back,theme.panelColor,4);
      back.interactable.enabled=false;
      back.interactionPlane.enabled=false;
    });
    this.buildNotepadDressing();
    this.text(this.root,label,new vec3(0,PANEL_H/2-HEADER_H/2,0.3),PANEL_W-24,HEADER_H-6,theme.textColor,105);
    this.iconBadge(this.root,"DeleteBadge",new vec3(PANEL_W/2-6,PANEL_H/2-HEADER_H/2,0.4),CLOSE_ICON,theme.activeColor,onDelete);
    this.iconBadge(this.root,"EditBadge",new vec3(PANEL_W/2-15,PANEL_H/2-HEADER_H/2,0.4),EDIT_ICON,theme.accent,onEdit);
    this.contentHost=this.obj(this.root,"WizardContent",new vec3(0,-HEADER_H/2-3.5,0.3));
    this.rebuild();
  }
  /** Purely decorative: a darker "cardboard backing" band across the top with a row of spiral-binding
   * rings punched through it, plus a few ruled lines further down — the cues that read as "notepad"
   * rather than "gear control panel" (which is what the Camera/Light dial panels intentionally look
   * like instead). All flat, unlit-material shapes layered just in front of the paper background. */
  private buildNotepadDressing():void {
    const band=this.obj(this.root,"HeaderBand",new vec3(0,PANEL_H/2-HEADER_H/2,0.12));
    this.flatRect(band,PANEL_W,HEADER_H,HEADER_BAND);
    const ringCount=9,ringSpan=PANEL_W-12;
    for(let i=0;i<ringCount;i++){
      const x=-ringSpan/2+ringSpan*(i/(ringCount-1));
      const ring=this.obj(this.root,"SpiralRing"+i,new vec3(x,PANEL_H/2,0.18));
      this.flatCircle(ring,1.4,SPIRAL_RING);
    }
    // Confined to a narrow strip right under the header, above where any step's title ever renders
    // (root-space y stays <= ~8.5 across every step) — otherwise a line drawn behind a bare title (no
    // opaque backing, unlike the buttons/cells) visually slices straight through the text.
    const ruleCount=2,top=PANEL_H/2-HEADER_H-2,bottom=PANEL_H/2-HEADER_H-7;
    for(let i=0;i<ruleCount;i++){
      const y=top-(top-bottom)*(i/(ruleCount-1));
      const rule=this.obj(this.root,"RuleLine"+i,new vec3(0,y,0.12));
      this.flatRect(rule,PANEL_W-10,0.35,RULE_LINE);
    }
  }
  private rebuild():void {
    for(let i=this.contentHost.getChildrenCount()-1;i>=0;i--)this.contentHost.getChild(i).destroy();
    // Photo shoots: no shot number (no running order), photo shot types, and camera angle instead of
    // camera movement.
    const shotTypes=this.photo?PHOTO_SHOT_TYPE_STEPS:SHOT_TYPE_STEPS;
    if(this.state.step===0)this.buildStepWrite();
    else if(this.state.step===1&&!this.photo)this.buildStepNumberGrid();
    else if(this.state.step<=2)this.buildStepChoices("Shot Type",shotTypes,i=>this.commit({shotType:i,step:3}));
    else if(this.state.step===3)this.buildStepChoices(this.photo?"Angle":"Movement",this.photo?PHOTO_ANGLE_STEPS:MOVEMENT_STEPS,i=>this.commit({movementType:i,step:4}));
    else this.buildSummary();
    // Step content is rebuilt from scratch on every transition, so the defensive collider sweep (stray
    // BackPlate colliders would otherwise sit in front of a button and block it) must re-run each time
    // too, not just once at construction like the static Camera/Light panels.
    this.scheduleDelay(0.1,()=>{
      const visit=(node:SceneObject)=>{
        if(isNull(node))return; // Clear/recover may destroy the note before this delayed sweep.
        if(node.getComponent(Interactable.getTypeName()))return;
        node.getComponents("Physics.ColliderComponent").forEach(c=>c.enabled=false);
        for(let i=0;i<node.getChildrenCount();i++)visit(node.getChild(i));
      };visit(this.contentHost);
    });
  }
  private commit(patch:Partial<NoteAssetState>):void {
    Object.assign(this.state,patch);
    this.onChange(patch);
    this.rebuild();
  }
  /** Step 0: nothing but a single "Write note?" button. */
  private buildStepWrite():void {
    const btn=this.obj(this.contentHost,"Write note button",new vec3(0,4,0));
    const back=btn.createComponent(BackPlate.getTypeName()) as BackPlate;
    back.style="simple";
    back.size=new vec2(PANEL_W-20,28);
    back.onInitialized.add(()=>{
      this.style(back,this.theme.idleColor,3);
      back.interactionPlane.enabled=false;
      back.interactable.onTriggerEnd.add(()=>this.commit({step:this.firstStep()}));
      addBackPlateHover(back,btn,this.theme.idleColor);
    });
    this.text(btn,"Write note?",new vec3(0,0,0.3),PANEL_W-28,17,this.theme.textColor,124);
  }
  /** Step 1: a grid of shot numbers 1-10 — tap one to pick it and advance immediately, same pattern as
   * the shot-type/movement grids below (a slider read poorly and was fiddly to grab precisely). */
  private buildStepNumberGrid():void {
    this.text(this.contentHost,"Shot #",new vec3(0,30,0.2),PANEL_W-15,9,this.theme.textColor,100);
    const cols=5,rows=2,total=10;
    const cellW=(PANEL_W-12)/cols,cellH=22;
    const gridW=cellW*cols;
    const topRowY=8,rowSpacing=cellH;
    for(let n=1;n<=total;n++){
      const i=n-1,col=i%cols,row=Math.floor(i/cols);
      const x=-gridW/2+cellW*(col+0.5);
      const y=topRowY-row*rowSpacing;
      const cell=this.obj(this.contentHost,"Number"+n,new vec3(x,y,0));
      const back=cell.createComponent(BackPlate.getTypeName()) as BackPlate;
      back.style="simple";
      back.size=new vec2(cellW-1.5,cellH-2);
      const selected=n===this.state.shotNumber;
      back.onInitialized.add(()=>{
        this.style(back,selected?this.theme.activeColor:this.theme.idleColor,2);
        back.interactionPlane.enabled=false;
        back.interactable.onTriggerEnd.add(()=>this.commit({shotNumber:n,step:2}));
        addBackPlateHover(back,cell,selected?this.theme.activeColor:this.theme.idleColor);
      });
      this.text(cell,String(n),new vec3(0,0,0.3),cellW-3,cellH-3,this.theme.textColor,90);
    }
  }
  /** Steps 2 & 3: a row of icon choices; tapping one selects it and advances immediately. */
  private buildStepChoices(title:string,steps:{label:string;icon:Texture}[],onPick:(index:number)=>void):void {
    this.text(this.contentHost,title,new vec3(0,30,0.2),PANEL_W-15,9,this.theme.textColor,100);
    const cols=steps.length>4?3:steps.length;
    const rows=Math.ceil(steps.length/cols);
    const cellW=(PANEL_W-8)/cols,cellH=25;
    const gridW=cellW*cols;
    const topRowY=rows>1?9:1,rowSpacing=cellH;
    steps.forEach((s,i)=>{
      const col=i%cols,row=Math.floor(i/cols);
      const x=-gridW/2+cellW*(col+0.5);
      const y=topRowY-row*rowSpacing;
      const cell=this.obj(this.contentHost,"Choice"+i,new vec3(x,y,0));
      const back=cell.createComponent(BackPlate.getTypeName()) as BackPlate;
      back.style="simple";
      back.size=new vec2(cellW-3,cellH-2);
      back.onInitialized.add(()=>{
        this.style(back,this.theme.idleColor,2);
        back.interactionPlane.enabled=false;
        back.interactable.onTriggerEnd.add(()=>onPick(i));
        addBackPlateHover(back,cell,this.theme.idleColor);
      });
      const iconHost=this.obj(cell,"Icon",new vec3(0,4,0.3));
      const img=iconHost.createComponent("Component.Image") as Image;
      img.mainMaterial=IMAGE_MATERIAL_ASSET.clone();
      img.mainPass.baseTex=s.icon;img.mainPass.baseColor=this.theme.textColor;
      iconHost.getTransform().setLocalScale(new vec3(4,4,1));
      this.text(cell,s.label,new vec3(0,-7,0.3),cellW-4,6,this.theme.textColor,72);
    });
  }
  /** After the last step: a compact read-only summary, matching how every other asset ends up with a
   * static label once its settings are set. */
  private buildSummary():void {
    const types=this.photo?PHOTO_SHOT_TYPE_STEPS:SHOT_TYPE_STEPS,moves=this.photo?PHOTO_ANGLE_STEPS:MOVEMENT_STEPS;
    const type=this.state.shotType!==null?types[this.state.shotType]?.label??"?":"?";
    const move=this.state.movementType!==null?moves[this.state.movementType]?.label??"?":"?";
    if(this.photo){
      // No shot number on a photo shoot — the shot type leads instead.
      this.text(this.contentHost,type,new vec3(0,17,0.2),PANEL_W-15,18,this.theme.accent,130);
      this.text(this.contentHost,move,new vec3(0,0,0.2),PANEL_W-15,11,this.theme.textColor,92);
    }else{
      this.text(this.contentHost,"Shot "+this.state.shotNumber,new vec3(0,17,0.2),PANEL_W-15,18,this.theme.accent,145);
      this.text(this.contentHost,type+" · "+move,new vec3(0,0,0.2),PANEL_W-15,11,this.theme.textColor,92);
    }
    const redo=this.obj(this.contentHost,"Redo",new vec3(0,-19,0.1));
    const back=redo.createComponent(BackPlate.getTypeName()) as BackPlate;
    back.style="simple";back.size=new vec2(30,12);
    back.onInitialized.add(()=>{
      this.style(back,this.theme.idleColor,2);
      back.interactionPlane.enabled=false;
      back.interactable.onTriggerEnd.add(()=>this.commit({step:this.firstStep()}));
      addBackPlateHover(back,redo,this.theme.idleColor);
    });
    this.text(redo,"Edit",new vec3(0,0,0.3),26,8,this.theme.textColor,72);
  }
  /** Where "Write note?" / "Edit" start: the shot number on a video shoot, the shot type on a photo shoot. */
  private firstStep():1|2 {return this.photo?2:1;}
  private iconBadge(parent:SceneObject,name:string,pos:vec3,icon:Texture,tint:vec4,onTap:()=>void):void {
    const so=this.obj(parent,name,pos);
    const back=so.createComponent(BackPlate.getTypeName()) as BackPlate;
    back.style="simple";back.size=new vec2(9,9);
    back.onInitialized.add(()=>{
      this.style(back,this.theme.idleColor,4.5);
      back.interactionPlane.enabled=false;
      back.interactable.onTriggerEnd.add(onTap);
      addBackPlateHover(back,so,this.theme.idleColor);
    });
    const iconHost=this.obj(so,"Icon",new vec3(0,0,0.4));
    const img=iconHost.createComponent("Component.Image") as Image;
    img.mainMaterial=IMAGE_MATERIAL_ASSET.clone();
    img.mainPass.baseTex=icon;img.mainPass.baseColor=tint;
    iconHost.getTransform().setLocalScale(new vec3(5,5,1));
  }
  /** Flat, unlit filled rectangle (header band / rule lines) — a thin box so it reads as a solid plane. */
  private flatRect(parent:SceneObject,w:number,h:number,color:vec4):void {
    const b=this.meshBuilder();
    const ix:number[]=[];
    addBox(b,ix,0,0,0,w/2,h/2,0.05,this.colorArr(color),0);
    b.appendIndices(ix);
    const v=parent.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    v.mesh=b.getMesh();v.mainMaterial=this.material.clone();b.updateMesh();
  }
  /** Flat filled circle (spiral-binding rings). */
  private flatCircle(parent:SceneObject,radius:number,color:vec4):void {
    const b=this.meshBuilder();
    const c=this.colorArr(color);
    const segs=16;
    b.appendVerticesInterleaved([0,0,0,0,0,1,...c]);
    for(let i=0;i<=segs;i++){const a=i*2*Math.PI/segs;b.appendVerticesInterleaved([radius*Math.cos(a),radius*Math.sin(a),0,0,0,1,...c]);}
    const ix:number[]=[];for(let i=1;i<=segs;i++)ix.push(0,i,i+1);
    b.appendIndices(ix);
    const v=parent.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    v.mesh=b.getMesh();v.mainMaterial=this.material.clone();b.updateMesh();
  }
  private style(back:BackPlate,color:vec4,radius:number):void {
    const rect=(back as unknown as {roundedRectangle:{gradient:boolean;backgroundColor:vec4;cornerRadius:number}}).roundedRectangle;
    rect.gradient=false;rect.backgroundColor=color;rect.cornerRadius=radius;
  }
  private meshBuilder():MeshBuilder {
    const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
    b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;return b;
  }
  private colorArr(c:vec4):[number,number,number,number] {return [c.x,c.y,c.z,c.w];}
  private obj(parent:SceneObject,name:string,pos:vec3):SceneObject {
    const so=global.scene.createSceneObject(name);so.setParent(parent);so.getTransform().setLocalPosition(pos);return so;
  }
  private text(parent:SceneObject,value:string,pos:vec3,w:number,h:number,color:vec4,size:number):Text {
    const so=this.obj(parent,"Text",pos);
    const t=so.createComponent("Component.Text") as Text;
    t.text=value;t.depthTest=true;t.font=this.theme.font;t.size=size;t.textFill.color=color;
    t.horizontalAlignment=HorizontalAlignment.Center;t.verticalAlignment=VerticalAlignment.Center;
    t.horizontalOverflow=HorizontalOverflow.Overflow;t.verticalOverflow=VerticalOverflow.Overflow;
    t.layoutRect=Rect.create(-w/2,w/2,-h/2,h/2);
    return t;
  }
}
