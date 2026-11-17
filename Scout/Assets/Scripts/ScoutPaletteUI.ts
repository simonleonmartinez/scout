import Event from "InteractionKit.lspkg/Utils/Event";
import animate,{CancelFunction} from "InteractionKit.lspkg/Utils/animate";
import {BackPlate} from "UIKit.lspkg/Scripts/BackPlate";
import {RoundedRectangle} from "UIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle";
import {ElementContent} from "UIKit.lspkg/Scripts/Components/Content/ElementContent";
import {FlexLayout} from "UIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout";
import {FlexItem} from "UIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem";
import {FlexAlign, FlexAlignSelf, FlexDirection, FlexJustify} from "UIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes";
import {IMAGE_MATERIAL_ASSET} from "UIKit.lspkg/Scripts/Utility/Assets";
import {ScoutRotaryDial, RotaryDialTheme, DialStep} from "./ScoutRotaryDial";
import {ScoutNoteWizard, NoteWizardTheme, NoteReference} from "./ScoutNoteWizard";
import {addBackPlateHover, addHoverFeedback} from "./ScoutHover";
import type {SavedLayoutInfo} from "./ScoutLayoutStore";
import {CameraAssetState, LightAssetState, NoteAssetState, ISO_STOPS, APERTURE_STOPS, SHUTTER_STOPS, KELVIN_STOPS, INTENSITY_STOPS, kelvinToRGB} from "./ScoutAssetState";

const ICONS: Texture[] = [requireAsset("../Icons/videocam.png") as Texture, requireAsset("../Icons/lightbulb.png") as Texture, requireAsset("../Icons/sticky_note_2.png") as Texture, requireAsset("../Icons/undo.png") as Texture, requireAsset("../Icons/delete.png") as Texture];
// The subject icon is the Violet dummy's face (Icons/dummy_face.png).
const ACTOR_ICONS:Texture[]=[requireAsset("../Icons/dummy_standing.png") as Texture,requireAsset("../Icons/dummy_seated.png") as Texture];
const HAND_ICON=requireAsset("../Icons/pan_tool.png") as Texture;
const RESET_FLOOR_ICON=requireAsset("../Icons/restart_alt.png") as Texture;
const FLOOR_RESET_ICON=requireAsset("../Icons/reset_floor.png") as Texture;
const OCCLUSION_ICON=requireAsset("../Icons/visibility.png") as Texture;
const LAYOUTS_ICON=requireAsset("../Icons/bookmarks.png") as Texture;
const SWAP_ICON=requireAsset("../Icons/swap_horiz.png") as Texture;
const MOODBOARD_ICON=requireAsset("../Icons/photo_library.png") as Texture;
const MIC_ICON=requireAsset("../Icons/mic.png") as Texture;
// Room for MAX_SAVED_LAYOUTS rows of 5 plus 1cm gaps.
const LAYOUT_ROW_H=5,LAYOUT_LIST_H=6*LAYOUT_ROW_H+5;
const LAYOUT_NAME_MAX=16;
// No 0/O or 1/I, so a code read off the glasses can't be mistyped on a phone.
const PAIRING_ALPHABET="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ARROW_ICON=requireAsset("../Icons/keyboard_arrow_down.png") as Texture;
const EDIT_ICON=requireAsset("../Icons/edit.png") as Texture;
const CLOSE_ICON=requireAsset("../Icons/close.png") as Texture;
// Deleting uses a trash can; × is kept for closing and cancelling.
const TRASH_ICON=requireAsset("../Icons/delete.png") as Texture;
const BADGE_TINT=new vec4(0x5a/255,0x44/255,0xb8/255,1);
const DELETE_TINT=new vec4(0.85,0.4,0.4,1);
const DELETE_ICON_TINT=new vec4(1,1,1,1);
const LOGO=requireAsset("../Logo/shotscout_wordmark.png") as Texture;
const MASCOT=requireAsset("../Logo/shotscout_mascot.png") as Texture;
const MASCOT_ASPECT=550/720;
const LOGO_HEIGHT=12,LOGO_WIDTH=25.4;
const PANEL_TINT=new vec4(0x3e/255,0x30/255,0x82/255,1);
const BUTTON_TINT=new vec4(0x24/255,0x17/255,0x4d/255,1);
const TEXT_TINT=new vec4(0xc1/255,0xad/255,0xff/255,1);
// Rotary dial rings read as gear, not menu — neutral gunmetal grey matching the camera/light housings,
// not the palette's purple/cyan theme.
// Idle brightened well above the panel (0.12) for a clear ring-vs-background boundary at a glance;
// hover/active step up from there so drag feedback still reads as a distinct state.
const DIAL_IDLE_TINT=new vec4(0.42,0.42,0.46,1);
const DIAL_HOVER_TINT=new vec4(0.56,0.56,0.61,1);
const DIAL_ACTIVE_TINT=new vec4(0.72,0.72,0.76,1);
const DIAL_TICK_TINT=new vec4(0.66,0.66,0.7,1);
const DIAL_PANEL_TINT=new vec4(0.1,0.1,0.11,1);
// The Note asset reads as an actual paper notepad, not equipment or menu chrome — a light lavender-grey
// page with dark text, kept strictly to the lavender/grey family (no blue or cyan anywhere in it).
// Camera angle monitor: width (cm), backward tilt (degrees), and its gear-style inks.
const ANGLE_SCREEN_W=36,ANGLE_SCREEN_TILT=12;
const ANGLE_INK=new vec4(0.93,0.88,0.78,1);
const ANGLE_INK_DIM=new vec4(0.93,0.88,0.78,0.6);
const ANGLE_SCREEN_OFF=new vec4(0.07,0.07,0.08,1);
const ANGLE_STALE_TINT=new vec4(1,0.66,0.25,1);
// Stand-in "captured" photos until the real Specs still capture is wired up.
const ANGLE_MOCK_VIDEO=requireAsset("../Textures/angle_capture_mock_video.png") as Texture;
const ANGLE_MOCK_PHOTO=requireAsset("../Textures/angle_capture_mock_photo.png") as Texture;
const PHOTO_CAMERA_ICON=requireAsset("../Icons/photo_camera.png") as Texture;
// Plain white, tinted per use, for flat shapes (frame-lines, banners, the screen when off).
const WHITE=requireAsset("../Textures/white.png") as Texture;
const PANEL_RADIUS=2.6,BUTTON_RADIUS=1.4;
const CAP_WIDTH=6,CAP_HEIGHT=14;
const TOOLBAR_ICON=6,TOOLBAR_GAP=1.2,TOOLBAR_COUNT=5;
// Selected tool: a purple ring this much wider than the button on each side (cm).
const SELECTED_RING=0.6;
const COLLAPSED_SIZE=new vec2(TOOLBAR_ICON+3,TOOLBAR_COUNT*TOOLBAR_ICON+(TOOLBAR_COUNT-1)*TOOLBAR_GAP+3);
// Reset Floor floats on its own above the tool bar, in a quieter grey, so it doesn't read as a placeable asset.
const FLOOR_BUTTON=7.5,FLOOR_GAP=3.5;
const TOOL_NAMES=["Camera","Light","Notepad","Standing","Seated","Hand"];
// A sixth, non-placeable "tool" — lets someone done placing things freely tap/drag existing markers
// without an empty-space pinch accidentally dropping a new one. Kept in sync with ScoutMain's own copy.
const HAND_KIND=5;
const THEME_FONT=requireAsset("../Fonts/Inter.ttf") as Font;
// Sized for reading in glasses with the menu ~110cm away (and scaled up again by MENU_SCALE): the
// earlier 93/52/44 read as tiny on device.
const TYPE_SCALE = {Title2:{size:110,weight:700},Body:{size:72,weight:600},Caption:{size:60,weight:500}};
// The whole floating menu (panel, buttons, icons, text) is built in cm and then enlarged by this.
const MENU_SCALE=1.15;
// ── The creative hub (expanded menu): lavender field-journal styling, shared with the Note notebook. ──
const HUB_PAPER=hex(0xE9E0F5),HUB_PAPER_2=hex(0xF4EFF9),HUB_PURPLE=hex(0x7656B5),HUB_INK=hex(0x393047),HUB_ACCENT=hex(0xAA91D5);
const HUB_INK_SOFT=vec4.lerp(HUB_INK,HUB_PAPER,0.4),HUB_RULE=vec4.lerp(HUB_PAPER,HUB_ACCENT,0.55),HUB_WHITE=new vec4(1,1,1,1);
const HUB_SERIF=requireAsset("../Fonts/DM Serif Display.ttf") as Font;
const HUB_W=52,HUB_H=72.5,HUB_PAD=3,HUB_INNER=HUB_W-HUB_PAD*2;
// Text sizes for reading the menu at ~125cm (see feedback-large-text memory): never below ~95.
const HUB_T_TILE=100,HUB_T_SEG=92,HUB_T_CAPS=92,HUB_T_STATUS=108,HUB_T_TITLE=240;
// How long Clear All waits for its confirming second tap (s).
const CLEAR_CONFIRM_SECONDS=3;
// Opening the menu: the panel unfolds out of the tool bar (OPEN_GROW s), while its sections cascade in
// from the top (each starts OPEN_STAGGER of the run later than the one above, and settles in OPEN_ITEM).
const OPEN_SECONDS=0.55,OPEN_GROW=0.5,OPEN_STAGGER=0.45,OPEN_ITEM=0.5,OPEN_RISE=2.5,CLOSE_SECONDS=0.16;
/** Overshoots a touch and settles: things pop into place rather than slide. */
function easeOutBack(t:number):number {const c=1.4;return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2);}
function hex(v:number):vec4 {return new vec4(((v>>16)&255)/255,((v>>8)&255)/255,(v&255)/255,1);}
/** WB/Kelvin dials fill their ring's hole with the color that Kelvin value represents. */
function kelvinFill(kelvin:number):vec4 {
  const rgb=kelvinToRGB(kelvin);
  return new vec4(rgb.x,rgb.y,rgb.z,1);
}
function applyTextRole(t: Text, role: keyof typeof TYPE_SCALE): void {
  t.font=THEME_FONT;
  t.size = TYPE_SCALE[role].size;
  t.textFill.color=TEXT_TINT;
  (t as Text & {weight?:number}).weight = TYPE_SCALE[role].weight;
}

