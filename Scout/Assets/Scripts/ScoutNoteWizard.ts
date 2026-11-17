import {Interactable} from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import {addBackPlateHover} from "./ScoutHover";
import {BackPlate} from "UIKit.lspkg/Scripts/BackPlate";
import {RoundedRectangle} from "UIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle";
import {IMAGE_MATERIAL_ASSET} from "UIKit.lspkg/Scripts/Utility/Assets";
import {buildNotebookBody} from "./ScoutNotebookMesh";
import {NoteAssetState,SHOT_TYPE_STEPS,MOVEMENT_STEPS,PHOTO_SHOT_TYPE_STEPS,PHOTO_ANGLE_STEPS,SCENE_PLACES,TIME_OF_DAY,NOTE_TEXT_MAX} from "./ScoutAssetState";

const TRASH_ICON=requireAsset("../Icons/delete.png") as Texture;
const EDIT_ICON=requireAsset("../Icons/edit.png") as Texture;
const ARROW_ICON=requireAsset("../Icons/arrow_forward.png") as Texture;
const MOVIE_ICON=requireAsset("../Icons/movie.png") as Texture;
const PHOTO_ICON=requireAsset("../Icons/photo_camera.png") as Texture;
const NOTES_ICON=requireAsset("../Icons/edit_note.png") as Texture;
const VIDEOCAM_ICON=requireAsset("../Icons/videocam.png") as Texture;
const CHEVRON_ICON=ARROW_ICON;
const SERIF=requireAsset("../Fonts/DM Serif Display.ttf") as Font;
const HAND=requireAsset("../Fonts/Edu NSW ACT Foundation.ttf") as Font;

export type NoteWizardTheme={font:Font};

/** The reference photo a Note borrows from the nearest Camera's "capture this angle" monitor. */
export type NoteReference={
  /** The camera's label, e.g. "Camera 01". */
  camera:string;
  state:"empty"|"guiding"|"captured"|"stale";
  /** The photo, once captured. */
  texture:Texture|null;
  /** Starts (or retakes) the capture on that camera. */
  capture:()=>void;
};

// Palette: the lavender field-journal identity.
const PAPER=rgb(0xE9E0F5),PAPER_2=rgb(0xF4EFF9),PURPLE=rgb(0x7656B5),INK=rgb(0x393047),ACCENT=rgb(0xAA91D5);
const INK_SOFT=mix(INK,PAPER,0.38),RULE=mix(PAPER,ACCENT,0.55);
const READY=new vec4(0.84,0.93,0.84,1),READY_DOT=new vec4(0.30,0.66,0.38,1),DRAFT=mix(PAPER_2,ACCENT,0.3);
const FILM=mix(INK,PURPLE,0.25),WHITE=new vec4(1,1,1,1);

// Layout, in design centimetres; the whole card is drawn at CARD_SCALE so it sits at about the Camera
// prop's size. Every section is positioned from the card's top edge down.
const CARD_SCALE=0.8;
const W=84,PAD=5,INNER=W-PAD*2;
const RADIUS=4.5;
// How far above the dotted floor guide's top the notebook's bottom edge floats, and how far it leans
// back (degrees) so its thickness and spiral binding read as a real 3D book.
const FLOAT=3,LEAN=9;
// Text sizes (Lens Text points).
const T_TITLE=520,T_STEP=290,T_VALUE=175,T_BODY=150,T_LABEL=100,T_HAND=205;

/** A Note: a lavender spiral-bound field journal hovering above its spot. It walks through a
 * few quick picks (Shot #, framing, movement or angle, scene setup), then shows the finished page: scene
 * title and setup, shot details, the director's handwritten notes (typed with the Specs keyboard), and a
 * reference frame borrowed from the nearest camera. `scheduleDelay` is injected because this is a plain
 * class that borrows a component's createEvent. */