/** empty: no photo yet · guiding: walking the user to the camera's spot · captured · stale: the camera
 * has moved since its photo was taken. */
export type AngleScreenState="empty"|"guiding"|"captured"|"stale";
export interface AngleScreen {
  setState(state:AngleScreenState):void;
  /** Replaces the screen's title line (guidance and countdown while guiding). */
  setStatus(text:string):void;
  /** The photo shown once the state is captured or stale. */
  setImage(texture:Texture):void;
  /** The photo it holds (or will show once captured). */
  readonly image:Texture;
}
/** Passive UIKit views for the palette and the labels attached to placed markers. */
@component
export class ScoutPaletteUI extends BaseScriptComponent {
  @input @hint("Bright accent for the current selection") @widget(new ColorWidget()) accent: vec4 = new vec4(0.45,0.9,0.95,1);
  @input @hint("Show experimental shared-session controls") showSharedControls:boolean=false;
  onSelect = new Event<number>();

  onUndo = new Event<void>();
  onClear = new Event<void>();
  onResetFloor = new Event<void>();
  onToggleOcclusion = new Event<void>();
  /** The header's shoot pill was tapped: switch between photo and video. */
  onToggleShootType = new Event<void>();
  /** Shows whether occlusion is on (the hub's toggle switch). */
  setOcclusion(on:boolean):void {this.occlusionOn=on;this.paintOcclusion();}
  private occlusionOn=false;
  private occlusionSwitch:{track:RoundedRectangle;knob:SceneObject}=null;
  onSaveLayout = new Event<void>();
  onLoadLayout = new Event<string>();
  onRenameLayout = new Event<string>();
  onVoiceRenameLayout = new Event<string>();
  onDeleteLayout = new Event<string>();
  onPinPoster = new Event<void>();
  onConnect = new Event<void>();
  onInvite = new Event<void>();
  onSave = new Event<void>();
  onRecover = new Event<void>();
  private sharedStatus:Text;
  private status: Text;
  /** The hub's tool tiles and placement segments, by tool kind (0-2 Create, 3-5 Position). */
  /** While true, textRow/button draw in the hub's light style (the menu's sub-pages); otherwise the dark
   * style used on markers and the camera monitor. */
  private light=false;
  private hubTools:{kind:number;paint:(selected:boolean)=>void}[]=[];
  private shootPill:Text=null;
  private clearLabel:Text=null;
  private clearArmed=false;
  private clearTimer:DelayedCallbackEvent=null;
  private selected = 0;
  private count = 0;
  private back:BackPlate;
  private col:SceneObject;
  private collapsedBar:SceneObject;
  private selectedRing:SceneObject=null;
  private toolYs:number[]=[];
  private cap:SceneObject;
  private capIcon:Image;
  private expandedSize:vec2;
  private collapsed=false;
  // Which page of the expanded panel is showing: the main menu, or one of its sub-pages.
  private view:"main"|"layouts"|"moodboard"="main";
  private layoutsPanel:SceneObject;
  private moodboardPanel:SceneObject;
  private layoutList:SceneObject;
  private layouts:SavedLayoutInfo[]=[];
  private layoutListRefresh:DelayedCallbackEvent;
  private shootType:"photo"|"video"=null;
  private manualCollapsed=true;
  private forcedCollapsed=false;
  get isCollapsed():boolean { return this.collapsed; }
  private subjectPose=3;
  private subjectIcon:Image|null=null;
  private badgeMaterial:Material=null;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.build());
  }
  /** Vertex-color material for the dials and note wizard — provided by ScoutMain, which already owns
   * one. Only needed once a marker is actually placed, well after start(), so no ordering gate is required. */
  setBadgeMaterial(material:Material):void { this.badgeMaterial=material; }
  private build(): void {
    this.sceneObject.getTransform().setLocalScale(vec3.one().uniformScale(MENU_SCALE));
    this.sceneObject.createComponent("Component.Canvas");
    const back = this.sceneObject.createComponent(BackPlate.getTypeName()) as BackPlate;
    this.back=back;
    back.style="simple";
    const height=HUB_H;
    this.expandedSize=new vec2(HUB_W,height);
    back.size = this.expandedSize;
    back.onInitialized.add(()=>{
      this.style(back,HUB_PAPER,PANEL_RADIUS+1);
      const rect=(back as unknown as {roundedRectangle:RoundedRectangle}).roundedRectangle;
      rect.border=true;rect.borderSize=0.25;rect.borderColor=HUB_ACCENT;
    });
    const content = this.obj(this.sceneObject,"PaletteContent",new vec3(0,0,0.6));
    this.col=this.buildHub(content);
    this.layoutsPanel=this.buildLayoutsPanel(content,height);
    this.moodboardPanel=this.buildMoodboardPanel(content,height);
    this.collapsedBar=this.buildCollapsedBar(content);
    this.buildCap(content);
    this.applyCollapsed();
    this.setState(this.selected,this.count);
  }
  // ─── The creative hub ────────────────────────────────────────────────────────────────────────────────
  /** The expanded menu's main page, laid out top to bottom: brand header, then Create (the three placeable
   * tools, most prominent), Position (Standing / Seated / Hand as one segmented control), Workspace (Saved
   * Layouts, Moodboard) and Environment (small utility chips). Every control fires the same events the
   * old button column did. */
  private buildHub(parent:SceneObject):SceneObject {
    const hub=this.obj(parent,"Hub",vec3.zero());
    const L=-HUB_INNER/2,T=HUB_H/2;
    // Header: small mascot, compact wordmark, shoot status; the live status line under it.
    this.hubImage(hub,MASCOT,new vec3(L+3,T-6.2,0.2),8*MASCOT_ASPECT,8,HUB_WHITE);
    this.hubImage(hub,LOGO,new vec3(L+6.8+8.7,T-6.2,0.2),17.4,8.2,HUB_PURPLE);
    // The shoot pill doubles as a switch: tap it to change between a photo and a video shoot.
    // (Every button sits in its own holder: the opening animation scales the holder, while the button's
    // hover grows the button itself from its true size.)
    const pill=this.obj(this.obj(hub,"Shoot holder",new vec3(HUB_INNER/2-9.5,T-6.2,0.2)),"Shoot",vec3.zero());
    const pillBack=pill.createComponent(BackPlate.getTypeName()) as BackPlate;
    pillBack.style="simple";pillBack.size=new vec2(19,5);
    pillBack.onInitialized.add(()=>{
      const rect=(pillBack as unknown as {roundedRectangle:RoundedRectangle}).roundedRectangle;
      rect.gradient=false;rect.cornerRadius=2.4;rect.backgroundColor=HUB_PAPER_2;
      rect.border=true;rect.borderSize=0.18;rect.borderColor=HUB_RULE;
      pillBack.interactionPlane.enabled=false;
      pillBack.interactable.onTriggerEnd.add(()=>{if(this.shootType)this.onToggleShootType.invoke();});
      addBackPlateHover(pillBack,pill,HUB_PAPER_2);
    });
    this.hubRect(pill,new vec3(-7.6,0,0.3),1.3,1.3,HUB_PURPLE,0.65);
    this.hubIcon(pill,SWAP_ICON,new vec3(7.2,0,0.3),3,HUB_PURPLE);
    this.shootPill=this.hubText(pill,"Setting up",new vec3(-0.3,0,0.3),11.6,4,HUB_INK,HUB_T_CAPS,THEME_FONT,HorizontalAlignment.Center);
    this.shootPill.horizontalOverflow=HorizontalOverflow.Shrink;
    this.status=this.hubText(hub,"Camera ready  ·  0 placed",new vec3(L,T-12.6,0.2),HUB_INNER,4,HUB_INK,HUB_T_STATUS,HUB_SERIF,HorizontalAlignment.Left);
    this.status.horizontalOverflow=HorizontalOverflow.Shrink;
    this.hubRule(hub,T-15.4);
    // 01 Create: the three tools.
    this.hubSection(hub,"01","CREATE",T-18.2);
    const tileW=(HUB_INNER-3)/3,tileH=11;
    ["Camera","Light","Notepad"].forEach((label,i)=>{
      this.hubTool(hub,label,ICONS[i],i,new vec3(L+tileW/2+i*(tileW+1.5),T-26,0.2),tileW,tileH,true);
    });
    // 02 Position: one segmented control.
    this.hubSection(hub,"02","POSITION",T-34);
    const segH=6.4,segW=(HUB_INNER-2)/3;
    this.hubRect(hub,new vec3(0,T-39.6,0.1),HUB_INNER,segH+1.4,HUB_PAPER_2,(segH+1.4)/2);
    // Segments are sized to their labels (Standing is the longest), so every label fits at the same size.
    let segX=L+1;
    ([["Standing",ACTOR_ICONS[0],3,1.18],["Seated",ACTOR_ICONS[1],4,1.0],["Hand",HAND_ICON,HAND_KIND,0.82]] as [string,Texture,number,number][]).forEach(([label,icon,kind,weight])=>{
      const w=segW*weight;
      this.hubTool(hub,label,icon,kind,new vec3(segX+w/2,T-39.6,0.2),w-0.8,segH,false);
      segX+=w;
    });
    // 03 Workspace: quieter secondary tools.
    this.hubSection(hub,"03","WORKSPACE",T-45.6);
    const halfW=(HUB_INNER-1.5)/2;
    this.hubRowButton(hub,"Saved Layouts",LAYOUTS_ICON,new vec3(L+halfW/2,T-51,0.2),halfW,6.4,HUB_PAPER_2,()=>this.showView("layouts"));
    this.hubRowButton(hub,"Moodboard",MOODBOARD_ICON,new vec3(L+halfW*1.5+1.5,T-51,0.2),halfW,6.4,HUB_PAPER_2,()=>this.showView("moodboard"));
    // 04 Environment: small utility chips, a 2x2 grid.
    this.hubSection(hub,"04","ENVIRONMENT",T-56.6);
    const chipH=4.8;
    const occl=this.hubRowButton(hub,"Occlusion",OCCLUSION_ICON,new vec3(L+halfW/2,T-61.4,0.2),halfW,chipH,HUB_PAPER,()=>this.onToggleOcclusion.invoke(),true);
    const sw=this.obj(occl,"Switch",new vec3(halfW/2-4,0,0.3));
    const track=this.hubRect(sw,vec3.zero(),5.6,2.8,HUB_ACCENT,1.4);
    const knob=this.obj(sw,"Knob",new vec3(-1.4,0,0.1));
    this.hubRect(knob,vec3.zero(),2.2,2.2,HUB_WHITE,1.1);
    this.occlusionSwitch={track,knob};this.paintOcclusion();
    this.hubRowButton(hub,"Reset Floor",FLOOR_RESET_ICON,new vec3(L+halfW*1.5+1.5,T-61.4,0.2),halfW,chipH,HUB_PAPER,()=>this.onResetFloor.invoke(),true);
    this.hubRowButton(hub,"Undo Last",ICONS[3],new vec3(L+halfW/2,T-66.6,0.2),halfW,chipH,HUB_PAPER,()=>this.onUndo.invoke(),true);
    const clear=this.hubRowButton(hub,"Clear All",ICONS[4],new vec3(L+halfW*1.5+1.5,T-66.6,0.2),halfW,chipH,HUB_PAPER,()=>this.tapClear(),true);
    this.clearLabel=clear.getChild(clear.getChildrenCount()-1).getComponent("Component.Text") as Text;
    // A strip of film perforations along the bottom edge: a quiet analog detail.
    for(let i=0;i<9;i++)this.hubRect(hub,new vec3(-HUB_W/2+9+i*4.4,-T+0.9,0.15),2,0.9,HUB_RULE,0.3);
    return hub;
  }
  /** Clear All asks for a second tap within a few seconds before it actually clears. */
  private tapClear():void {
    if(this.clearArmed){
      this.clearArmed=false;this.paintClear();
      this.onClear.invoke();
      return;
    }
    this.clearArmed=true;this.paintClear();
    if(!this.clearTimer){
      this.clearTimer=this.createEvent("DelayedCallbackEvent");
      this.clearTimer.bind(()=>{this.clearArmed=false;this.paintClear();});
    }
    this.clearTimer.reset(CLEAR_CONFIRM_SECONDS);
  }
  private paintClear():void {
    if(!this.clearLabel||isNull(this.clearLabel))return;
    this.clearLabel.text=this.clearArmed?"Tap to confirm":"Clear All";
    this.clearLabel.textFill.color=this.clearArmed?new vec4(0.78,0.25,0.3,1):HUB_INK;
  }
  private paintOcclusion():void {
    const s=this.occlusionSwitch;
    if(!s||isNull(s.knob))return;
    s.track.backgroundColor=this.occlusionOn?HUB_PURPLE:HUB_ACCENT;
    s.knob.getTransform().setLocalPosition(new vec3(this.occlusionOn?1.4:-1.4,0,0.1));
  }
  /** "01 CREATE": a purple serif number and tracked caps, starting at the left margin. */
  private hubSection(parent:SceneObject,num:string,title:string,y:number):void {
    const L=-HUB_INNER/2;
    this.hubText(parent,num,new vec3(L,y,0.2),4,3.4,HUB_PURPLE,HUB_T_CAPS,HUB_SERIF,HorizontalAlignment.Left);
    const t=this.hubText(parent,title,new vec3(L+4.8,y,0.2),30,3.4,HUB_INK_SOFT,HUB_T_CAPS,THEME_FONT,HorizontalAlignment.Left);
    t.letterSpacing=0.14;
  }
  /** A selectable tool: a tile (icon over title) for Create, or a segment (icon + label) for Position. */
  private hubTool(parent:SceneObject,label:string,icon:Texture,kind:number,pos:vec3,w:number,h:number,tile:boolean):void {
    const so=this.obj(this.obj(parent,label+" holder",pos),label,vec3.zero());
    const idle=new vec4(0,0,0,0);
    const base=tile?HUB_PAPER_2:HUB_PAPER_2;
    idle.x=base.x;idle.y=base.y;idle.z=base.z;idle.w=1;
    let rect:RoundedRectangle=null;
    const back=so.createComponent(BackPlate.getTypeName()) as BackPlate;
    back.style="simple";back.size=new vec2(w,h);
    const img=this.hubIcon(so,icon,tile?new vec3(0,1.9,0.3):new vec3(-w/2+3.0,0,0.3),tile?4.6:3.4,HUB_PURPLE);
    // Segment labels share one size that fits the longest ("Standing"), so none gets shrunk smaller than its siblings.
    const text=tile?this.hubText(so,label,new vec3(0,-3.1,0.3),w-1,4,HUB_INK,HUB_T_TILE,THEME_FONT,HorizontalAlignment.Center)
      :this.hubText(so,label,new vec3(-w/2+5.2,0,0.3),w-5.6,4,HUB_INK,HUB_T_SEG,THEME_FONT,HorizontalAlignment.Left);
    text.horizontalOverflow=HorizontalOverflow.Shrink;
    const paint=(selected:boolean)=>{
      const c=selected?HUB_PURPLE:(tile?HUB_PAPER_2:HUB_PAPER_2);
      idle.x=c.x;idle.y=c.y;idle.z=c.z;
      if(rect)rect.backgroundColor=c;
      text.textFill.color=selected?HUB_WHITE:HUB_INK;
      img.mainPass.baseColor=selected?HUB_WHITE:HUB_PURPLE;
    };
    back.onInitialized.add(()=>{
      rect=(back as unknown as {roundedRectangle:RoundedRectangle}).roundedRectangle;
      rect.gradient=false;rect.cornerRadius=tile?2.4:h/2;rect.backgroundColor=idle;
      back.interactionPlane.enabled=false;
      back.interactable.onTriggerEnd.add(()=>this.onSelect.invoke(kind));
      addBackPlateHover(back,so,idle);
      paint(this.selected===kind);
    });
    this.hubTools.push({kind,paint});
  }
  /** A labelled button with a leading icon (Workspace rows and Environment chips). */
  private hubRowButton(parent:SceneObject,label:string,icon:Texture,pos:vec3,w:number,h:number,color:vec4,onTap:()=>void,small=false):SceneObject {
    const so=this.obj(this.obj(parent,label+" holder",pos),label,vec3.zero());
    const back=so.createComponent(BackPlate.getTypeName()) as BackPlate;
    back.style="simple";back.size=new vec2(w,h);
    back.onInitialized.add(()=>{
      const rect=(back as unknown as {roundedRectangle:RoundedRectangle}).roundedRectangle;
      rect.gradient=false;rect.cornerRadius=small?h/2:2;rect.backgroundColor=color;
      rect.border=true;rect.borderSize=0.18;rect.borderColor=HUB_RULE;
      back.interactionPlane.enabled=false;
      back.interactable.onTriggerEnd.add(()=>onTap());
      addBackPlateHover(back,so,color);
    });
    this.hubIcon(so,icon,new vec3(-w/2+(small?3:3.6),0,0.3),small?3:3.6,HUB_PURPLE);
    const t=this.hubText(so,label,new vec3(-w/2+(small?5.4:6.6),0,0.3),w-(small?(label==="Occlusion"?13:7):7.6),4,HUB_INK,HUB_T_SEG,THEME_FONT,HorizontalAlignment.Left);
    t.horizontalOverflow=HorizontalOverflow.Shrink;
    return so;
  }
  private hubRule(parent:SceneObject,y:number):void {this.hubRect(parent,new vec3(0,y,0.1),HUB_INNER,0.2,HUB_RULE,0);}
  private hubRect(parent:SceneObject,pos:vec3,w:number,h:number,color:vec4,radius:number):RoundedRectangle {
    const so=this.obj(parent,"Rect",pos);
    const r=so.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle;
    r.initialize();r.size=new vec2(w,h);r.cornerRadius=radius;r.gradient=false;r.backgroundColor=color;
    return r;
  }
  private hubIcon(parent:SceneObject,tex:Texture,pos:vec3,size:number,tint:vec4):Image {
    const so=this.obj(parent,"Icon",pos);
    const img=so.createComponent("Component.Image") as Image;
    img.mainMaterial=IMAGE_MATERIAL_ASSET.clone();img.mainPass.baseTex=tex;img.mainPass.baseColor=tint;
    so.getTransform().setLocalScale(new vec3(size,size,1));
    return img;
  }
  private hubImage(parent:SceneObject,tex:Texture,pos:vec3,w:number,h:number,tint:vec4):void {
    const img=this.hubIcon(parent,tex,pos,1,tint);
    img.getSceneObject().getTransform().setLocalScale(new vec3(w,h,1));
  }
  private hubText(parent:SceneObject,value:string,pos:vec3,w:number,h:number,color:vec4,size:number,font:Font,align:HorizontalAlignment):Text {
    const x=align===HorizontalAlignment.Left?pos.x+w/2:pos.x;
    const so=this.obj(parent,"Text",new vec3(x,pos.y,pos.z));
    const t=so.createComponent("Component.Text") as Text;
    t.text=value;t.depthTest=true;t.font=font;t.size=size;t.textFill.color=color;
    t.horizontalAlignment=align;t.verticalAlignment=VerticalAlignment.Center;
    t.horizontalOverflow=HorizontalOverflow.Overflow;t.verticalOverflow=VerticalOverflow.Overflow;
    t.layoutRect=Rect.create(-w/2,w/2,-h/2,h/2);
    return t;
  }
  /** Manually toggled by the cap. */
  /** Bench step (before a shoot type is picked): only the floating Reset Floor button shows — the tools
   * can't be used yet, but a bench standing on a wrong floor must still be fixable. */
  private floorOnly=false;
  setFloorOnly(on:boolean):void {
    if(on===this.floorOnly)return;
    this.floorOnly=on;
    if(on)this.setCollapsed(true);
    for(let i=0;i<this.collapsedBar.getChildrenCount();i++){
      const c=this.collapsedBar.getChild(i);
      if(c.name.indexOf("Tool")===0||c.name==="Selected")c.enabled=!on;
    }
    if(this.cap)this.cap.enabled=!on;
    // The bar's background: its rounded rectangle redraws itself, so shrink it away rather than hide it.
    if(this.back)this.back.size=on?new vec2(0.01,0.01):(this.collapsed?COLLAPSED_SIZE:this.expandedSize);
    if(this.back?.interactable)this.back.interactable.enabled=!on;
  }
  setCollapsed(collapsed:boolean):void { this.manualCollapsed=collapsed; this.applyCollapsed(); }
  /** Driven by ScoutMain based on head movement speed; overrides the manual state while moving fast. */
  setAutoCollapsed(forced:boolean):void { this.forcedCollapsed=forced; this.applyCollapsed(); }
  private applyCollapsed():void {
    const collapsed=this.manualCollapsed||this.forcedCollapsed;
    if(collapsed===this.collapsed)return;
    this.collapsed=collapsed;
    this.applyView();
    this.collapsedBar.enabled=collapsed;
    if(this.panelAnim){this.panelAnim();this.panelAnim=null;}
    // Opening from the bar (by hand) unfolds; head-motion auto-collapse and closing stay quick.
    if(!collapsed&&!this.forcedCollapsed&&this.back)this.unfold();
    else this.resizePanel(collapsed?COLLAPSED_SIZE:this.expandedSize,collapsed?CLOSE_SECONDS:0);
  }
  private panelAnim:CancelFunction=null;
  private unfoldRest=new Map<SceneObject,{pos:vec3;scale:vec3}>();
  /** Grows the panel to `to` over `seconds` (0 = at once), keeping the side tab on its edge. */
  private resizePanel(to:vec2,seconds:number):void {
    // The bench step keeps the panel shrunk away (see setFloorOnly); don't animate it back.
    if(this.floorOnly){this.back.size=new vec2(0.01,0.01);this.updateCap();return}
    const from=this.back.size;
    if(seconds<=0){this.back.size=to;this.updateCap();return}
    this.panelAnim=animate({duration:seconds,easing:"ease-out-cubic",update:t=>{
      this.back.size=vec2.lerp(from,to,t);this.updateCap();
    },ended:()=>{this.panelAnim=null;}});
  }
  /** The menu opening: the panel grows out of the tool bar, and the page's rows cascade in from the top
   * — each rises a little and scales up into place just after the one above it. */
  private unfold():void {
    const from=COLLAPSED_SIZE,to=this.expandedSize;
    const page=this.view==="main"?this.col:this.view==="layouts"?this.layoutsPanel:this.moodboardPanel;
    // The main page's rows are its direct children; sub-pages animate as a whole.
    const items:{t:Transform;pos:vec3;scale:vec3;delay:number}[]=[];
    const nodes=this.view==="main"&&page?Array.from({length:page.getChildrenCount()},(_,i)=>page.getChild(i)):(page?[page]:[]);
    for(const n of nodes){
      // Resting placement, captured once — a reopen mid-animation would otherwise read a half-scaled row.
      if(!this.unfoldRest.has(n))this.unfoldRest.set(n,{pos:n.getTransform().getLocalPosition(),scale:n.getTransform().getLocalScale()});
      const rest=this.unfoldRest.get(n);
      const t=n.getTransform(),pos=rest.pos;
      const fromTop=Math.min(1,Math.max(0,(HUB_H/2-pos.y)/HUB_H));
      items.push({t,pos,scale:rest.scale,delay:fromTop*OPEN_STAGGER});
    }
    const place=(p:number)=>{
      for(const it of items){
        const k=Math.min(1,Math.max(0,(p-it.delay)/OPEN_ITEM));
        const e=k<=0?0:easeOutBack(k);
        it.t.setLocalScale(it.scale.uniformScale(Math.max(0.0001,e)));
        it.t.setLocalPosition(new vec3(it.pos.x,it.pos.y-(1-Math.min(1,e))*OPEN_RISE,it.pos.z));
      }
    };
    place(0);
    this.panelAnim=animate({duration:OPEN_SECONDS,update:p=>{
      const g=Math.min(1,p/OPEN_GROW);
      this.back.size=vec2.lerp(from,to,1-Math.pow(1-g,3));
      this.updateCap();
      place(p);
    },ended:()=>{place(1.0001+OPEN_STAGGER);this.back.size=to;this.updateCap();this.panelAnim=null;}});
  }
  private showView(view:"main"|"layouts"|"moodboard"):void {
    this.view=view;this.applyView();
    // Safe to rebuild here: the button that opened this page isn't part of the list.
    if(view==="layouts")this.renderLayoutList();
  }
  private applyView():void {
    this.col.enabled=!this.collapsed&&this.view==="main";
    this.layoutsPanel.enabled=!this.collapsed&&this.view==="layouts";
    this.moodboardPanel.enabled=!this.collapsed&&this.view==="moodboard";
  }
  /** Saved Layouts page: save the current layout, then load / rename / delete saved ones. */
  private buildLayoutsPanel(parent:SceneObject,height:number):SceneObject {
    this.light=true;
    const panel=this.flex(parent,FlexDirection.Column,HUB_W,height,1,2);
    this.textRow(panel,"Saved Layouts",42,5,"Title2");
    this.textRow(panel,"Layouts load around where you're standing",42,2,"Caption");
    const save=this.child(panel,"Save",42,5);
    const saveRow=this.flex(save,FlexDirection.Row,42,5,1,0);
    this.button(saveRow,"Save Current Layout",42,5,LAYOUTS_ICON,()=>this.onSaveLayout.invoke());
    this.layoutList=this.child(panel,"Layout list",42,LAYOUT_LIST_H);
    this.backRow(panel);
    this.renderLayoutList();
    this.light=false;
    panel.enabled=false;
    return panel;
  }
  /** Refreshes the Saved Layouts list. Rebuilt a frame later: this is usually called from inside one of
   * the list's own button callbacks, and destroying a button mid-callback isn't safe. */
  setLayouts(layouts:SavedLayoutInfo[]):void {
    this.layouts=layouts;
    if(!this.layoutListRefresh){
      this.layoutListRefresh=this.createEvent("DelayedCallbackEvent");
      this.layoutListRefresh.bind(()=>this.renderLayoutList());
    }
    this.layoutListRefresh.reset(0);
  }
  private renderLayoutList():void {
    if(!this.layoutList)return;
    const wasLight=this.light;this.light=true;
    try{this.renderLayoutRows();}finally{this.light=wasLight;}
  }
  private renderLayoutRows():void {
    for(let i=this.layoutList.getChildrenCount()-1;i>=0;i--)this.layoutList.getChild(i).destroy();
    const list=this.flex(this.layoutList,FlexDirection.Column,42,LAYOUT_LIST_H,1,0);
    const flex=list.getComponent(FlexLayout.getTypeName()) as FlexLayout;
    flex.onInitialized.add(()=>{flex.justifyContent=FlexJustify.Start;});
    if(!this.layouts.length){this.textRow(list,"No saved layouts yet",42,3,"Caption");return}
    this.layouts.forEach(info=>{
      const host=this.child(list,"Layout "+info.id,42,LAYOUT_ROW_H);
      const row=this.flex(host,FlexDirection.Row,42,LAYOUT_ROW_H,1,0);
      const name=info.name.length>LAYOUT_NAME_MAX?info.name.slice(0,LAYOUT_NAME_MAX-1)+"…":info.name;
      this.button(row,name+"  ·  "+info.count,24,LAYOUT_ROW_H,null,()=>this.onLoadLayout.invoke(info.id));
      // Two ways to name a layout: say it (mic) or type it (Specs keyboard).
      this.button(row,"",5,LAYOUT_ROW_H,MIC_ICON,()=>this.onVoiceRenameLayout.invoke(info.id));
      this.button(row,"",5,LAYOUT_ROW_H,EDIT_ICON,()=>this.onRenameLayout.invoke(info.id));
      this.button(row,"",5,LAYOUT_ROW_H,TRASH_ICON,()=>this.onDeleteLayout.invoke(info.id));
    });
  }
  /** Moodboard page: phone pairing (shown, not live yet) and pinning a poster to a wall. */
  private buildMoodboardPanel(parent:SceneObject,height:number):SceneObject {
    this.light=true;
    const panel=this.flex(parent,FlexDirection.Column,HUB_W,height,1,2);
    this.textRow(panel,"Moodboard",42,5,"Title2");
    this.textRow(panel,"Bring in reference images and notes",42,2.5,"Body");
    this.textRow(panel,"from Google Drive, Canva, Figma or your camera roll",42,2,"Caption");
    this.textRow(panel,"Open ShotScout Link on your phone and enter",42,2.5,"Caption");
    const code=this.textRow(panel,this.pairingCode(),42,9,"Title2");
    code.size=200;code.textFill.color=HUB_PURPLE;code.font=HUB_SERIF;
    this.textRow(panel,"Not connected · phone pairing coming soon",42,2.5,"Caption");
    const pin=this.child(panel,"Pin",42,5);
    const pinRow=this.flex(pin,FlexDirection.Row,42,5,1,0);
    this.button(pinRow,"Pin a Poster to a Wall",42,5,MOODBOARD_ICON,()=>{
      this.showView("main");this.setCollapsed(true);this.onPinPoster.invoke();
    });
    this.backRow(panel);
    this.light=false;
    panel.enabled=false;
    return panel;
  }
  private pairingCode():string {
    let code="";
    for(let i=0;i<6;i++)code+=PAIRING_ALPHABET[Math.floor(Math.random()*PAIRING_ALPHABET.length)];
    return code.slice(0,3)+" "+code.slice(3);
  }
  private backRow(panel:SceneObject):void {
    const back=this.child(panel,"Back",42,4.5);
    const backRow=this.flex(back,FlexDirection.Row,42,4.5,1,0);
    this.button(backRow,"Back",42,4.5,null,()=>this.showView("main"));
  }
  /** Red × badge for things placed outside the marker system (moodboard posters). */
  addDeleteBadge(parent:SceneObject,pos:vec3,onDelete:()=>void):void {
    this.cornerButton(parent,"Delete",pos,TRASH_ICON,DELETE_TINT,DELETE_ICON_TINT,onDelete);
  }
  /** Vertical row of tool icons — the default collapsed view. Tapping Subject alternates Standing/Seated. */
  private buildCollapsedBar(parent:SceneObject):SceneObject {
    const bar=this.obj(parent,"CollapsedBar",new vec3(0,0,0.02));
    const tools:[Texture,()=>void][]=[
      [ICONS[0],()=>this.onSelect.invoke(0)],
      [ICONS[1],()=>this.onSelect.invoke(1)],
      [ICONS[2],()=>this.onSelect.invoke(2)],
      // Tapping Subject again while it's selected flips Standing/Seated; coming back to it keeps the last pose.
      [ACTOR_ICONS[0],()=>{if(this.selected===3||this.selected===4)this.subjectPose=this.subjectPose===3?4:3;this.onSelect.invoke(this.subjectPose);}],
      [HAND_ICON,()=>this.onSelect.invoke(HAND_KIND)],
    ];
    const totalH=TOOLBAR_COUNT*TOOLBAR_ICON+(TOOLBAR_COUNT-1)*TOOLBAR_GAP;
    // A purple ring behind the selected tool's button shows what a pinch on the floor will do.
    this.toolYs=tools.map((_,i)=>totalH/2-TOOLBAR_ICON/2-i*(TOOLBAR_ICON+TOOLBAR_GAP));
    this.selectedRing=this.obj(bar,"Selected",new vec3(0,this.toolYs[0],-0.01));
    const ring=this.selectedRing.createComponent(BackPlate.getTypeName()) as BackPlate;
    ring.style="simple";ring.size=new vec2(TOOLBAR_ICON+SELECTED_RING*2,TOOLBAR_ICON+SELECTED_RING*2);
    ring.onInitialized.add(()=>{
      this.style(ring,HUB_PURPLE,TOOLBAR_ICON/2+SELECTED_RING);
      ring.interactable.enabled=false;ring.interactionPlane.enabled=false;
    });
    tools.forEach(([icon,action],i)=>{
      const y=this.toolYs[i];
      const img=this.iconBadge(this.obj(bar,"Tool"+i,new vec3(0,y,0)),icon,HUB_PURPLE,TOOLBAR_ICON,0,action);
      // The full-body dummy is tall and thin, so it gets a little more room than the square icons.
      if(i===3){this.subjectIcon=img;this.paintSubjectIcon();img.getSceneObject().getTransform().setLocalScale(new vec3(TOOLBAR_ICON*0.75,TOOLBAR_ICON*0.75,1));}
    });
    this.buildFloorButton(bar,COLLAPSED_SIZE.y/2+FLOOR_GAP+FLOOR_BUTTON/2);
    bar.enabled=false;
    return bar;
  }
  /** Round Reset Floor button with a "Floor" caption, floating above the tool bar (part of it, so it shows
   * whenever the bar does). */
  private buildFloorButton(bar:SceneObject,y:number):void {
    const so=this.obj(bar,"Reset floor",new vec3(0,y,0));
    const back=so.createComponent(BackPlate.getTypeName()) as BackPlate;
    back.style="simple";back.size=new vec2(FLOOR_BUTTON,FLOOR_BUTTON);
    back.onInitialized.add(()=>{
      this.style(back,HUB_PAPER,FLOOR_BUTTON/2);
      // Unlike the tool buttons it sits outside the panel, so it keeps its own interaction plane for
      // up-close pinches and pokes (the panel's plane doesn't reach it).
      back.interactable.onTriggerEnd.add(()=>this.onResetFloor.invoke());
      addBackPlateHover(back,so,HUB_PAPER);
    });
    const iconHost=this.obj(so,"Icon",new vec3(0,0,0.5));
    const img=iconHost.createComponent("Component.Image") as Image;
    img.mainMaterial=IMAGE_MATERIAL_ASSET.clone();
    img.mainPass.baseTex=FLOOR_RESET_ICON;img.mainPass.baseColor=HUB_PURPLE;
    iconHost.getTransform().setLocalScale(new vec3(FLOOR_BUTTON*0.62,FLOOR_BUTTON*0.62,1));
    this.label(bar,"Floor",new vec3(0,y+FLOOR_BUTTON/2+2,0.5),TYPE_SCALE.Body.size,TEXT_TINT,HorizontalAlignment.Center);
  }
  /** Persistent rounded tab on the panel's right edge; toggles collapsed state and stays put across both states. */
  private buildCap(parent:SceneObject):void {
    const cap=this.obj(parent,"Cap",new vec3(0,0,0.3));
    this.cap=cap;
    const back=cap.createComponent(BackPlate.getTypeName()) as BackPlate;
    back.style="simple";
    back.size=new vec2(CAP_WIDTH,CAP_HEIGHT);
    back.onInitialized.add(()=>{
      this.style(back,HUB_PURPLE,CAP_WIDTH/2);
      back.interactionPlane.enabled=false;
      back.interactable.onTriggerStart.add(()=>this.setCollapsed(!this.collapsed));
      addBackPlateHover(back,cap,HUB_PURPLE);
    });
    const iconHost=this.obj(cap,"Icon",new vec3(0,0,0.5));
    const img=iconHost.createComponent("Component.Image") as Image;
    img.mainMaterial=IMAGE_MATERIAL_ASSET.clone();
    img.mainPass.baseTex=ARROW_ICON;img.mainPass.baseColor=HUB_WHITE;
    iconHost.getTransform().setLocalScale(new vec3(4,4,1));
    this.capIcon=img;
    this.updateCap();
  }
  private updateCap():void {
    if(!this.cap)return;
    const size=this.back?this.back.size:(this.collapsed?COLLAPSED_SIZE:this.expandedSize);
    this.cap.getTransform().setLocalPosition(new vec3(size.x/2+CAP_WIDTH/2-1.5,0,0.3));
    if(this.capIcon)this.capIcon.rotationAngle=this.collapsed?-90:90;
  }
  setState(selected:number,count:number): void {
    this.selected=selected; this.count=count;
    // Picking Standing or Seated anywhere (hub or bar) makes it the bar's Subject pose, and the bar's icon shows it.
    if(selected===3||selected===4){this.subjectPose=selected;this.paintSubjectIcon();}
    // Bar slots: Camera, Light, Note, Subject (standing or seated), Hand.
    const slot=selected===HAND_KIND?4:selected>=3?3:selected;
    if(this.selectedRing&&this.toolYs[slot]!==undefined)this.selectedRing.getTransform().setLocalPosition(new vec3(0,this.toolYs[slot],-0.01));
    if (this.status) this.status.text=TOOL_NAMES[selected]+" ready  ·  "+count+" placed";
    this.hubTools.forEach(t=>t.paint(t.kind===selected));
  }
  private paintSubjectIcon():void {
    if(this.subjectIcon)this.subjectIcon.mainPass.baseTex=ACTOR_ICONS[this.subjectPose===4?1:0];
  }
  setShootType(type:"photo"|"video"):void {
    this.shootType=type;
    if(this.shootPill)this.shootPill.text=type==="photo"?"Photo shoot":"Video shoot";
    this.setState(this.selected,this.count);
  }
  setSharedStatus(text:string):void {if(this.sharedStatus)this.sharedStatus.text=text;}
  setHint(hint:string):void { if(this.status) this.status.text=hint; }

  /** Labels are views only; caller owns position, lifetime, and interaction state. `backAxis` mounts
   * the card on the asset's real operator-facing side instead of the default (+Z, facing whoever placed
   * it): 1 for the Camera (its true back sits on local -X — confirmed by standing at each of root's
   * +-X/+-Z directions and matching against the model's own LCD screen), 2 for the Light (its true back
   * is local -Z, opposite the beam — the bulb aims out +Z, per buildKeyLight's own comment). */
  decorateMarker(root:SceneObject,label:string,labelY=-7,onEdit:()=>void=()=>{},onDelete:()=>void=()=>{},backAxis:0|1|2=0): void {
    // rotationFromTo instead of an angleAxis guess — sidesteps sign-convention mistakes entirely by
    // directly rotating the card's default +Z-facing normal onto the asset's real back axis.
    const pos=backAxis===1?new vec3(-4,labelY,0):backAxis===2?new vec3(0,labelY,-4):new vec3(0,labelY,4);
    // backAxis 2 is a straight 180 — rotationFromTo is singular for exactly-antiparallel vectors (its
    // cross product is zero), so that case uses a plain angleAxis flip instead.
    const rot=backAxis===1?quat.rotationFromTo(vec3.forward(),vec3.right().uniformScale(-1))
      :backAxis===2?quat.angleAxis(Math.PI,vec3.up())
      :null;
    const host=this.obj(root,"Marker label",pos);
    if(rot)host.getTransform().setLocalRotation(rot);
    host.createComponent("Component.Canvas");
    const back=host.createComponent(BackPlate.getTypeName()) as BackPlate;
    const size=new vec2(16,3.2);
    back.size=size;
    const editX=size.x/2-3.2;
    // Badges sit above the card's top edge (radius 2.8 + a small gap) instead of straddling it —
    // centered at the edge itself, their lower half dipped into the label text and covered it (visible
    // from the front, where the card is read straight-on).
    const badgeY=size.y/2+3.3;
    this.cornerButton(host,"Delete",new vec3(editX-7.4,badgeY,1.2),TRASH_ICON,DELETE_TINT,DELETE_ICON_TINT,onDelete);
    this.cornerButton(host,"Edit",new vec3(editX,badgeY,1.2),EDIT_ICON,BADGE_TINT,TEXT_TINT,onEdit);
    back.onInitialized.add(()=>{
      back.interactable.enabled=false;
      back.interactionPlane.enabled=false;
      const disable=this.createEvent("DelayedCallbackEvent");
      disable.bind(()=>{
        // Skip the Edit/Delete badges — they need their own collider to stay tappable.
        const visit=(node:SceneObject)=>{
          if(node.name==="Edit"||node.name==="Delete")return;
          node.getComponents("Physics.ColliderComponent").forEach(c=>c.enabled=false);
          for(let i=0;i<node.getChildrenCount();i++)visit(node.getChild(i));
        };visit(host);
      });disable.reset(0.1);
    });
    const content=this.obj(host,"LabelContent",new vec3(0,0,0.6));
    const col=this.flex(content,FlexDirection.Column,16,3.2,0.7,0.7);
    const t=this.textRow(col,label,14.6,1.8,"Body");
    t.textFill.color=this.accent;
  }
  /** The Note asset's whole interface: a lavender field-journal card (ScoutNoteWizard) standing on its
   * pointer, whose tip is at `tipY` above the note's spot. `reference` finds the nearest camera's
   * reference photo. `scheduleDelay` hands the card this component's createEvent access. */
  buildNoteWizard(root:SceneObject,label:string,tipY:number,state:NoteAssetState,onChange:(patch:Partial<NoteAssetState>)=>void,onEdit:()=>void,onDelete:()=>void,photo=false,reference:()=>NoteReference|null=()=>null):ScoutNoteWizard {
    if(!this.badgeMaterial)return null;
    const theme:NoteWizardTheme={font:THEME_FONT};
    return new ScoutNoteWizard(root,new vec3(0,tipY,0),this.badgeMaterial,theme,label,state,onChange,onEdit,onDelete,(seconds,fn)=>{
      const ev=this.createEvent("DelayedCallbackEvent");ev.bind(fn);ev.reset(seconds);
    },photo,reference);
  }
  /** Compact ISO/Aperture/Shutter/WB dial row for one placed Camera asset — purely informational, no
   * dial here drives a real effect (see AGENTS request: only the Light asset's dials do). */
  buildCameraControls(root:SceneObject,labelY:number,state:CameraAssetState,onChange:(patch:Partial<CameraAssetState>)=>void):void {
    // backAxis 1: mounted like a camcorder's rear screen, facing the operator standing behind the
    // camera (its true back is local -X), not the side that happened to face whoever placed it.
    this.buildControlsRow(root,labelY,58,1,[
      {label:"ISO",steps:ISO_STOPS,initialIndex:state.isoIndex,onChange:i=>onChange({isoIndex:i})},
      {label:"Aperture",steps:APERTURE_STOPS,initialIndex:state.apertureIndex,onChange:i=>onChange({apertureIndex:i})},
      {label:"Shutter",steps:SHUTTER_STOPS,initialIndex:state.shutterIndex,onChange:i=>onChange({shutterIndex:i})},
      {label:"WB",steps:KELVIN_STOPS,initialIndex:state.kelvinIndex,onChange:i=>onChange({kelvinIndex:i}),fillColorForValue:kelvinFill},
    ]);
  }
  /** The Camera asset's "angle" monitor: a screen above its dial row, on the same operator-facing side,
   * that holds a reference photo taken from where the camera stands. View only — ScoutAngleCapture
   * drives its state, status text and image. */
  buildAngleScreen(root:SceneObject,labelY:number,photo:boolean,onCapture:()=>void,onCancel:()=>void):AngleScreen {
    if(!this.badgeMaterial)return null;
    const w=ANGLE_SCREEN_W,h=photo?w*2/3:w*9/16;
    const pad=1.2,strip=7;
    const panelW=w+pad*2,panelH=h+pad*2+strip;
    // Stacked over the dial row (see buildControlsRow's own layout) with the same gap the row keeps
    // above the label card.
    const controlsTop=labelY+1.6+2+(5.2*2+9);
    const y=controlsTop+2+panelH/2;
    const host=this.obj(root,"Angle screen",new vec3(-4,y,0));
    // Same backAxis-1 mount as the dials, then tipped back a little like a monitor on a rig, so it
    // faces someone standing behind the camera rather than the ceiling-height it sits at.
    host.getTransform().setLocalRotation(quat.rotationFromTo(vec3.forward(),vec3.right().uniformScale(-1))
      .multiply(quat.angleAxis(-ANGLE_SCREEN_TILT*Math.PI/180,vec3.right())));
    host.createComponent("Component.Canvas");
    const back=host.createComponent(BackPlate.getTypeName()) as BackPlate;
    back.style="simple";
    back.size=new vec2(panelW,panelH);
    const buttonNames=["Capture this angle","Cancel","Retake"];
    back.onInitialized.add(()=>{
      this.style(back,DIAL_PANEL_TINT,PANEL_RADIUS);
      back.interactable.enabled=false;
      back.interactionPlane.enabled=false;
      // Same defensive sweep as the dial row: the frame's own collider would block the buttons.
      const disable=this.createEvent("DelayedCallbackEvent");
      disable.bind(()=>{
        const visit=(node:SceneObject)=>{
          if(buttonNames.indexOf(node.name)>=0)return;
          node.getComponents("Physics.ColliderComponent").forEach(c=>c.enabled=false);
          for(let i=0;i<node.getChildrenCount();i++)visit(node.getChild(i));
        };visit(host);
      });disable.reset(0.1);
    });
    const screenY=strip/2;
    // The viewfinder: the photo once there is one, a dark "screen off" until then.
    const screenSo=this.obj(host,"Viewfinder",new vec3(0,screenY,0.3));
    screenSo.getTransform().setLocalScale(new vec3(w,h,1));
    const screen=screenSo.createComponent("Component.Image") as Image;
    screen.mainMaterial=IMAGE_MATERIAL_ASSET.clone();
    screen.mainPass.baseTex=WHITE;
    screen.mainPass.baseColor=ANGLE_SCREEN_OFF;
    // Cream corner frame-lines, like a camera monitor's guides.
    const guides=this.obj(host,"Guides",new vec3(0,screenY,0.4));
    const arm=3.2,thick=0.28,inset=1.2;
    for(const sx of [-1,1])for(const sy of [-1,1]){
      const cx=sx*(w/2-inset),cy=sy*(h/2-inset);
      this.bar(guides,new vec3(cx-sx*arm/2,cy,0),arm,thick,ANGLE_INK);
      this.bar(guides,new vec3(cx,cy-sy*arm/2,0),thick,arm,ANGLE_INK);
    }
    this.label(guides,photo?"3:2":"16:9",new vec3(-w/2+inset+2.8,h/2-inset-1.8,0),52,ANGLE_INK,HorizontalAlignment.Center);
    // Centre prompt: title + one line of guidance, swapped by state.
    const title=this.label(host,"",new vec3(0,screenY+2.6,0.5),90,ANGLE_INK,HorizontalAlignment.Center);
    const detail=this.label(host,"",new vec3(0,screenY-3.2,0.5),60,ANGLE_INK_DIM,HorizontalAlignment.Center);
    // "Angle changed" banner across the top of a stale photo.
    const banner=this.obj(host,"Stale banner",new vec3(0,screenY+h/2-3.2,0.5));
    this.bar(banner,vec3.zero(),w,5.2,ANGLE_STALE_TINT);
    this.label(banner,"Angle changed · retake",new vec3(0,0,0.1),66,new vec4(0.1,0.08,0.05,1),HorizontalAlignment.Center);
    // Bottom strip: exactly one action button at a time.
    const stripY=-panelH/2+pad+strip/2-0.4;
    const action=(name:string,icon:Texture,bw:number,fn:()=>void)=>{
      const row=this.obj(host,name+" row",new vec3(0,stripY,0.5));
      const f=this.flex(row,FlexDirection.Row,bw,5,0,0);
      this.button(f,name,bw,4.6,icon,fn);
      return row;
    };
    const captureRow=action(buttonNames[0],PHOTO_CAMERA_ICON,22,onCapture);
    const cancelRow=action(buttonNames[1],CLOSE_ICON,14,onCancel);
    const retakeRow=action(buttonNames[2],RESET_FLOOR_ICON,14,onCapture);
    let image:Texture=photo?ANGLE_MOCK_PHOTO:ANGLE_MOCK_VIDEO;
    const view:AngleScreen={
      setState:(state:AngleScreenState)=>{
        const hasPhoto=state==="captured"||state==="stale";
        screen.mainPass.baseColor=hasPhoto?new vec4(1,1,1,1):ANGLE_SCREEN_OFF;
        screen.mainPass.baseTex=hasPhoto?image:WHITE;
        banner.enabled=state==="stale";
        captureRow.enabled=state==="empty";
        cancelRow.enabled=state==="guiding";
        retakeRow.enabled=hasPhoto;
        title.getSceneObject().enabled=detail.getSceneObject().enabled=!hasPhoto;
        if(state==="empty"){title.text="No angle yet";detail.text="Stand where this camera stands\nto take a reference photo";}
        if(state==="guiding"){title.text="Walk to the camera";detail.text="Stand on the marker\nand face the shot";}
      },
      setStatus:(text:string)=>{title.text=text;},
      setImage:(tex:Texture)=>{image=tex;},
      get image(){return image;},
    };
    view.setState("empty");
    return view;
  }
  /** Flat tinted rectangle (frame-lines, banners). */
  private bar(parent:SceneObject,pos:vec3,w:number,h:number,tint:vec4):void {
    const so=this.obj(parent,"Bar",pos);so.getTransform().setLocalScale(new vec3(w,h,1));
    const img=so.createComponent("Component.Image") as Image;
    img.mainMaterial=IMAGE_MATERIAL_ASSET.clone();img.mainPass.baseTex=WHITE;img.mainPass.baseColor=tint;
  }
  private label(parent:SceneObject,value:string,pos:vec3,size:number,color:vec4,align:HorizontalAlignment):Text {
    const so=this.obj(parent,"Text",pos);
    const t=so.createComponent("Component.Text") as Text;
    t.text=value;t.font=THEME_FONT;t.size=size;t.textFill.color=color;t.depthTest=true;
    t.horizontalAlignment=align;t.verticalAlignment=VerticalAlignment.Center;
    t.horizontalOverflow=HorizontalOverflow.Overflow;t.verticalOverflow=VerticalOverflow.Overflow;
    return t;
  }
  /** Compact Intensity/Kelvin dial row for one placed Light asset — both dials drive the marker's
   * real-time LightSource via ScoutMain.applyLightLook. */
  buildLightControls(root:SceneObject,labelY:number,state:LightAssetState,onChange:(patch:Partial<LightAssetState>)=>void):void {
    // backAxis 2: the bulb aims its beam out of local +Z (see ScoutMain.buildKeyLight), so the true
    // operator-facing back is -Z — otherwise the dials sit in the beam, facing the lit subject instead.
    this.buildControlsRow(root,labelY,30,2,[
      {label:"Intensity",steps:INTENSITY_STOPS,initialIndex:state.intensityIndex,onChange:i=>onChange({intensityIndex:i})},
      {label:"Kelvin",steps:KELVIN_STOPS,initialIndex:state.kelvinIndex,onChange:i=>onChange({kelvinIndex:i}),fillColorForValue:kelvinFill},
    ]);
  }
  /** Shared visual plumbing behind buildCameraControls/buildLightControls — a small BackPlate panel,
   * floating above the marker's existing label card (never replacing it), hosting a row of RotaryDials.
   * Camera and Light keep their own public methods/types above; only this rendering helper is shared. */
  private buildControlsRow(root:SceneObject,labelY:number,rowWidth:number,backAxis:0|1|2,dials:{label:string;steps:DialStep[];initialIndex:number;onChange:(index:number)=>void;fillColorForValue?:(value:number)=>vec4}[]):void {
    if(!this.badgeMaterial)return; // same guard the dials use — set once in ScoutMain.start(), before any marker exists
    const material=this.badgeMaterial;
    const dialRadius=5.2;
    const panelH=dialRadius*2+9;
    const labelCardHalfHeight=1.6,gap=2;
    const y=labelY+labelCardHalfHeight+gap+panelH/2;
    // Same backAxis correction as decorateMarker — see its comment.
    const pos=backAxis===1?new vec3(-4,y,0):backAxis===2?new vec3(0,y,-4):new vec3(0,y,4);
    const rot=backAxis===1?quat.rotationFromTo(vec3.forward(),vec3.right().uniformScale(-1))
      :backAxis===2?quat.angleAxis(Math.PI,vec3.up())
      :null;
    const host=this.obj(root,"Asset controls",pos);
    if(rot)host.getTransform().setLocalRotation(rot);
    host.createComponent("Component.Canvas");
    const back=host.createComponent(BackPlate.getTypeName()) as BackPlate;
    back.style="simple";
    back.size=new vec2(rowWidth,panelH);
    back.onInitialized.add(()=>{
      // Neutral dark gear-grey, not the palette's purple PANEL_TINT — this backdrop is the physical
      // gear's own control panel, not menu chrome, so it should read as equipment, not UI.
      this.style(back,DIAL_PANEL_TINT,PANEL_RADIUS);
      back.interactable.enabled=false;
      back.interactionPlane.enabled=false;
      // Mirrors decorateMarker's own defensive sweep: BackPlate's stray collider(s) would otherwise sit
      // in front of (and block) the dials' own colliders. Exempt DialKnob nodes so drag still works.
      const disable=this.createEvent("DelayedCallbackEvent");
      disable.bind(()=>{
        const visit=(node:SceneObject)=>{
          if(node.name==="DialKnob")return;
          node.getComponents("Physics.ColliderComponent").forEach(c=>c.enabled=false);
          for(let i=0;i<node.getChildrenCount();i++)visit(node.getChild(i));
        };visit(host);
      });disable.reset(0.1);
    });
    const content=this.obj(host,"ControlsContent",new vec3(0,0,0.5));
    const theme:RotaryDialTheme={font:THEME_FONT,textColor:TEXT_TINT,idleColor:DIAL_IDLE_TINT,hoverColor:DIAL_HOVER_TINT,activeColor:DIAL_ACTIVE_TINT,tickColor:DIAL_TICK_TINT};
    const spacing=rowWidth/dials.length;
    dials.forEach((d,i)=>{
      const x=-rowWidth/2+spacing*(i+0.5);
      new ScoutRotaryDial(content,new vec3(x,0,0),material,theme,{label:d.label,steps:d.steps,initialIndex:d.initialIndex,radius:dialRadius,onChange:idx=>d.onChange(idx),fillColorForValue:d.fillColorForValue});
    });
  }
  /** Mascot + wordmark, always the first row of the expanded panel. */
  private headerRow(parent:SceneObject):void {
    const h=LOGO_HEIGHT+2;
    const row=this.child(parent,"Header",42,h);
    const layout=this.flex(row,FlexDirection.Row,42,h,2,0);
    this.imageItem(layout,MASCOT,LOGO_HEIGHT*MASCOT_ASPECT,LOGO_HEIGHT);
    this.imageItem(layout,LOGO,LOGO_WIDTH,LOGO_HEIGHT);
  }
  private imageItem(parent:SceneObject,texture:Texture,w:number,h:number):void {
    const so=this.child(parent,"Image",w,h);
    const img=so.createComponent("Component.Image") as Image;
    img.mainMaterial=IMAGE_MATERIAL_ASSET.clone();
    img.mainPass.baseTex=texture;
    so.getTransform().setLocalScale(new vec3(w,h,1));
  }
  /** Round badge anchored at a corner offset from an asset's card — Edit/Delete only. */
  private cornerButton(parent:SceneObject,name:string,pos:vec3,icon:Texture,tint:vec4,iconTint:vec4,onTap:()=>void):void {
    this.roundButton(this.obj(parent,name,pos),icon,tint,iconTint,5.6,onTap);
  }
  /** Flat round button: a filled circle with its icon on the face. (These were 3D spheres with a flat icon
   * floating on the front, which looked odd in the glasses.) */
  private roundButton(so:SceneObject,icon:Texture,tint:vec4,iconTint:vec4,size:number,onTap:()=>void):void {
    const back=so.createComponent(BackPlate.getTypeName()) as BackPlate;
    back.style="simple";
    back.size=new vec2(size,size);
    back.onInitialized.add(()=>{
      this.style(back,tint,size/2);
      back.interactionPlane.enabled=false;
      back.interactable.onTriggerStart.add(()=>onTap());
      addBackPlateHover(back,so,tint);
    });
    const iconHost=this.obj(so,"Icon",new vec3(0,0,0.4));
    const img=iconHost.createComponent("Component.Image") as Image;
    img.mainMaterial=IMAGE_MATERIAL_ASSET.clone();
    img.mainPass.baseTex=icon;img.mainPass.baseColor=iconTint;
    iconHost.getTransform().setLocalScale(new vec3(size*0.55,size*0.55,1));
  }
  /** Flat round badge with a centered icon; used for the collapsed toolbar's tool icons. */
  private iconBadge(so:SceneObject,icon:Texture,tint:vec4,size:number,rotation:number,onTap:()=>void):Image {
    const back=so.createComponent(BackPlate.getTypeName()) as BackPlate;
    back.style="simple";
    back.size=new vec2(size,size);
    back.onInitialized.add(()=>{
      this.style(back,HUB_PAPER_2,size/2);
      back.interactionPlane.enabled=false;
      back.interactable.onTriggerStart.add(()=>onTap());
      addBackPlateHover(back,so,HUB_PAPER_2);
    });
    const iconHost=this.obj(so,"Icon",new vec3(0,0,0.5));
    const img=iconHost.createComponent("Component.Image") as Image;
    img.mainMaterial=IMAGE_MATERIAL_ASSET.clone();
    img.mainPass.baseTex=icon;img.mainPass.baseColor=tint;img.rotationAngle=rotation;
    iconHost.getTransform().setLocalScale(new vec3(size*0.6,size*0.6,1));
    return img;
  }
  private style(back:BackPlate,color:vec4,radius:number):void {
    const rect=(back as unknown as {roundedRectangle:{gradient:boolean;backgroundColor:vec4;cornerRadius:number}}).roundedRectangle;
    rect.gradient=false;rect.backgroundColor=color;rect.cornerRadius=radius;
  }
  private obj(parent:SceneObject,name:string,pos?:vec3):SceneObject {
    const so=global.scene.createSceneObject(name);so.setParent(parent);
    if(pos)so.getTransform().setLocalPosition(pos);return so;
  }
  private child(parent:SceneObject,name:string,w:number,h:number):SceneObject {
    const so=this.obj(parent,name,new vec3(0,0,0.02));
    const item=so.createComponent(FlexItem.getTypeName()) as FlexItem;
    item.overrideWidth=w;item.overrideHeight=h;item.flexShrink=0;item.alignSelf=FlexAlignSelf.Center;
    (parent.getComponent(FlexLayout.getTypeName()) as FlexLayout).addItems([item]);return so;
  }
  private flex(parent:SceneObject,direction:FlexDirection,w:number,h:number,gap:number,pad:number):SceneObject {
    const so=this.obj(parent,"Layout",new vec3(0,0,0.02));
    const f=so.createComponent(FlexLayout.getTypeName()) as FlexLayout;
    f.autoDiscoverItemsOnStart=false;
    f.onInitialized.add(()=>{
      f.width=w;f.height=h;f.direction=direction;f.rowGap=gap;f.columnGap=gap;
      f.paddingTop=pad;f.paddingBottom=pad;f.paddingLeft=pad;f.paddingRight=pad;
      f.alignItems=FlexAlign.Center;f.justifyContent=FlexJustify.Center;
    });return so;
  }
  private textRow(parent:SceneObject,value:string,w:number,h:number,role:keyof typeof TYPE_SCALE):Text {
    const so=this.child(parent,value,w,h);const t=so.createComponent("Component.Text") as Text;
    t.text=value;t.depthTest=true;applyTextRole(t,role);
    if(this.light){t.textFill.color=HUB_INK;if(role==="Title2"){t.font=HUB_SERIF;t.size=HUB_T_TITLE;}else t.size=Math.max(t.size,HUB_T_CAPS);}
    t.horizontalAlignment=HorizontalAlignment.Center;t.verticalAlignment=VerticalAlignment.Center;
    t.horizontalOverflow=HorizontalOverflow.Overflow;t.verticalOverflow=VerticalOverflow.Overflow;
    t.layoutRect=Rect.create(-w/2,w/2,-h/2,h/2);return t;
  }
  /** Button's own visual comes from a theme system with no direct color override, so buttons are built on
   * BackPlate (full color control) instead, with ElementContent laid on top purely for icon+text content. */
  private button(parent:SceneObject,label:string,w:number,h:number,icon:Texture,action:()=>void):ElementContent {
    const so=this.child(parent,label,w,h);
    const back=so.createComponent(BackPlate.getTypeName()) as BackPlate;
    back.style="simple";
    back.size=new vec2(w,h);
    const light=this.light,bg=light?HUB_PAPER_2:BUTTON_TINT,fg=light?HUB_INK:TEXT_TINT;
    back.onInitialized.add(()=>{
      this.style(back,bg,light?h/2:BUTTON_RADIUS);
      back.interactionPlane.enabled=false;
      back.interactable.onTriggerEnd.add(()=>action());
      addBackPlateHover(back,so,bg);
    });
    if(light){
      // The hub's light pages draw their own label: UIKit's content re-tints its text after us.
      const hasLabel=!!label,hasIcon=!!icon;
      if(hasIcon)this.hubIcon(so,icon,new vec3(hasLabel?-w/2+3.4:0,0,0.4),Math.min(3.4,h*0.7),HUB_PURPLE);
      if(hasLabel){
        const t=this.hubText(so,label,new vec3(hasIcon?2:0,0,0.4),w-(hasIcon?8:3),h,HUB_INK,HUB_T_CAPS+14,THEME_FONT,HorizontalAlignment.Center);
        t.horizontalOverflow=HorizontalOverflow.Shrink;
      }
      return null;
    }
    const ec=so.createComponent(ElementContent.getTypeName()) as ElementContent;
    ec.sizeOverride=new vec2(w,h);
    ec.text=label;ec.textSize=TYPE_SCALE.Body.size;ec.leadingIcon=icon;ec.spacing=0.65;
    ec.autoResize=false; // text is centred by default (UIKit 4 dropped contentAlignment)
    // ElementContent defers building its Text/Icon children until the BackPlate sibling's own
    // onInitialized fires; subscribing here (after that content-building subscription is registered
    // above) guarantees this runs once the Text node actually exists, instead of racing a fixed delay.
    back.onInitialized.add(()=>{
      const apply=(node:SceneObject)=>{
        node.getComponents("Component.Text").forEach(t=>{const tt=t as Text;tt.font=THEME_FONT;tt.textFill.color=fg;if(light)tt.size=Math.max(tt.size,HUB_T_CAPS+10);});
        const img=node.getComponent("Component.Image") as Image;
        if(img)img.mainPass.baseColor=light?HUB_PURPLE:TEXT_TINT;
        for(let i=0;i<node.getChildrenCount();i++)apply(node.getChild(i));
      };apply(so);
    });
    return ec;
  }
}