export class ScoutNoteWizard {
  readonly root:SceneObject;
  private card:SceneObject;
  private contentHost:SceneObject;
  private refKey="";
  private notesText:Text=null;
  constructor(parent:SceneObject,pos:vec3,private material:Material,private theme:NoteWizardTheme,private label:string,private state:NoteAssetState,private onChange:(patch:Partial<NoteAssetState>)=>void,private onEdit:()=>void,private onDelete:()=>void,private scheduleDelay:(seconds:number,fn:()=>void)=>void,private photo=false,private reference:()=>NoteReference|null=()=>null){
    // `pos` is where the pointer's tip goes; the card stands on top of its pointer.
    this.root=this.obj(parent,"Note wizard",new vec3(pos.x,pos.y,4));
    this.root.getTransform().setLocalScale(vec3.one().uniformScale(CARD_SCALE));
    this.root.createComponent("Component.Canvas");
    this.card=this.obj(this.root,"Card",new vec3(0,FLOAT,0));
    this.card.getTransform().setLocalRotation(quat.angleAxis(-LEAN*Math.PI/180,vec3.right()));
    this.rebuild();
  }

  /** Call every frame or so: redraws the reference frame when the nearby camera's photo changes. */
  refresh():void {
    if(isNull(this.root)||this.state.step!==4)return;
    const r=this.reference();
    const key=r?r.camera+"|"+r.state:"none";
    if(key!==this.refKey)this.rebuild();
  }

  private rebuild():void {
    for(let i=this.card.getChildrenCount()-1;i>=0;i--)this.card.getChild(i).destroy();
    this.notesText=null;
    // The paper is created first so it draws first: text doesn't write depth, so a page drawn after it
    // would paint over it. Its height is only known once the content is laid out, so it's filled last.
    const paperHost=this.obj(this.card,"Paper",vec3.zero());
    const shotTypes=this.photo?PHOTO_SHOT_TYPE_STEPS:SHOT_TYPE_STEPS;
    const step=this.state.step;
    let h:number;
    if(step===0)h=this.buildStepWrite();
    else if(step===1&&!this.photo)h=this.buildStepNumbers();
    else if(step<=2)h=this.buildStepChoices(this.photo?"Framing":"Framing",shotTypes,i=>this.commit({shotType:i,step:3}));
    else if(step===3)h=this.buildStepChoices(this.photo?"Angle":"Movement",this.photo?PHOTO_ANGLE_STEPS:MOVEMENT_STEPS,i=>this.commit({movementType:i,step:5}));
    else if(step===5)h=this.buildStepScene();
    else h=this.buildSummary();
    this.buildPaper(paperHost,h);
    // Step content is rebuilt from scratch, so the defensive collider sweep (stray colliders sitting in
    // front of a button would block it) re-runs each time.
    this.scheduleDelay(0.1,()=>{
      const visit=(node:SceneObject)=>{
        if(isNull(node))return;
        if(node.getComponent(Interactable.getTypeName()))return;
        node.getComponents("Physics.ColliderComponent").forEach(c=>c.enabled=false);
        for(let i=0;i<node.getChildrenCount();i++)visit(node.getChild(i));
      };visit(this.card);
    });
  }
  private commit(patch:Partial<NoteAssetState>):void {
    Object.assign(this.state,patch);
    this.onChange(patch);
    this.rebuild();
  }

  // ─── The paper: back sheets, the page, its border, the pointer and the tab ───────────────────────────
  /** The card body for content `h` tall, sitting on the pointer; content is laid out from its top. */
  private buildPaper(host:SceneObject,h:number):void {
    // A real 3D notebook: back cover, stacked pages and a spiral binding, all behind the top page.
    // The page itself sits a little behind the content plane (z<0): its backing has some thickness and
    // would otherwise hide anything laid right on top of it.
    const book=this.obj(host,"Book",new vec3(0,0,-1.05));
    buildNotebookBody(book,this.material,W,h,RADIUS,{});
    const page=this.rect(host,"Page",new vec3(0,h/2,-1),W,h,PAPER,RADIUS);
    page.border=true;page.borderSize=0.22;page.borderColor=ACCENT;
    // The notebook tab on the top edge, labelled with the note's name.
    const tab=this.obj(host,"Tab",new vec3(-W/2+17,h+3.2,-1.1));
    this.rect(tab,"Tab paper",new vec3(0,0,0),26,9.5,mix(PAPER,ACCENT,0.42),2.4);
    this.icon(tab,this.photo?PHOTO_ICON:MOVIE_ICON,new vec3(-8.5,0.6,0.2),4,INK);
    this.text(tab,this.label,new vec3(2.5,0.6,0.2),18,6,INK,T_BODY,this.theme.font,HorizontalAlignment.Center);
  }
  // ─── Steps ───────────────────────────────────────────────────────────────────────────────────────────
  /** Step 0: a fresh page with one action. */
  private buildStepWrite():number {
    const h=44;
    this.caps(this.card,this.photo?"PHOTO LIST":"SHOT LIST",new vec3(0,h-8,0.3),INK_SOFT,HorizontalAlignment.Center);
    this.text(this.card,"New note",new vec3(0,h-17,0.3),INNER,12,INK,T_STEP,SERIF,HorizontalAlignment.Center);
    this.pill(this.card,"Start note",new vec3(0,10,0.3),40,10,PURPLE,WHITE,EDIT_ICON,()=>this.commit({step:this.firstStep()}));
    this.headerActions(h);
    return h;
  }
  /** Step 1 (video): the shot number. */
  private buildStepNumbers():number {
    const h=74;
    this.stepHeader(h,"Shot number","1 OF 4");
    const cols=5,cellW=INNER/cols,cellH=14;
    for(let n=1;n<=10;n++){
      const i=n-1,col=i%cols,row=Math.floor(i/cols);
      const x=-INNER/2+cellW*(col+0.5),y=h-36-row*(cellH+2);
      const sel=n===this.state.shotNumber;
      this.tile(this.card,"Number"+n,new vec3(x,y,0.3),cellW-2,cellH,sel,()=>this.commit({shotNumber:n,step:2}),tile=>{
        this.text(tile,String(n),new vec3(0,0,0.3),cellW-4,cellH-2,sel?WHITE:INK,T_STEP*0.8,SERIF,HorizontalAlignment.Center);
      });
    }
    this.backButton(h);
    return h;
  }
  /** Framing / movement / angle: icon tiles; tapping one picks it and moves on. */
  private buildStepChoices(title:string,steps:{label:string;icon:Texture}[],onPick:(index:number)=>void):number {
    const cols=steps.length>4?3:steps.length,rows=Math.ceil(steps.length/cols);
    const cellW=INNER/cols,cellH=19;
    const h=40+rows*(cellH+2.5)+4;
    const n=this.photo?(this.state.step===2?"1 OF 3":"2 OF 3"):(this.state.step===2?"2 OF 4":"3 OF 4");
    this.stepHeader(h,title,n);
    const current=this.state.step===2?this.state.shotType:this.state.movementType;
    steps.forEach((s,i)=>{
      const col=i%cols,row=Math.floor(i/cols);
      const x=-INNER/2+cellW*(col+0.5),y=h-38-row*(cellH+2.5);
      const sel=i===current;
      this.tile(this.card,"Choice"+i,new vec3(x,y,0.3),cellW-2.5,cellH,sel,()=>onPick(i),tile=>{
        this.icon(tile,s.icon,new vec3(0,3.2,0.3),6,sel?WHITE:INK);
        this.text(tile,s.label,new vec3(0,-4.8,0.3),cellW-4,5,sel?WHITE:INK,T_LABEL+10,this.theme.font,HorizontalAlignment.Center);
      });
    });
    this.backButton(h);
    return h;
  }
  /** Step 5: scene setup — interior or exterior, and the time of day. */
  private buildStepScene():number {
    const h=82;
    this.stepHeader(h,"Scene setup",this.photo?"3 OF 3":"4 OF 4");
    this.caps(this.card,"LOCATION",new vec3(-INNER/2,h-33,0.3),INK_SOFT);
    const placeW=(INNER-3)/2;
    SCENE_PLACES.forEach((p,i)=>{
      const sel=this.state.interior===i;
      this.tile(this.card,"Place"+i,new vec3(-INNER/2+placeW/2+i*(placeW+3),h-41,0.3),placeW,9,sel,()=>this.commit({interior:sel?null:i}),tile=>{
        this.text(tile,p,new vec3(0,0,0.3),placeW-2,7,sel?WHITE:INK,T_VALUE,this.theme.font,HorizontalAlignment.Center);
      });
    });
    this.caps(this.card,"TIME OF DAY",new vec3(-INNER/2,h-51,0.3),INK_SOFT);
    const todW=(INNER-6)/3;
    TIME_OF_DAY.forEach((t,i)=>{
      const sel=this.state.timeOfDay===i;
      this.tile(this.card,"Time"+i,new vec3(-INNER/2+todW/2+i*(todW+3),h-59,0.3),todW,9,sel,()=>this.commit({timeOfDay:sel?null:i}),tile=>{
        this.text(tile,t,new vec3(0,0,0.3),todW-2,7,sel?WHITE:INK,T_LABEL+12,this.theme.font,HorizontalAlignment.Center);
      });
    });
    this.pill(this.card,"Done",new vec3(W/2-PAD-13,9,0.3),26,9,PURPLE,WHITE,null,()=>this.commit({step:4}));
    this.backButton(h);
    return h;
  }

  // ─── The finished page ───────────────────────────────────────────────────────────────────────────────
  private buildSummary():number {
    const types=this.photo?PHOTO_SHOT_TYPE_STEPS:SHOT_TYPE_STEPS,moves=this.photo?PHOTO_ANGLE_STEPS:MOVEMENT_STEPS;
    const type=this.state.shotType!==null?types[this.state.shotType]:null;
    const move=this.state.movementType!==null?moves[this.state.movementType]:null;
    const h=124;
    const top=h;
    const L=-INNER/2;
    // Header: production line, the scene title, its setup line.
    this.caps(this.card,this.photo?"PHOTO SHOOT":"PRODUCTION",new vec3(L,top-7,0.3),INK_SOFT);
    const title=this.photo?(type?.label??"Photo"):"Shot "+pad2(this.state.shotNumber);
    this.fit(this.text(this.card,title,new vec3(L+28,top-16.5,0.3),56,13,INK,T_TITLE,SERIF,HorizontalAlignment.Left));
    const setup=[this.state.interior!=null?SCENE_PLACES[this.state.interior]:null,this.state.timeOfDay!=null?TIME_OF_DAY[this.state.timeOfDay]:null].filter(x=>!!x);
    this.caps(this.card,setup.length?setup.join("  •  "):"SCENE SETUP NOT SET",new vec3(L,top-25.5,0.3),setup.length?INK:INK_SOFT);
    this.headerActions(h);
    this.rule(this.card,top-30);
    // Shot details: two scannable cards, with the page's status.
    this.icon(this.card,VIDEOCAM_ICON,new vec3(L+2,top-35.5,0.3),3.6,INK);
    this.caps(this.card,"SHOT DETAILS",new vec3(L+5.5,top-35.5,0.3),INK);
    const ready=!!type&&!!move;
    const pill=this.obj(this.card,"Status",new vec3(W/2-PAD-9,top-35.5,0.3));
    this.rect(pill,"Status bg",vec3.zero(),18,6.2,ready?READY:DRAFT,3.1);
    this.dot(pill,new vec3(-5.6,0,0.2),0.9,ready?READY_DOT:ACCENT);
    this.text(pill,ready?"Ready":"Draft",new vec3(1.6,0,0.2),12,5,INK,T_BODY-4,this.theme.font,HorizontalAlignment.Center);
    const cardW=(INNER-3)/2;
    this.detail(this.card,new vec3(L+cardW/2,top-46,0.2),cardW,"FRAMING",type?.label??"—",type?.icon??null);
    this.detail(this.card,new vec3(L+cardW*1.5+3,top-46,0.2),cardW,this.photo?"ANGLE":"MOVEMENT",move?.label??"—",move?.icon??null);
    // Director's notes: a ruled writing area; tap it to type.
    this.icon(this.card,NOTES_ICON,new vec3(L+2,top-57.5,0.3),3.8,INK);
    this.caps(this.card,"DIRECTOR'S NOTES",new vec3(L+5.5,top-57.5,0.3),INK);
    this.notesArea(new vec3(0,top-69.5,0.2),INNER,19);
    // Reference frame from the nearest camera.
    this.referenceArea(new vec3(0,top-94,0.2),INNER,22);
    // Footer: page number and the primary action.
    this.rule(this.card,top-108.5);
    this.caps(this.card,"FIELD JOURNAL  •  PAGE "+pad2(pageOf(this.label)),new vec3(L,top-116,0.3),INK_SOFT);
    this.pill(this.card,"Edit Note",new vec3(W/2-PAD-14,top-116,0.3),28,8.5,PURPLE,WHITE,EDIT_ICON,()=>this.commit({step:this.firstStep()}));
    return h;
  }
  /** One shot-detail card: a small caps label over the value, with its icon. */
  private detail(parent:SceneObject,pos:vec3,w:number,label:string,value:string,icon:Texture|null):void {
    const so=this.obj(parent,label,pos);
    this.rect(so,"bg",vec3.zero(),w,13,PAPER_2,2.4);
    if(icon)this.icon(so,icon,new vec3(-w/2+5,0,0.2),5,INK);
    this.caps(so,label,new vec3(-w/2+9.5,2.6,0.2),INK_SOFT);
    this.text(so,value,new vec3(-w/2+9.5+(w-12)/2,-2.4,0.2),w-12,6,INK,T_VALUE,this.theme.font,HorizontalAlignment.Left);
  }
  /** The director's notes, in a handwriting font on faint rules. Tapping opens the Specs keyboard. */
  private notesArea(pos:vec3,w:number,h:number):void {
    const so=this.obj(this.card,"Director's notes",pos);
    const back=this.button(so,w,h,PAPER_2,3,()=>this.openKeyboard());
    for(let i=0;i<2;i++)this.bar(so,new vec3(0,h/2-7.5-i*6,0.15),w-8,0.18,RULE);
    const has=!!this.state.notes&&this.state.notes.trim().length>0;
    this.notesText=this.text(so,has?this.state.notes:"Tap to write a note…",new vec3(0,0,0.3),w-8,h-4,has?INK:INK_SOFT,T_HAND,HAND,HorizontalAlignment.Left);
    this.notesText.horizontalOverflow=HorizontalOverflow.Wrap;
    this.notesText.verticalOverflow=VerticalOverflow.Shrink;
    this.notesText.verticalAlignment=VerticalAlignment.Top;
    void back;
  }
  private openKeyboard():void {
    try{
      require("LensStudio:TextInputModule");
      const options=new TextInputSystem.KeyboardOptions();
      options.enablePreview=true;
      options.keyboardType=TextInputSystem.KeyboardType.Text;
      options.returnKeyType=TextInputSystem.ReturnKeyType.Done;
      options.initialText=this.state.notes??"";
      options.onTextChanged=(text:string)=>{
        const t=text.slice(0,NOTE_TEXT_MAX);
        this.state.notes=t;this.onChange({notes:t});
        if(this.notesText&&!isNull(this.notesText)){
          this.notesText.text=t.trim()?t:"Tap to write a note…";
          this.notesText.textFill.color=t.trim()?INK:INK_SOFT;
        }
      };
      options.onReturnKeyPressed=()=>global.textInputSystem.dismissKeyboard();
      options.onError=(_c:number,d:string)=>console.warn("Scout note keyboard: "+d);
      global.textInputSystem.requestKeyboard(options);
    }catch(e){console.warn("Scout note keyboard unavailable: "+e);}
  }
  /** The nearest camera's reference photo on a strip of film, with an action to capture or retake it. */
  private referenceArea(pos:vec3,w:number,h:number):void {
    const r=this.reference();
    this.refKey=r?r.camera+"|"+r.state:"none";
    const so=this.obj(this.card,"Reference frame",pos);
    this.rect(so,"bg",vec3.zero(),w,h,PAPER_2,3);
    // Film strip: a dark band with perforations above and below the frame.
    const fw=30,fx=-w/2+fw/2+2;
    const film=this.obj(so,"Film",new vec3(fx,0,0.15));
    this.rect(film,"strip",vec3.zero(),fw,h-3,FILM,1.2);
    for(let i=0;i<6;i++)for(const sy of [-1,1])this.rect(film,"perf",new vec3(-fw/2+3+i*4.8,sy*(h/2-3.2),0.1),2,1.3,mix(FILM,PAPER,0.55),0.4);
    const photo=r&&r.texture&&(r.state==="captured"||r.state==="stale");
    const imgW=fw-4,imgH=h-10;
    if(photo){
      const img=this.icon(film,r.texture,new vec3(0,0,0.2),1,WHITE);
      img.getTransform().setLocalScale(new vec3(imgW,imgH,1));
    }else{
      this.rect(film,"empty",new vec3(0,0,0.15),imgW,imgH,mix(FILM,PAPER,0.2),0.6);
      this.icon(film,PHOTO_ICON,new vec3(0,0,0.25),5,mix(FILM,PAPER,0.6));
    }
    const tx=fx+fw/2+4,tw=w-fw-19;
    this.caps(so,"REFERENCE FRAME",new vec3(tx,5.2,0.2),INK_SOFT);
    const titleT=!r?"No camera yet":photo?r.camera+" angle":"No reference yet";
    const sub=!r?"Place a camera to take one":r.state==="stale"?"Angle changed · retake":photo?(this.photo?"Captured · 3:2":"Captured · 16:9"):r.state==="guiding"?"Walk to the camera…":"Capture from "+r.camera;
    this.fit(this.text(so,titleT,new vec3(tx+tw/2,0,0.2),tw,6,INK,T_VALUE,SERIF,HorizontalAlignment.Left));
    this.fit(this.text(so,sub,new vec3(tx+tw/2,-5,0.2),tw,5,INK_SOFT,T_LABEL+10,this.theme.font,HorizontalAlignment.Left));
    if(r&&r.state!=="guiding"){
      const go=this.obj(so,"Capture",new vec3(w/2-7,0,0.2));
      this.button(go,8.5,8.5,PAPER,4.25,()=>r.capture());
      this.icon(go,CHEVRON_ICON,new vec3(0,0,0.3),5,PURPLE);
    }
  }

  // ─── Shared pieces ───────────────────────────────────────────────────────────────────────────────────
  /** Question-step header: progress caps, the step title in serif, back on the left. */
  private stepHeader(h:number,title:string,progress:string):void {
    this.caps(this.card,(this.photo?"NEW PHOTO NOTE":"NEW SHOT NOTE")+"  •  "+progress,new vec3(-INNER/2+11,h-8,0.3),INK_SOFT);
    this.text(this.card,title,new vec3(-INNER/2+11+30,h-17,0.3),60,12,INK,T_STEP,SERIF,HorizontalAlignment.Left);
    this.headerActions(h);
    this.rule(this.card,h-25);
  }
  /** Move (edit) and delete, grouped at the top right. */
  private headerActions(h:number):void {
    this.round(this.card,"EditBadge",new vec3(W/2-PAD-14,h-11,0.3),EDIT_ICON,PURPLE,this.onEdit);
    this.round(this.card,"DeleteBadge",new vec3(W/2-PAD-4,h-11,0.3),TRASH_ICON,PURPLE,this.onDelete);
  }
  /** Back one question; from the first question, back to the finished page (if any) or a fresh page. */
  private backButton(h:number):void {
    const step=this.state.step;
    const finished=this.state.shotType!==null&&this.state.movementType!==null;
    const target=(step===5?3:step>this.firstStep()?(this.photo&&step===3?2:step-1):(finished?4:0)) as NoteAssetState["step"];
    const so=this.obj(this.card,"Back",new vec3(-INNER/2+4,h-12.5,0.3));
    this.button(so,8,8,PAPER_2,4,()=>this.commit({step:target}));
    const ic=this.icon(so,ARROW_ICON,new vec3(0,0,0.3),4.6,INK);
    ic.getTransform().setLocalRotation(quat.angleAxis(Math.PI,vec3.forward()));
  }
  private firstStep():1|2 {return this.photo?2:1;}

  /** A selectable tile: filled purple when selected, light paper otherwise. */
  private tile(parent:SceneObject,name:string,pos:vec3,w:number,h:number,selected:boolean,onTap:()=>void,fill:(so:SceneObject)=>void):void {
    const so=this.obj(parent,name,pos);
    this.button(so,w,h,selected?PURPLE:PAPER_2,2.4,onTap);
    fill(so);
  }
  /** A pill button with an optional leading icon. */
  private pill(parent:SceneObject,label:string,pos:vec3,w:number,h:number,bg:vec4,fg:vec4,icon:Texture|null,onTap:()=>void):void {
    const so=this.obj(parent,label,pos);
    this.button(so,w,h,bg,h/2,onTap);
    if(icon){
      this.icon(so,icon,new vec3(-w/2+5.5,0,0.3),4,fg);
      this.text(so,label,new vec3(3,0,0.3),w-10,h-2,fg,T_VALUE,this.theme.font,HorizontalAlignment.Center);
    }else this.text(so,label,new vec3(0,0,0.3),w-4,h-2,fg,T_VALUE,this.theme.font,HorizontalAlignment.Center);
  }
  /** A round icon button. */
  private round(parent:SceneObject,name:string,pos:vec3,icon:Texture,tint:vec4,onTap:()=>void):void {
    const so=this.obj(parent,name,pos);
    this.button(so,8.5,8.5,PAPER_2,4.25,onTap);
    this.icon(so,icon,new vec3(0,0,0.3),4.8,tint);
  }
  /** A tappable rounded rectangle (UIKit BackPlate) with a gentle hover. */
  private button(so:SceneObject,w:number,h:number,color:vec4,radius:number,onTap:()=>void):BackPlate {
    const back=so.createComponent(BackPlate.getTypeName()) as BackPlate;
    back.style="simple";back.size=new vec2(w,h);
    back.onInitialized.add(()=>{
      const rect=(back as unknown as {roundedRectangle:RoundedRectangle}).roundedRectangle;
      rect.gradient=false;rect.backgroundColor=color;rect.cornerRadius=radius;
      back.interactionPlane.enabled=false;
      back.interactable.onTriggerEnd.add(()=>onTap());
      addBackPlateHover(back,so,color);
    });
    return back;
  }
  /** A plain (non-interactive) rounded rectangle. */
  private rect(parent:SceneObject,name:string,pos:vec3,w:number,h:number,color:vec4,radius:number):RoundedRectangle {
    const so=this.obj(parent,name,pos);
    const r=so.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle;
    r.initialize();
    r.size=new vec2(w,h);r.cornerRadius=radius;r.gradient=false;r.backgroundColor=color;
    return r;
  }
  private rule(parent:SceneObject,y:number):void {this.bar(parent,new vec3(0,y,0.15),INNER,0.22,RULE);}
  private bar(parent:SceneObject,pos:vec3,w:number,h:number,color:vec4):void {this.rect(parent,"Rule",pos,w,h,color,0);}
  private dot(parent:SceneObject,pos:vec3,r:number,color:vec4):void {this.rect(parent,"Dot",pos,r*2,r*2,color,r);}
  /** Small tracked capitals for section labels and metadata, left-aligned at `pos`. */
  private caps(parent:SceneObject,value:string,pos:vec3,color:vec4,align:HorizontalAlignment=HorizontalAlignment.Left):Text {
    const w=70;
    const x=align===HorizontalAlignment.Left?pos.x+w/2:pos.x;
    const t=this.text(parent,value,new vec3(x,pos.y,pos.z),w,4,color,T_LABEL,this.theme.font,align);
    t.letterSpacing=0.12;
    return t;
  }
  /** Shrinks a one-line label to its box instead of spilling past it. */
  private fit(t:Text):Text {t.horizontalOverflow=HorizontalOverflow.Shrink;return t;}
  private icon(parent:SceneObject,tex:Texture,pos:vec3,size:number,tint:vec4):SceneObject {
    const so=this.obj(parent,"Icon",pos);
    const img=so.createComponent("Component.Image") as Image;
    img.mainMaterial=IMAGE_MATERIAL_ASSET.clone();
    img.mainPass.baseTex=tex;img.mainPass.baseColor=tint;
    so.getTransform().setLocalScale(new vec3(size,size,1));
    return so;
  }
  private meshBuilder():MeshBuilder {
    const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
    b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;return b;
  }
  private obj(parent:SceneObject,name:string,pos:vec3):SceneObject {
    const so=global.scene.createSceneObject(name);so.setParent(parent);so.getTransform().setLocalPosition(pos);return so;
  }
  private text(parent:SceneObject,value:string,pos:vec3,w:number,h:number,color:vec4,size:number,font:Font,align:HorizontalAlignment):Text {
    const so=this.obj(parent,"Text",pos);
    const t=so.createComponent("Component.Text") as Text;
    t.text=value;t.depthTest=true;t.font=font;t.size=size;t.textFill.color=color;
    t.horizontalAlignment=align;t.verticalAlignment=VerticalAlignment.Center;
    t.horizontalOverflow=HorizontalOverflow.Overflow;t.verticalOverflow=VerticalOverflow.Overflow;
    t.layoutRect=Rect.create(-w/2,w/2,-h/2,h/2);
    return t;
  }
}

function rgb(hex:number):vec4 {return new vec4(((hex>>16)&255)/255,((hex>>8)&255)/255,(hex&255)/255,1);}
function mix(a:vec4,b:vec4,t:number):vec4 {return vec4.lerp(a,b,t);}
function pad2(n:number):string {return n<10?"0"+n:String(n);}
/** The page number: the trailing number of the note's label ("Note 04" → 4). */
function pageOf(label:string):number {return Number(label.match(/(\d+)$/)?.[1])||1;}
