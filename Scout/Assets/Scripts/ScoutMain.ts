import {ScoutTransformGizmo} from "./ScoutTransformGizmo";
import {ScoutSharedSession} from "./ScoutSharedSession";
import {parseLayout,ScoutLayout,MarkerRecord} from "./ScoutLayout";
import {ScoutPaletteUI} from "./ScoutPaletteUI";
import {buildMarkerMesh, NOTE_PIN_HEIGHT} from "./ScoutMarkerMesh";
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import {InteractableManipulation} from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";
import {InteractionManager} from "SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager";
import {Interactor,InteractorInputType} from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";

import {HandInputData} from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import {IMAGE_MATERIAL_ASSET} from "SpectaclesUIKit.lspkg/Scripts/Utility/Assets";
import {CameraAssetState, LightAssetState, NoteAssetState, defaultCameraState, defaultLightState, defaultNoteState, KELVIN_STOPS, INTENSITY_STOPS, kelvinToRGB} from "./ScoutAssetState";
import {HOVER_GLOW,addHoverFeedback} from "./ScoutHover";
import {ScoutFloorSetup} from "./ScoutFloorSetup";
import {ScoutLayoutStore,MAX_SAVED_LAYOUTS} from "./ScoutLayoutStore";
import {buildPoster,POSTER_WIDTH,POSTER_HEIGHT} from "./ScoutPoster";
import {ScoutWorkbench,ShootType} from "./ScoutWorkbench";

type PointerRay={start:vec3;dir:vec3};
/** Saved-layout format: x/z are in the user's yaw-only frame at save time (their spot on the floor and
 * facing direction), h is height above the floor, r is yaw relative to the user's. */
type SavedMarker={k:number;l:string;x:number;z:number;h:number;r:number;c?:CameraAssetState;li?:LightAssetState;n?:NoteAssetState};
type SavedPoster={x:number;z:number;h:number;r:number};
type SavedLayout={v:2;m:SavedMarker[];p:SavedPoster[];s?:ShootType};
type UserFrame={origin:vec3;yaw:number};
/** The exact runtime hooks one placed Light asset needs so its dials can affect something real. */
type LightMarkerRef={light:LightSource;glowVisual:RenderMeshVisual};

/** Imported GLB prefabs are wrapped in empty "Scenes"/"Scene" nodes — the actual RenderMeshVisual is
 * nested a level or two below the instantiate() root, not on it. */
function findMeshVisual(root:SceneObject):RenderMeshVisual|null {
  const visual=root.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
  if(visual)return visual;
  for(let i=0;i<root.getChildrenCount();i++){
    const found=findMeshVisual(root.getChild(i));
    if(found)return found;
  }
  return null;
}
function findChildNamed(root:SceneObject,name:string):SceneObject|null {
  if(root.name===name)return root;
  for(let i=0;i<root.getChildrenCount();i++){
    const found=findChildNamed(root.getChild(i),name);
    if(found)return found;
  }
  return null;
}
const WorldQuery=require("LensStudio:WorldQueryModule") as WorldQueryModule;
// How long a pinch waits (green spinner showing) for surface tracking to find the real surface under the
// aim point before giving up — placement never falls back to a midair position.
const PLACE_SEARCH_SECONDS=1.5;
// A preview hit older than this no longer describes where the cursor is now.
const PREVIEW_HIT_FRESH=0.6;
// Only near-horizontal hits count as something to stand on — a wall or sofa side can't set a height.
const FLAT_NORMAL_Y=0.85;
// A flat surface only counts as the floor if it's a plausible distance below the user's head (cm).
const FLOOR_MIN_DROP=40,FLOOR_MAX_DROP=260;
// How far along the pointing ray a surface can be found (cm).
const RAY_REACH=800;
// Pointing steeper than this (ray direction's y) and the floor is likely too close to be in Specs' view;
// flatter than LEVEL_POINTING and the user simply isn't pointing at the floor yet.
const STEEP_POINTING=-0.95,LEVEL_POINTING=-0.2;
// A hit counts as a wall when its normal is this close to horizontal (|normal.y| below this).
const WALL_NORMAL_Y=0.3;
const HINT_SECONDS=2.5;
const SPINNER_COLOR=new vec4(0.35,1,0.5,1);
const SPINNER_RADIUS=8,SPINNER_SPEED=7;
const HINT_COLOR=new vec4(0.75,1,0.8,1);
const HINT_FONT=requireAsset("../Fonts/Inter.ttf") as Font;
const HOVER_HALO=requireAsset("../Icons/hover_glow.png") as Texture;
const HOVER_HALO_ALPHA=0.55,HOVER_HALO_EASE=12;
// Hovered props grow by less than buttons do: on a person-sized model even 5% is clearly visible.
const MARKER_HOVER_SCALE=1.05;
// Voice naming: how long a pause ends the name, and a cap in case nothing is ever said.
const VOICE_SILENCE_MS=1500,VOICE_TIMEOUT=10,VOICE_NAME_MAX=40;
const GROUND_INDICATOR=requireAsset("../Icons/ground_indicator.png") as Texture;
const GROUND_INDICATOR_COLOR=new vec4(0.72,0.58,1,1);
const GROUND_INDICATOR_FOOTPRINTS=[80,80,26,65,65]; // Camera, Light, Note, Standing, Seated — matches marker collider footprints
const GROUND_INDICATOR_LIFT=0.5; // avoid z-fighting with the real floor mesh
const GROUND_PULSE_SPEED=2.4,GROUND_PULSE_DEPTH=0.18;
// A sixth, non-placeable "tool": lets someone done placing things freely tap/drag existing markers
// without an empty-space pinch accidentally dropping a new one.
const HAND_KIND=5;

const MODEL_HEIGHTS=[145,165,30,170,125];
// Key light rig: local offset from the model's pivot to the softbox opening, in the model's own raw
// mesh units (meters) — a child's local position is carried through the SAME transform that maps the
// mesh's own vertices to world space, so using the mesh's own coordinates directly (not re-scaled)
// lands exactly where the panel is. Measured directly off Light.glb's mesh (the panel is the y>0.17
// band of the raw vertex data).
const KEY_LIGHT_OFFSET=new vec3(0.0095,0.235,0.08);
// "100%" baseline for the Light asset's Intensity dial — the light's original always-on brightness.
const KEY_LIGHT_INTENSITY=1;
// Real key light stands are elevated and angled down toward the subject; without this the beam aims
// dead level and sails clean over anyone shorter than the panel (measured ~32° miss against a seated
// subject placed a stand's length away — comfortably outside any plausible spot cone). Tilting the
// bulb down around its own local +X compensates without touching the marker's own yaw.
const KEY_LIGHT_TILT_DOWN=30*Math.PI/180;
// Stand-in glow for the diffuser panel — see buildGlowDisc. A sphere rather than a flat disc: the
// GLB's "Scenes"/"Scene" wrapper nodes may carry a rotation we can't see from vertex data alone, so a
// flat disc's facing direction isn't reliable — a sphere looks right from every angle regardless.
// The panel actually has two nested surfaces: a big octagonal diffuser rim (radius up to ~0.1) and a
// small parabolic reflector dish inside it — flat back wall around z=-0.008, opening widening out to
// z~0.073 at its own front rim, isolated by binning panel vertices by radius from the center axis
// (radius <~0.09 is the dish; beyond that is the diffuser fabric). Placed mid-dish so it sits inside
// the reflector, visible through the opening, without poking past its rim from most viewing angles.
const GLOW_OFFSET=new vec3(0.009,0.25,0.038);
const GLOW_RADIUS=0.016;
const TOOL_NAMES=["Camera","Light","Note","Standing","Seated"];
const PALETTE_DISTANCE=110;
const PALETTE_HEIGHT_OFFSET=-14;
const PALETTE_FOLLOW_EASE=4;
const PALETTE_COLLAPSED_SIDE_OFFSET=20; // shifts the collapsed toolbar toward the right edge of view instead of dead center
// Hysteresis band (cm/s of head movement) so the palette doesn't flicker collapsed/expanded near one threshold.
const FAST_MOVE_SPEED=130;
const SLOW_MOVE_SPEED=60;

const SELECT=requireAsset("../GeneratedSFX/ScoutSelect.wav") as AudioTrackAsset;
const PLACE=requireAsset("../GeneratedSFX/ScoutPlace.wav") as AudioTrackAsset;

/** Domain state + placement. SIK provides both hand and editor mouse input. */
@component
export class ScoutMain extends BaseScriptComponent {
  @input @hint("Palette view") palette:ScoutPaletteUI;
  @input @hint("Authored parent for placed markers") markers:SceneObject;
  @input @hint("Authored placement preview") placementPreview:SceneObject;
  @input @hint("World tracking camera") camera:Camera;
  @input @hint("Vertex color material") markerMaterial:Material;
  @input @hint("Distance from the camera for midair placement, centimeters") @widget(new SliderWidget(100,500,10)) placementDistance:number=300;
  @input @hint("Maximum markers kept in this sandbox") @widget(new SliderWidget(1,30,1)) maxMarkers:number=20;
  @input @hint("Show collider wireframes for learning and debugging") debugColliders:boolean=false;
  @input @hint("Volume of select and placement cues") @widget(new SliderWidget(0,1,0.05)) sfxVolume:number=0.25;
  @input connectedLensModule:ConnectedLensModule;
  @input cloudStorageModule:CloudStorageModule;
  @input @allowUndefined cameraPrefab:ObjectPrefab;
  @input @allowUndefined lightPrefab:ObjectPrefab;
  @input @allowUndefined standingPrefab:ObjectPrefab;
  @input @allowUndefined seatedPrefab:ObjectPrefab;
  // Onboarding workbench gear (generated models); any left empty is simply skipped.
  @input @allowUndefined workbenchPrefab:ObjectPrefab;
  @input @allowUndefined cinemaCameraPrefab:ObjectPrefab;
  @input @allowUndefined gimbalPrefab:ObjectPrefab;
  @input @allowUndefined lensPrefab:ObjectPrefab;
  @input @allowUndefined clapperboardPrefab:ObjectPrefab;
  @input @allowUndefined filmReelPrefab:ObjectPrefab;
  @input @allowUndefined photoCameraPrefab:ObjectPrefab;
  private shared:ScoutSharedSession;
  private kinds:number[]=[];
  private groundY:number[]=[]; // real-surface Y each marker stands on (its lowest point, not its root)
  // Camera and Light are two separate state systems — separate types, separate arrays — that only
  // happen to be indexed in parallel with `placed`/`kinds`. Each entry is a fresh object made by
  // defaultCameraState()/defaultLightState() per marker, so no two assets can ever share one.
  private cameraStates:(CameraAssetState|null)[]=[];
  private lightStates:(LightAssetState|null)[]=[];
  private lightRefs:(LightMarkerRef|null)[]=[];
  private noteStates:(NoteAssetState|null)[]=[];
  private selected=0;
  private editing:SceneObject=null;
  private gizmo:ScoutTransformGizmo;
  private paletteTransform:Transform;
  private prevCameraPos:vec3=null;
  private movingFast=false;
  private sequence=0;
  private placed:SceneObject[]=[];
  private previewShape:SceneObject;
  private previewGroundY:number=null;
  private previewPoint:vec3=null;
  private groundIndicator:SceneObject;
  private groundIndicatorImage:Image;
  private interactors:Interactor[]=[];
  private lastAction=-100;
  private selectAudio:AudioComponent;
  private placeAudio:AudioComponent;
  private ready=false;
  private pinched=[false,false];
  private hitSession:HitTestSession;
  // The floor nothing placed may sink beneath: confirmed by the user in floor setup (then locked), or —
  // if they skipped it — the lowest flat surface seen a plausible distance below the head.
  private floorY:number=null;
  private floorLocked=false;
  private floorSetup:ScoutFloorSetup;
  private paletteShown=true;
  private previewHitTime=-100;
  private pending:{kind:number;ray:PointerRay;aim:vec3;started:number}=null;
  private spinner:SceneObject;
  private hint:SceneObject;
  private hintText:Text;
  private hintUntil=-100;
  private hoverHalo:SceneObject;
  private hoverHaloImage:Image;
  private hoverLevel=0;
  private hovered:SceneObject=null;
  private layouts:ScoutLayoutStore;
  private posters:SceneObject[]=[];
  // Moodboard → "Pin a Poster": the cursor looks for walls instead of floor until a poster is pinned.
  private pinningPoster=false;
  private posterGhost:SceneObject;
  private wallHit:{position:vec3;normal:vec3;time:number}=null;
  // Saved layout currently being named by voice, and what's been heard so far.
  private listening:{id:string;started:number;heard:string}=null;
  // Onboarding: after the floor is set, the "What are you planning?" bench picks a photo or video shoot.
  private workbench:ScoutWorkbench;
  private workbenchShown=false;
  private shootType:ShootType=null;

  onAwake():void {
    this.createEvent("OnStartEvent").bind(()=>this.start());
    this.createEvent("UpdateEvent").bind(()=>this.update());
    // LateUpdate so the floor clamp runs after SIK's manipulation has moved a marker this frame.
    this.createEvent("LateUpdateEvent").bind(()=>this.lateUpdate());
  }
  private start():void {
    if(!this.palette||!this.markers||!this.placementPreview||!this.camera||!this.markerMaterial){console.error("Scout: required scene references are missing");return}
    this.palette.setBadgeMaterial(this.markerMaterial);
    this.selectAudio=this.audio(SELECT);this.placeAudio=this.audio(PLACE);
    this.palette.onSelect.add(kind=>{this.pinningPoster=false;this.selected=kind;this.lastAction=getTime();this.selectAudio.play(1);this.rebuildPreview();this.refresh()});
    this.gizmo=new ScoutTransformGizmo(this.markerMaterial,this.camera,()=>{this.lastAction=getTime();});
    this.hitSession=WorldQuery.createHitTestSessionWithOptions(HitTestSessionOptions.create());
    this.hitSession.start();
    this.palette.onUndo.add(()=>this.undo());
    this.palette.onClear.add(()=>this.clear());
    // Manual planning frame; automatic physical relocalization is a later layer.
    this.markers.getTransform().setWorldPosition(this.camera.getTransform().getWorldPosition());
    this.markers.getTransform().setWorldRotation(this.camera.getTransform().getWorldRotation());
    this.paletteTransform=this.palette.sceneObject.getTransform();
    if(this.connectedLensModule&&this.cloudStorageModule){
      this.shared=new ScoutSharedSession(this.connectedLensModule,this.cloudStorageModule,text=>this.palette.setSharedStatus(text));
      this.palette.onConnect.add(()=>{this.lastAction=getTime();this.shared.connect();});
      this.palette.onInvite.add(()=>{this.lastAction=getTime();this.shared.invite();});
      this.palette.onSave.add(()=>{this.lastAction=getTime();this.shared.save(this.snapshot());});
      this.palette.onRecover.add(()=>{this.lastAction=getTime();this.shared.load(raw=>this.restore(raw));});
    }
    this.buildGroundIndicator();
    this.buildPlacementFeedback();
    this.buildHoverHalo();
    this.floorSetup=new ScoutFloorSetup(this.markerMaterial,this.camera,y=>this.confirmFloor(y));
    this.palette.onResetFloor.add(()=>this.resetFloor());
    this.workbench=new ScoutWorkbench(this.markerMaterial,this.camera,{
      bench:this.workbenchPrefab,cinemaCamera:this.cinemaCameraPrefab,gimbal:this.gimbalPrefab,lens:this.lensPrefab,
      clapperboard:this.clapperboardPrefab,filmReel:this.filmReelPrefab,photoCamera:this.photoCameraPrefab,
    },type=>this.chooseShoot(type));
    this.layouts=new ScoutLayoutStore();
    this.palette.setLayouts(this.layouts.list());
    this.palette.onSaveLayout.add(()=>this.saveLayout());
    this.palette.onLoadLayout.add(id=>this.loadLayout(id));
    this.palette.onRenameLayout.add(id=>this.renameLayout(id));
    this.palette.onVoiceRenameLayout.add(id=>this.voiceRenameLayout(id));
    this.palette.onDeleteLayout.add(id=>{this.lastAction=getTime();this.layouts.remove(id);this.palette.setLayouts(this.layouts.list());this.selectAudio.play(1);});
    this.posterGhost=buildPoster(this.markerMaterial,true);this.posterGhost.enabled=false;
    this.palette.onPinPoster.add(()=>{this.lastAction=getTime();this.pending=null;this.pinningPoster=true;this.wallHit=null;});
    this.rebuildPreview();this.refresh();this.ready=true;
    console.log("Scout ready: point at the floor to set it, then choose equipment, notes, or actors.");
  }
  private audio(track:AudioTrackAsset):AudioComponent {
    const audio=this.sceneObject.createComponent("Component.AudioComponent") as AudioComponent;
    audio.audioTrack=track;audio.volume=this.sfxVolume;audio.playbackMode=Audio.PlaybackMode.LowLatency;return audio;
  }
  private rebuildPreview():void {
    if(this.previewShape&&!isNull(this.previewShape))this.previewShape.destroy();
    if(this.selected===HAND_KIND){this.previewShape=null;return}
    const prefab=this.prefabFor(this.selected);
    if(prefab){
      this.previewShape=prefab.instantiate(this.placementPreview);
      // A small cursor model indicates the selected tool without hiding the venue. Stand it on the ground
      // grid by its lowest point (not its pivot), the same way placed markers stand on the floor.
      const visual=findMeshVisual(this.previewShape);
      if(visual)this.previewShape.getTransform().setLocalPosition(new vec3(0,this.placementPreview.getTransform().getWorldPosition().y-visual.worldAabbMin().y,0));
    }else if(this.selected===2){
      // The Note's pin+notepad is too tall/wide to usefully preview while just aiming — the pulsing
      // ground indicator (built once, shared by every asset type) is enough to show where it'll land.
      this.previewShape=null;
    }else this.previewShape=buildMarkerMesh(this.placementPreview,this.selected,this.markerMaterial,true);
  }
  /** Flat glowing grid decal on the real floor, showing where the selected asset will land. */
  private buildGroundIndicator():void {
    const so=global.scene.createSceneObject("GroundIndicator");
    // Tip the quad from facing the camera (+Z) to facing straight up (+Y), so it lies flat on the floor.
    so.getTransform().setLocalRotation(quat.angleAxis(-Math.PI/2,vec3.right()));
    const img=so.createComponent("Component.Image") as Image;
    img.mainMaterial=IMAGE_MATERIAL_ASSET.clone();
    img.mainPass.baseTex=GROUND_INDICATOR;
    img.mainPass.baseColor=GROUND_INDICATOR_COLOR;
    this.groundIndicator=so;this.groundIndicatorImage=img;
  }
  private update():void {
    if(!this.ready)return;
    this.shared?.tick();
    this.gizmo.update();
    this.followPalette();
    const all=InteractionManager.getInstance().getInteractorsByType(InteractorInputType.All);
    all.forEach(interactor=>{
      if(this.interactors.indexOf(interactor)>=0)return;
      this.interactors.push(interactor);
      interactor.onTriggerStart.add(target=>{
        if(interactor.inputType===InteractorInputType.Mouse && !target && (this.selected!==HAND_KIND||this.pinningPoster) && getTime()-this.lastAction>0.25) this.placeAt(interactor);
      });
    });
    // Hand pinch remains available in empty space even when SIK has no direct target.
    (["left","right"] as const).forEach((side,index)=>{
      const hand=HandInputData.getInstance().getHand(side);
      const down=hand.isPinching();
      const interactor=all.find(i=>i.inputType===(index===0?InteractorInputType.LeftHand:InteractorInputType.RightHand));
      if(down&&!this.pinched[index]&&!interactor?.currentInteractable&&(this.selected!==HAND_KIND||this.pinningPoster)&&getTime()-this.lastAction>0.25){
        this.placeAt(interactor);
      }
      this.pinched[index]=down;
    });
    const active=all.find(i=>i.isActive()&&i.isTargeting());
    // A lingering target on the palette itself (e.g. right after tapping a toolbar icon) shouldn't
    // suppress the placement guides — only a real scene object (a placed marker, a gizmo handle) should.
    const blocking=active?.currentInteractable&&!this.isPaletteTarget(active.currentInteractable);
    const canPlace=!blocking&&this.placed.length<this.maxMarkers&&this.selected!==HAND_KIND;
    const ray=this.rayFor(active);
    const aim=this.positionFor(active);
    this.surfaceHitTest(ray,aim,point=>{
      if(!point)return;
      this.previewGroundY=point.y;this.previewPoint=point;this.previewHitTime=getTime();
      this.noteSurface(point.y);
    });
    // First run: nothing can be placed (and the palette stays hidden) until the floor is set and a shoot
    // type is picked at the workbench. The bench only stands on a real floor height: after a skipped setup
    // it waits (with the "look at the floor" hint) until surface tracking first sees the floor.
    const benchWaiting=this.floorSetup.done&&this.shootType===null&&!this.workbenchShown;
    if(benchWaiting&&this.floorY!==null){
      this.workbenchShown=true;
      this.workbench.show(this.floorY);
    }
    const settingUp=!this.floorSetup.done||(benchWaiting&&!this.workbenchShown)||this.workbench.active;
    if(this.paletteShown===settingUp){this.paletteShown=!settingUp;this.palette.sceneObject.enabled=!settingUp;}
    const freshHit=getTime()-this.previewHitTime<PREVIEW_HIT_FRESH?this.previewPoint:null;
    this.floorSetup.update(freshHit&&this.isFloorHeight(freshHit.y)?freshHit:null,aim);
    if(settingUp||this.pinningPoster){
      this.placementPreview.enabled=false;
      this.updateGroundIndicator(false,aim);
      this.updatePosterGhost(ray,aim);
      this.updatePlacementFeedback(benchWaiting&&!this.workbenchShown,ray,aim);
      return;
    }
    this.posterGhost.enabled=false;
    // No fresh hit under the cursor: fall back to the known floor, never to the midair aim height.
    const surfaceY=getTime()-this.previewHitTime<PREVIEW_HIT_FRESH?this.previewGroundY:this.floorY;
    // Hits only arrive a few times a second, so the spot itself is recomputed every frame as where the
    // pointing ray meets that surface height — the grid tracks the cursor smoothly and lands where you aim.
    const spot=surfaceY===null?aim:this.onPlane(ray,aim,surfaceY);
    this.placementPreview.enabled=canPlace&&surfaceY!==null&&!this.pending;
    this.placementPreview.getTransform().setWorldPosition(spot);
    // Face the user upright at placement; manipulation can adjust the orientation.
    const f=this.camera.getTransform().forward;
    this.placementPreview.getTransform().setWorldRotation(quat.angleAxis(Math.atan2(f.x,f.z),vec3.up()));
    this.updateGroundIndicator(canPlace&&surfaceY!==null&&!this.pending,spot);
    this.updatePending();
    this.updatePlacementFeedback(canPlace&&surfaceY===null,ray,aim);
  }
  private lateUpdate():void {
    if(!this.ready)return;
    this.updateListening();
    this.keepAboveFloor();
    this.updateHoverHalo();
  }
  private isFlat(result:WorldQueryHitTestResult):boolean {
    return !!result&&result.normal.y>FLAT_NORMAL_Y;
  }
  private confirmFloor(y:number):void {
    // On a reset, markers that were standing on the old floor move to the new one with it, so a floor
    // that was set wrong doesn't leave everything floating or buried.
    const old=this.floorY;
    if(old!==null)this.placed.forEach((root,i)=>{
      if(isNull(root)||Math.abs(this.bottomOf(root)-old)>3)return;
      this.liftOnto(root,y);this.groundY[i]=y;
    });
    this.floorY=y;this.floorLocked=true;this.placeAudio.play(1);
    console.log("Scout floor set at "+y.toFixed(1));
  }
  /** Menu → Reset Floor: back to floor setup; placement pauses until it's confirmed again. */
  private resetFloor():void {
    this.lastAction=getTime();
    this.pending=null;
    // The old floor stays locked until the new one is confirmed (or setup is skipped, which keeps it),
    // so markers standing on it can be recognised and moved across in confirmFloor.
    this.gizmo.select(null);this.editing=null;
    this.floorSetup.restart();
    this.selectAudio.play(1);
  }
  /** Whether a surface is a plausible distance below the user's head to be the floor. */
  private isFloorHeight(y:number):boolean {
    const head=this.camera.getTransform().getWorldPosition().y;
    return y<=head-FLOOR_MIN_DROP&&y>=head-FLOOR_MAX_DROP;
  }
  /** Without a confirmed floor, tracks it as the lowest flat surface seen at floor height. */
  private noteSurface(y:number):void {
    if(this.floorLocked||!this.isFloorHeight(y))return;
    if(this.floorY===null||y<this.floorY)this.floorY=y;
  }
  /** World Y of a marker's lowest point, measured from its actual mesh so it's right whatever pivot the
   * model was exported with. */
  private bottomOf(root:SceneObject):number {
    const visual=findMeshVisual(root);
    return visual?visual.worldAabbMin().y:root.getTransform().getWorldPosition().y;
  }
  /** Drops `body` (a fresh marker's pivot, still at the root's origin) to its mesh's lowest point while
   * keeping the mesh where it is, so scaling `body` grows the prop up from its feet. */
  private pivotAtFeet(root:SceneObject,body:SceneObject):void {
    const visual=findMeshVisual(body);
    if(!visual)return;
    const feet=visual.worldAabbMin().y-root.getTransform().getWorldPosition().y;
    body.getTransform().setLocalPosition(new vec3(0,feet,0));
    for(let i=0;i<body.getChildrenCount();i++){
      const t=body.getChild(i).getTransform();
      t.setLocalPosition(t.getLocalPosition().sub(new vec3(0,feet,0)));
    }
  }
  /** Moves a marker vertically so its lowest point rests at `surfaceY`. */
  private liftOnto(root:SceneObject,surfaceY:number):void {
    const t=root.getTransform();
    t.setWorldPosition(t.getWorldPosition().add(new vec3(0,surfaceY-this.bottomOf(root),0)));
  }
  /** Nothing may sit below the floor — not after a grab, a gizmo drag, or a restored layout. */
  private keepAboveFloor():void {
    this.placed.forEach((root,i)=>{
      if(isNull(root))return;
      const floor=this.floorY===null?this.groundY[i]:this.floorY;
      if(this.bottomOf(root)<floor-0.5){
        this.liftOnto(root,floor);
        if(this.editing===root)this.gizmo.update();
      }
    });
  }
  /** After a free grab-and-move, drops the marker onto the real surface under it so it never stays
   * hanging midair. With no hit (surface out of view) it's left where it is — the floor clamp still holds. */
  private settleOnSurface(root:SceneObject):void {
    if(isNull(root))return;
    const p=root.getTransform().getWorldPosition();
    this.groundHitTest(new vec3(p.x,this.bottomOf(root),p.z),result=>{
      if(isNull(root)||!this.isFlat(result))return;
      const idx=this.placed.indexOf(root);
      if(idx<0)return;
      this.noteSurface(result.position.y);
      this.groundY[idx]=result.position.y;
      this.liftOnto(root,result.position.y);
      if(this.editing===root)this.gizmo.update();
    });
  }
  /** Resolves a queued pinch: places on the first flat hit, or on the known floor once the search window
   * runs out, or — if no floor has ever been seen — cancels with a hint instead of dropping it midair. */
  private updatePending():void {
    const p=this.pending;
    if(!p)return;
    this.surfaceHitTest(p.ray,p.aim,point=>{
      if(this.pending!==p||!point)return;
      this.pending=null;
      this.noteSurface(point.y);
      this.spawnMarker(p.kind,point);
    });
    if(getTime()-p.started<PLACE_SEARCH_SECONDS)return;
    this.pending=null;
    if(this.floorY!==null)this.spawnMarker(p.kind,this.onPlane(p.ray,p.aim,this.floorY));
    else this.showHint(this.floorHint(p.ray));
  }
  private floorHint(ray:PointerRay):string {
    if(ray.dir.y<STEEP_POINTING)return "Step back so Specs can see the floor";
    if(ray.dir.y>LEVEL_POINTING)return "Look down at the floor";
    return "Hold steady on the floor";
  }
  private showHint(text:string):void {
    this.hintText.text=text;
    this.hintUntil=getTime()+HINT_SECONDS;
  }
  /** Green spinner + hint text at the cursor: while a pinch is waiting on surface tracking, and while no
   * floor has been found yet at all (so there's nothing honest to show a placement grid on). */
  private updatePlacementFeedback(searching:boolean,ray:PointerRay,aim:vec3):void {
    const p=this.pending;
    const spinning=!!p||searching;
    const anchor=p?(this.floorY===null?p.aim:this.onPlane(p.ray,p.aim,this.floorY)):aim;
    const hinting=spinning||getTime()<this.hintUntil;
    this.spinner.enabled=spinning;
    this.hint.enabled=hinting;
    if(!spinning&&!hinting)return;
    const toCamera=this.camera.getTransform().getWorldPosition().sub(anchor).normalize();
    const facing=quat.lookAt(toCamera,vec3.up());
    if(spinning){
      this.spinner.getTransform().setWorldPosition(anchor);
      this.spinner.getTransform().setWorldRotation(facing.multiply(quat.angleAxis(-getTime()*SPINNER_SPEED,vec3.forward())));
      this.hintText.text=p?"Finding the floor…":this.floorHint(ray);
    }
    this.hint.getTransform().setWorldPosition(anchor.add(new vec3(0,SPINNER_RADIUS+6,0)));
    this.hint.getTransform().setWorldRotation(facing);
  }
  /** A three-quarter ring whose brightness fades toward its tail — on an additive display the dim end
   * simply vanishes, so it reads as a spinning comet. Drawn over everything, like the gizmo handles. */
  private buildPlacementFeedback():void {
    const spinner=global.scene.createSceneObject("PlacementSpinner");
    const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
    b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;
    const segs=36,sweep=1.5*Math.PI,inner=SPINNER_RADIUS-0.7,outer=SPINNER_RADIUS+0.7;
    const ix:number[]=[];
    for(let i=0;i<=segs;i++){
      const a=i/segs*sweep,k=0.15+0.85*i/segs;
      const c=[SPINNER_COLOR.x*k,SPINNER_COLOR.y*k,SPINNER_COLOR.z*k,1];
      b.appendVerticesInterleaved([inner*Math.cos(a),inner*Math.sin(a),0,0,0,1,...c]);
      b.appendVerticesInterleaved([outer*Math.cos(a),outer*Math.sin(a),0,0,0,1,...c]);
      // Both windings so the flat ring shows from either side.
      if(i<segs){const v=i*2;ix.push(v,v+1,v+3,v,v+3,v+2,v,v+3,v+1,v,v+2,v+3);}
    }
    b.appendIndices(ix);
    const visual=spinner.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    const material=this.markerMaterial.clone();
    material.mainPass.depthTest=false;material.mainPass.depthWrite=false;
    visual.mesh=b.getMesh();visual.mainMaterial=material;visual.setRenderOrder(100);b.updateMesh();
    spinner.enabled=false;
    this.spinner=spinner;
    const hint=global.scene.createSceneObject("PlacementHint");
    const t=hint.createComponent("Component.Text") as Text;
    t.font=HINT_FONT;t.size=180;t.textFill.color=HINT_COLOR;t.depthTest=false;
    t.horizontalAlignment=HorizontalAlignment.Center;t.verticalAlignment=VerticalAlignment.Bottom;
    t.horizontalOverflow=HorizontalOverflow.Overflow;t.verticalOverflow=VerticalOverflow.Overflow;
    hint.enabled=false;
    this.hint=hint;this.hintText=t;
  }
  /** Soft purple glow on the floor under whichever placed marker the cursor is on. */
  private buildHoverHalo():void {
    const so=global.scene.createSceneObject("HoverHalo");
    so.getTransform().setLocalRotation(quat.angleAxis(-Math.PI/2,vec3.right()));
    const img=so.createComponent("Component.Image") as Image;
    img.mainMaterial=IMAGE_MATERIAL_ASSET.clone();
    img.mainPass.baseTex=HOVER_HALO;
    so.enabled=false;
    this.hoverHalo=so;this.hoverHaloImage=img;
  }
  private updateHoverHalo():void {
    const target=this.hovered&&!isNull(this.hovered)&&this.placed.indexOf(this.hovered)>=0?this.hovered:null;
    if(!target)this.hovered=null;
    const goal=target?1:0;
    this.hoverLevel+=(goal-this.hoverLevel)*Math.min(1,getDeltaTime()*HOVER_HALO_EASE);
    if(this.hoverLevel<0.01&&!target){this.hoverHalo.enabled=false;return}
    this.hoverHalo.enabled=true;
    if(target){
      const idx=this.placed.indexOf(target);
      const p=target.getTransform().getWorldPosition();
      this.hoverHalo.getTransform().setWorldPosition(new vec3(p.x,this.bottomOf(target)+GROUND_INDICATOR_LIFT,p.z));
      const size=GROUND_INDICATOR_FOOTPRINTS[this.kinds[idx]]*1.6;
      this.hoverHalo.getTransform().setLocalScale(new vec3(size,size,1));
    }
    this.hoverHaloImage.mainPass.baseColor=new vec4(HOVER_GLOW.x,HOVER_GLOW.y,HOVER_GLOW.z,HOVER_HALO_ALPHA*this.hoverLevel);
  }
  /** True if a targeted interactable belongs to the palette (buttons, badges, the cap) rather than the 3D scene. */
  private isPaletteTarget(interactable:{sceneObject?:SceneObject}):boolean {
    let node=interactable?.sceneObject;
    while(node){
      if(node===this.palette.sceneObject)return true;
      node=node.getParent();
    }
    return false;
  }
  /** Pulses a glowing grid on the floor under the placement preview, sized to the selected asset's footprint. */
  private updateGroundIndicator(visible:boolean,groundPosition:vec3):void {
    if(!this.groundIndicator)return;
    this.groundIndicator.enabled=visible;
    if(!visible)return;
    this.groundIndicator.getTransform().setWorldPosition(groundPosition.add(new vec3(0,GROUND_INDICATOR_LIFT,0)));
    const pulse=1+Math.sin(getTime()*GROUND_PULSE_SPEED)*GROUND_PULSE_DEPTH;
    const size=GROUND_INDICATOR_FOOTPRINTS[this.selected]*pulse;
    this.groundIndicator.getTransform().setLocalScale(new vec3(size,size,1));
    if(this.groundIndicatorImage)this.groundIndicatorImage.mainPass.baseColor=new vec4(
      GROUND_INDICATOR_COLOR.x,GROUND_INDICATOR_COLOR.y,GROUND_INDICATOR_COLOR.z,
      GROUND_INDICATOR_COLOR.w*(0.75+0.25*Math.sin(getTime()*GROUND_PULSE_SPEED))
    );
  }
  /** Casts straight down from above `position` to find the real-world floor via surface tracking. */
  private groundHitTest(position:vec3,callback:(result:WorldQueryHitTestResult)=>void):void {
    if(!this.hitSession){callback(null);return}
    // Never start the cast below head height — an aim point past the floor would otherwise start under it.
    const top=new vec3(position.x,Math.max(position.y+80,this.camera.getTransform().getWorldPosition().y),position.z);
    const bottom=new vec3(position.x,position.y-400,position.z);
    this.hitSession.hitTest(top,bottom,result=>callback(result));
  }
  /** Keeps the palette a fixed distance in front of the user, smoothly trailing head movement instead of staying pinned in world space. */
  private followPalette():void {
    const camT=this.camera.getTransform();
    const camPos=camT.getWorldPosition();
    if(this.prevCameraPos){
      const speed=camPos.sub(this.prevCameraPos).length/Math.max(getDeltaTime(),1/240);
      if(!this.movingFast&&speed>FAST_MOVE_SPEED)this.movingFast=true;
      else if(this.movingFast&&speed<SLOW_MOVE_SPEED)this.movingFast=false;
      this.palette.setAutoCollapsed(this.movingFast);
    }
    this.prevCameraPos=camPos;
    const forward=camT.forward.uniformScale(-1);
    const side=this.palette.isCollapsed?camT.left.uniformScale(-PALETTE_COLLAPSED_SIDE_OFFSET):vec3.zero();
    const target=camPos.add(forward.uniformScale(PALETTE_DISTANCE)).add(new vec3(0,PALETTE_HEIGHT_OFFSET,0)).add(side);
    const ease=Math.min(1,getDeltaTime()*PALETTE_FOLLOW_EASE);
    const pos=this.paletteTransform.getWorldPosition();
    this.paletteTransform.setWorldPosition(pos.add(target.sub(pos).uniformScale(ease)));
    const f=camT.forward;
    const targetRot=quat.angleAxis(Math.atan2(f.x,f.z),vec3.up());
    this.paletteTransform.setWorldRotation(quat.slerp(this.paletteTransform.getWorldRotation(),targetRot,ease));
  }
  /** Finds the real surface the user is pointing at: along the pointing ray first (so things land where
   * they aim, even looking steeply down), then straight down from the midair aim point. Yields the point
   * to stand on, or null when nothing flat was found. */
  private surfaceHitTest(ray:PointerRay,aim:vec3,callback:(point:vec3)=>void):void {
    if(!this.hitSession){callback(null);return}
    this.hitSession.hitTest(ray.start,ray.start.add(ray.dir.uniformScale(RAY_REACH)),hit=>{
      if(this.isFlat(hit)){callback(hit.position);return}
      this.groundHitTest(aim,down=>callback(this.isFlat(down)?this.onPlane(ray,aim,down.position.y):null));
    });
  }
  /** Where the pointing ray crosses height `y`; under the aim point instead when the ray never gets there. */
  private onPlane(ray:PointerRay,aim:vec3,y:number):vec3 {
    const t=ray.dir.y<-0.05?(y-ray.start.y)/ray.dir.y:-1;
    return t>0&&t<RAY_REACH?ray.start.add(ray.dir.uniformScale(t)):new vec3(aim.x,y,aim.z);
  }
  private rayFor(interactor?:Interactor):PointerRay {
    if(interactor?.startPoint&&interactor?.direction)return {start:interactor.startPoint,dir:interactor.direction.normalize()};
    const cam=this.camera.getTransform();
    return {start:cam.getWorldPosition(),dir:cam.forward.uniformScale(-1)};
  }
  private positionFor(interactor?:Interactor):vec3 {
    const cam=this.camera.getTransform();
    const start=interactor?.startPoint;
    const direction=interactor?.direction;
    if(start&&direction){
      const forward=cam.forward.uniformScale(-1);
      const denom=direction.dot(forward);
      const t=denom>0.1?(this.placementDistance-start.sub(cam.getWorldPosition()).dot(forward))/denom:this.placementDistance;
      return start.add(direction.uniformScale(Math.max(20,Math.min(500,t))));
    }
    return cam.getWorldPosition().add(cam.forward.uniformScale(-this.placementDistance));
  }
  private placeAt(interactor?:Interactor):void {
    if(!this.floorSetup.done){
      if(this.floorSetup.canSkip){this.lastAction=getTime();this.floorSetup.skip();}
      return;
    }
    if(this.workbench.active)return;
    if(this.pinningPoster){this.pinPoster();return}
    if(this.placed.length>=this.maxMarkers){this.palette.setHint("Marker limit reached — Undo or Clear All");return}
    if(this.pending)return;
    this.lastAction=getTime();
    // Queued, not placed: updatePending waits (spinner showing) for a real surface under the aim point.
    this.pending={kind:this.selected,ray:this.rayFor(interactor),aim:this.positionFor(interactor),started:getTime()};
  }
  /** `position` is the point on the real surface; the marker's lowest point is stood on it. */
  private spawnMarker(kind:number,position:vec3):void {
    const label=TOOL_NAMES[kind]+" "+String(++this.sequence).padStart(2,"0");
    const root=this.makeMarker(kind,label,position.y);
    root.getTransform().setWorldPosition(position);
    const f=this.camera.getTransform().forward;
    // The Camera prop's real lens/back axis is its local X, not Z (confirmed by standing at each of
    // root's +-X/+-Z directions and matching against the model's own LCD screen) — everywhere else in
    // this idiom assumes Z, so without this extra quarter turn the whole rig (and its faceBack-mounted
    // dial/label card) ends up facing 90° off, sideways to whoever just placed it.
    const cameraCorrection=kind===0?Math.PI/2:0;
    root.getTransform().setWorldRotation(quat.angleAxis(Math.atan2(f.x,f.z)+cameraCorrection,vec3.up()));
    // The models' pivots aren't at their feet (the Camera's mesh was centered on the floor, half buried),
    // so stand each on its actual lowest point rather than its pivot.
    this.liftOnto(root,position.y);
    if(kind===1)this.tiltKeyLight(root);
    this.placeAudio.play(1);this.refresh();
    console.log("Scout placed "+label);
  }
  /** Angles the key light down toward eye level for a typically-shorter seated/standing subject.
   * Must run after root's final camera-facing rotation is set (spawnMarker/restore) — computing this
   * any earlier tilts relative to whatever stale rotation the fresh marker happened to have. */
  private tiltKeyLight(root:SceneObject):void {
    const bulb=findChildNamed(root,"Bulb");
    if(!bulb)return;
    const forward=bulb.getTransform().forward;
    const tilted=forward.uniformScale(Math.cos(KEY_LIGHT_TILT_DOWN)).sub(vec3.up().uniformScale(Math.sin(KEY_LIGHT_TILT_DOWN))).normalize();
    // quat.lookAt(X,up) orients the bulb so its own transform.forward (+Z) equals X — but a
    // Directional LightSource, like a Camera (see AGENTS.md's "identity rotation faces −Z" note),
    // actually emits along its local −Z, the opposite of that transform.forward axis. Feeding the
    // NEGATED target here compensates, so the real beam ends up pointing at `tilted` instead of away
    // from it — this was shining the softbox out its back panel instead of through the diffuser.
    bulb.getTransform().setWorldRotation(quat.lookAt(tilted.uniformScale(-1),vec3.up()));
  }
  private prefabFor(kind:number):ObjectPrefab {return [this.cameraPrefab,this.lightPrefab,null,this.standingPrefab,this.seatedPrefab][kind];}
  private makeMarker(kind:number,label:string,groundY:number,saved?:MarkerRecord):SceneObject {
    const root=global.scene.createSceneObject(label);root.setParent(this.markers);
    const prefab=this.prefabFor(kind),height=MODEL_HEIGHTS[kind];
    const cameraState=kind===0?{...defaultCameraState(),...saved?.cameraState}:null;
    const lightState=kind===1?{...defaultLightState(),...saved?.lightState}:null;
    const noteState=kind===2?{...defaultNoteState(),...saved?.noteState}:null;
    let lightRef:LightMarkerRef|null=null;
    // The prop's body hangs under a pivot at its feet (kept the root's first child, so bottomOf still
    // finds the body's mesh first): hover grows the pivot, so the prop swells up from the floor.
    const body=global.scene.createSceneObject("Body");body.setParent(root);
    if(prefab){
      const model=prefab.instantiate(body),t=model.getTransform();
      t.setLocalScale(t.getLocalScale().uniformScale(height/30));
      t.setLocalPosition(new vec3(0,-height/2,0));
      this.pivotAtFeet(root,body);
      if(lightState)lightRef=this.buildKeyLight(model,lightState);
      // Standing/seated subjects both cast and receive shadows on themselves so a nearby key light
      // actually shows contours (nose, contact shadows) on the subject, not just floodlighting it.
      if(kind===3||kind===4){
        const visual=findMeshVisual(model);
        if(visual)visual.meshShadowMode=MeshShadowMode.Both;
      }
    }else{
      buildMarkerMesh(body,kind,this.markerMaterial,false);
      this.pivotAtFeet(root,body);
    }
    // Note's pin rises from the floor to eye level, so its interactive content anchors near the top of
    // the pin rather than just above a ground-level card, like every other asset's label/dial row does.
    const labelY=kind===2?NOTE_PIN_HEIGHT:height/2+8;
    if(noteState){
      this.palette.buildNoteWizard(root,label,labelY,noteState,patch=>Object.assign(noteState,patch),()=>this.editMarker(root),()=>this.deleteMarker(root),this.shootType==="photo");
    }else{
      this.palette.decorateMarker(root,label,labelY,()=>this.editMarker(root),()=>this.deleteMarker(root),kind===0?1:kind===1?2:0);
    }
    // Two separate systems by design: Camera dials are informational only (no real-world effect is
    // requested for them); Light dials drive the marker's own LightSource/glow directly by closing
    // over `lightRef` — never an array index, so a later deletion of some other marker can't leave
    // this callback pointing at the wrong asset.
    if(cameraState)this.palette.buildCameraControls(root,labelY,cameraState,patch=>Object.assign(cameraState,patch));
    if(lightState){
      const ref=lightRef;
      this.palette.buildLightControls(root,labelY,lightState,patch=>{
        Object.assign(lightState,patch);
        if(ref)this.applyLightLook(ref,lightState);
      });
    }
    const col=root.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const shape=Shape.createBoxShape();shape.size=kind===2?new vec3(14,NOTE_PIN_HEIGHT,14):new vec3(kind>=3?55:70,height,kind>=3?55:70);
    col.shape=shape;col.debugDrawEnabled=this.debugColliders;
    const interactable=root.createComponent(Interactable.getTypeName()) as Interactable;
    interactable.targetingMode=3;
    interactable.onTriggerStart.add(()=>{this.lastAction=getTime();});
    // The floor halo and the grow below track the prop itself, not the label/dials floating above it,
    // whose hover SIK bubbles up to this interactable too.
    const onProp=(e:{target:Interactable})=>{      if(e.target===interactable)this.hovered=root;
      else if(this.hovered===root)this.hovered=null;
    };
    interactable.onHoverEnter.add(onProp);
    interactable.onHoverUpdate.add(onProp);
    interactable.onHoverExit.add(()=>{if(this.hovered===root)this.hovered=null;});
    // The prop itself grows a touch under the cursor, like the buttons, so it reads as grabbable.
    // Notes skip it: their pin carries its own wizard buttons, which already respond to hover.
    if(kind!==2)addHoverFeedback(interactable,body,undefined,MARKER_HOVER_SCALE,true);
    const manipulation=root.createComponent(InteractableManipulation.getTypeName()) as InteractableManipulation;
    manipulation.setCanScale(false);
    manipulation.setCanRotate(false);
    // Only a real move drops back onto the surface — a tap on a child (dial, badge) can propagate a
    // zero-length translation here, and must not knock a deliberately raised actor back to the floor.
    let grabbedAt:vec3=null;
    manipulation.onTranslationStart.add(()=>{grabbedAt=root.getTransform().getWorldPosition();});
    manipulation.onTranslationEnd.add(()=>{
      if(grabbedAt&&!isNull(root)&&root.getTransform().getWorldPosition().distance(grabbedAt)>2)this.settleOnSurface(root);
      grabbedAt=null;
    });
    this.placed.push(root);this.kinds.push(kind);this.groundY.push(groundY);
    this.cameraStates.push(cameraState);this.lightStates.push(lightState);this.lightRefs.push(lightRef);
    this.noteStates.push(noteState);
    return root;
  }
  /** Real-time light on the Light prop so it actually illuminates the scene and casts a shadow, aimed
   * out of the softbox opening (model's local +Z, matching the root −Z / child +Z depth idiom used
   * everywhere placed props are oriented). Color/intensity are set by applyLightLook, driven by this
   * specific instance's own LightAssetState — never a shared constant. */
  private buildKeyLight(model:SceneObject,state:LightAssetState):LightMarkerRef {
    const bulb=global.scene.createSceneObject("Bulb");bulb.setParent(model);
    bulb.getTransform().setLocalPosition(KEY_LIGHT_OFFSET);
    // Tilt is applied later, in spawnMarker/restore — at this point the marker root hasn't been given
    // its final camera-facing rotation yet (that happens after makeMarker returns), so computing a
    // "forward" here would tilt relative to a stale, still-identity orientation.
    const light=bulb.createComponent("Component.LightSource") as LightSource;
    // Spot is what a real key light shines like, but its cone angle is Editor-API-only (StudioLib's
    // LightSource has no angle/cone property at all — grepped the whole class). A Spot built purely at
    // runtime gets a degenerate, effectively zero-width cone and lights nothing, confirmed by comparing
    // against Point (illuminates fine, no shadows) and Directional (illuminates fine, shadows work) in
    // the live preview. Directional trades away real distance falloff — it lights the whole scene from
    // one angle rather than falling off near the stand — but it's the only combination that actually
    // shows both illumination and a cast shadow on a subject.
    light.lightType=LightType.Directional;
    // Shadows are handed out by assignLightShadows (one caster per scene), not per light.
    light.shadowType=ShadowType.None;
    const glowVisual=this.buildGlowDisc(model);
    const ref:LightMarkerRef={light,glowVisual};
    this.applyLightLook(ref,state);
    return ref;
  }
  /** A small brightly-colored sphere standing in for the softbox's diffuser panel actually glowing.
   * Light.glb shares one material across the whole prop (housing + stand + panel), so tinting that
   * material directly would light up the metal stand too — cheaper and safer to hang a separate unlit
   * bulb just in front of the real panel instead of touching the shared GLB material. A sphere rather
   * than a flat disc: the GLB's "Scenes"/"Scene" wrapper nodes may carry a rotation not visible in the
   * raw vertex data, so a flat disc's facing direction can't be trusted — a sphere reads correctly
   * from any angle. Mesh is left empty here; applyLightLook populates it with the instance's own color. */
  private buildGlowDisc(model:SceneObject):RenderMeshVisual {
    const glow=global.scene.createSceneObject("Glow");glow.setParent(model);
    glow.getTransform().setLocalPosition(GLOW_OFFSET);
    const visual=glow.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mainMaterial=this.markerMaterial.clone();
    return visual;
  }
  /** Applies one Light asset's own Kelvin/Intensity dial state to its real LightSource and glow sphere.
   * The only two dials in this whole feature that actually affect anything, per explicit instruction. */
  private applyLightLook(ref:LightMarkerRef,state:LightAssetState):void {
    const kelvin=KELVIN_STOPS[state.kelvinIndex].value;
    const pct=INTENSITY_STOPS[state.intensityIndex].value/100;
    const rgb=kelvinToRGB(kelvin);
    ref.light.intensity=KEY_LIGHT_INTENSITY*pct;
    ref.light.color=rgb;
    this.rebuildGlowMesh(ref.glowVisual,[rgb.x*pct,rgb.y*pct,rgb.z*pct,1]);
  }
  private rebuildGlowMesh(visual:RenderMeshVisual,color:[number,number,number,number]):void {
    const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
    b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;
    const lat=8,lon=12;
    const dir=(i:number,j:number)=>{
      const theta=i*Math.PI/lat,phi=j*2*Math.PI/lon,sinT=Math.sin(theta);
      return [sinT*Math.cos(phi),Math.cos(theta),sinT*Math.sin(phi)];
    };
    let vi=0;
    const addTri=(a:number[],b2:number[],c:number[])=>{
      [a,b2,c].forEach(p=>b.appendVerticesInterleaved([p[0]*GLOW_RADIUS,p[1]*GLOW_RADIUS,p[2]*GLOW_RADIUS, p[0],p[1],p[2], ...color]));
      b.appendIndices([vi,vi+1,vi+2]);vi+=3;
    };
    for(let i=0;i<lat;i++)for(let j=0;j<lon;j++){
      const p00=dir(i,j),p10=dir(i+1,j),p01=dir(i,j+1),p11=dir(i+1,j+1);
      addTri(p00,p11,p10);addTri(p00,p01,p11);
    }
    visual.mesh=b.getMesh();
    b.updateMesh();
  }
  /** Toggles the constrained-axis handles for one specific asset; vertical movement only applies to standing/seated actors. */
  private editMarker(root:SceneObject):void {
    this.lastAction=getTime();
    const idx=this.placed.indexOf(root);
    if(idx<0)return;
    if(this.gizmo.isEditing(root)){this.gizmo.select(null);this.editing=null;return}
    this.editing=root;
    const allowVertical=this.kinds[idx]===3||this.kinds[idx]===4;
    // The gizmo clamps the root, so translate "lowest point on the floor" into a minimum root height.
    const floor=this.floorY===null?this.groundY[idx]:this.floorY;
    const minRootY=root.getTransform().getWorldPosition().y-this.bottomOf(root)+floor;
    this.gizmo.select(root,allowVertical,minRootY);
    this.gizmo.setMode("Show handles");
  }
  private deleteMarker(root:SceneObject):void {
    this.lastAction=getTime();
    const idx=this.placed.indexOf(root);
    if(idx<0)return;
    this.placed.splice(idx,1);this.kinds.splice(idx,1);this.groundY.splice(idx,1);
    this.cameraStates.splice(idx,1);this.lightStates.splice(idx,1);this.lightRefs.splice(idx,1);
    this.noteStates.splice(idx,1);
    if(!isNull(root))root.destroy();
    this.selectAudio.play(1);this.refresh();
  }
  private undo():void {
    this.lastAction=getTime();const obj=this.placed.pop();this.kinds.pop();this.groundY.pop();
    this.cameraStates.pop();this.lightStates.pop();this.lightRefs.pop();this.noteStates.pop();
    if(obj&&!isNull(obj))obj.destroy();this.selectAudio.play(1);this.refresh();
    console.log("Scout undo: "+this.placed.length+" markers remain");
  }
  private clear():void {
    this.lastAction=getTime();this.placed.forEach(obj=>{if(!isNull(obj))obj.destroy()});
    this.posters.forEach(obj=>{if(!isNull(obj))obj.destroy()});this.posters=[];
    this.placed=[];this.kinds=[];this.groundY=[];
    this.cameraStates=[];this.lightStates=[];this.lightRefs=[];this.noteStates=[];
    this.selectAudio.play(1);this.refresh();console.log("Scout cleared");
  }
  private chooseShoot(type:ShootType):void {
    this.shootType=type;this.lastAction=getTime();
    this.palette.setShootType(type);this.placeAudio.play(1);
    console.log("Scout shoot type: "+type);
  }
  /** While pinning: a dimmed poster follows the wall under the cursor, or a hint asks for a wall. */
  private updatePosterGhost(ray:PointerRay,aim:vec3):void {
    if(!this.pinningPoster){this.posterGhost.enabled=false;return}
    this.hitSession?.hitTest(ray.start,ray.start.add(ray.dir.uniformScale(RAY_REACH)),hit=>{
      // Walls only: a near-vertical surface, so its normal is near-horizontal.
      if(hit&&Math.abs(hit.normal.y)<WALL_NORMAL_Y)this.wallHit={position:hit.position,normal:hit.normal,time:getTime()};
    });
    const fresh=this.wallHit&&getTime()-this.wallHit.time<PREVIEW_HIT_FRESH;
    this.posterGhost.enabled=!!fresh;
    if(fresh){this.placePosterOnWall(this.posterGhost,this.wallHit.position,this.wallHit.normal);this.hintUntil=-100;}
    else this.showHint("Point at a wall to pin the poster");
  }
  private pinPoster():void {
    if(!this.wallHit||getTime()-this.wallHit.time>=PREVIEW_HIT_FRESH){this.showHint("Point at a wall to pin the poster");return}
    this.lastAction=getTime();
    const poster=this.makePoster();
    this.placePosterOnWall(poster,this.wallHit.position,this.wallHit.normal);
    this.pinningPoster=false;this.posterGhost.enabled=false;
    this.placeAudio.play(1);
    console.log("Scout pinned a poster");
  }
  /** Flat against the wall, upright, facing out of it, its bottom kept clear of the floor. */
  private placePosterOnWall(poster:SceneObject,position:vec3,normal:vec3):void {
    const out=new vec3(normal.x,0,normal.z).normalize();
    const minY=(this.floorY===null?position.y:this.floorY)+POSTER_HEIGHT/2+10;
    const t=poster.getTransform();
    t.setWorldPosition(new vec3(position.x,Math.max(position.y,minY),position.z).add(out.uniformScale(1.5)));
    t.setWorldRotation(quat.lookAt(out,vec3.up()));
  }
  private makePoster():SceneObject {
    const poster=buildPoster(this.markerMaterial,false);
    const col=poster.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const shape=Shape.createBoxShape();shape.size=new vec3(POSTER_WIDTH,POSTER_HEIGHT,2);col.shape=shape;
    poster.createComponent(Interactable.getTypeName());
    this.palette.addDeleteBadge(poster,new vec3(POSTER_WIDTH/2-2,POSTER_HEIGHT/2+4,1.5),()=>{
      this.lastAction=getTime();
      const i=this.posters.indexOf(poster);
      if(i>=0)this.posters.splice(i,1);
      if(!isNull(poster))poster.destroy();
      this.selectAudio.play(1);
    });
    this.posters.push(poster);
    return poster;
  }
  /** Where the user stands on the floor and which way they face (yaw only — head pitch must not tilt a
   * layout). Saving and loading both go through this, so a layout reappears around wherever the user
   * is standing when they load it. */
  private userFrame():UserFrame {
    const cam=this.camera.getTransform(),p=cam.getWorldPosition(),f=cam.forward;
    return {origin:new vec3(p.x,this.floorY===null?p.y:this.floorY,p.z),yaw:Math.atan2(f.x,f.z)};
  }
  private toFrame(frame:UserFrame,p:vec3):{x:number;z:number} {
    const dx=p.x-frame.origin.x,dz=p.z-frame.origin.z,c=Math.cos(-frame.yaw),s=Math.sin(-frame.yaw);
    return {x:dx*c+dz*s,z:-dx*s+dz*c};
  }
  private fromFrame(frame:UserFrame,x:number,z:number,y:number):vec3 {
    const c=Math.cos(frame.yaw),s=Math.sin(frame.yaw);
    return new vec3(frame.origin.x+x*c+z*s,y,frame.origin.z-x*s+z*c);
  }
  private yawOf(so:SceneObject):number {const f=so.getTransform().forward;return Math.atan2(f.x,f.z);}
  /** Menu → Saved Layouts → Save: stored as "Untitled…" straight away, then the keyboard opens to name it
   * (if it never opens — e.g. in Lens Studio's preview — the layout simply stays Untitled). */
  private saveLayout():void {
    this.lastAction=getTime();
    if(this.layouts.list().length>=MAX_SAVED_LAYOUTS){this.showHint("Delete a saved layout to make room");this.selectAudio.play(1);return}
    if(!this.placed.length&&!this.posters.length){this.showHint("Place something before saving");this.selectAudio.play(1);return}
    const frame=this.userFrame(),floor=frame.origin.y;
    // Millimetres for positions; yaw (radians) needs finer steps — 0.1 rad would be ~6°.
    const round=(n:number)=>Math.round(n*10)/10,roundYaw=(n:number)=>Math.round(n*1000)/1000;
    const data:SavedLayout={v:2,s:this.shootType||undefined,
      m:this.placed.map((root,i)=>{
        const p=this.toFrame(frame,root.getTransform().getWorldPosition());
        return {k:this.kinds[i],l:root.name,x:round(p.x),z:round(p.z),h:round(this.bottomOf(root)-floor),
          r:roundYaw(this.yawOf(root)-frame.yaw),c:this.cameraStates[i]||undefined,li:this.lightStates[i]||undefined,n:this.noteStates[i]||undefined};
      }),
      p:this.posters.map(poster=>{
        const pos=poster.getTransform().getWorldPosition(),p=this.toFrame(frame,pos);
        return {x:round(p.x),z:round(p.z),h:round(pos.y-floor),r:roundYaw(this.yawOf(poster)-frame.yaw)};
      }),
    };
    const info=this.layouts.save(this.layouts.nextUntitledName(),JSON.stringify(data),data.m.length+data.p.length);
    if(!info){this.showHint("Couldn't save — storage is full");return}
    this.placeAudio.play(1);
    this.palette.setLayouts(this.layouts.list());
    console.log("Scout saved layout "+info.name+" ("+info.count+" items)");
    this.renameLayout(info.id);
  }
  /** Replaces what's placed now with a saved layout, arranged around where the user is standing. */
  private loadLayout(id:string):void {
    this.lastAction=getTime();
    let data:SavedLayout;
    try{
      data=JSON.parse(this.layouts.load(id));
      if(data?.v!==2||!Array.isArray(data.m)||!Array.isArray(data.p))throw new Error("unsupported format");
    }catch(e){console.warn("Scout layouts: can't load "+id+" — "+e);this.showHint("That layout couldn't be loaded");return}
    this.clear();
    if(data.s==="photo"||data.s==="video")this.chooseShoot(data.s);
    const frame=this.userFrame(),floor=frame.origin.y;
    for(const m of data.m.slice(0,this.maxMarkers)){
      if(![0,1,2,3,4].includes(m.k))continue;
      const surface=floor+m.h;
      const root=this.makeMarker(m.k,m.l,surface,{cameraState:m.c,lightState:m.li,noteState:m.n} as MarkerRecord);
      root.getTransform().setWorldPosition(this.fromFrame(frame,m.x,m.z,surface));
      root.getTransform().setWorldRotation(quat.angleAxis(frame.yaw+m.r,vec3.up()));
      this.liftOnto(root,surface);
      if(m.k===1)this.tiltKeyLight(root);
    }
    for(const p of data.p){
      const poster=this.makePoster();
      poster.getTransform().setWorldPosition(this.fromFrame(frame,p.x,p.z,floor+p.h));
      poster.getTransform().setWorldRotation(quat.angleAxis(frame.yaw+p.r,vec3.up()));
    }
    this.sequence=Math.max(this.sequence,...data.m.map(m=>Number(m.l.match(/(\d+)$/)?.[1])||0));
    this.refresh();this.placeAudio.play(1);
    console.log("Scout loaded layout "+id+" ("+data.m.length+" markers, "+data.p.length+" posters)");
  }
  /** Names a saved layout by voice: the name updates live as it's heard and is kept once the user pauses.
   * Tapping the mic again stops listening. */
  private voiceRenameLayout(id:string):void {
    this.lastAction=getTime();
    const asr=require("LensStudio:AsrModule") as AsrModule;
    if(this.listening){
      const same=this.listening.id===id;
      this.stopListening();
      if(same)return;
    }
    const session={id,started:getTime(),heard:""};
    this.listening=session;
    const options=AsrModule.AsrTranscriptionOptions.create();
    options.silenceUntilTerminationMs=VOICE_SILENCE_MS;
    options.mode=AsrModule.AsrMode.HighAccuracy;
    options.onTranscriptionUpdateEvent.add(e=>{
      if(this.listening!==session)return;
      const name=this.spokenName(e.text);
      if(name){session.heard=name;this.layouts.rename(id,name);this.palette.setLayouts(this.layouts.list());}
      if(e.isFinal&&name){this.stopListening();this.placeAudio.play(1);}
    });
    options.onTranscriptionErrorEvent.add(code=>{
      if(this.listening!==session)return;
      console.warn("Scout voice naming error "+code);
      this.stopListening();
      this.showHint(code===AsrModule.AsrStatusCode.NoInternet?"Voice naming needs internet":"Couldn't hear that — try again");
    });
    asr.startTranscribing(options);
    this.selectAudio.play(1);
  }
  private stopListening():void {
    if(!this.listening)return;
    this.listening=null;
    (require("LensStudio:AsrModule") as AsrModule).stopTranscribing();
  }
  /** Keeps a "Listening…" prompt (with what's been heard) in view, and gives up after a while. */
  private updateListening():void {
    const l=this.listening;
    if(!l)return;
    if(getTime()-l.started>VOICE_TIMEOUT){this.stopListening();this.showHint("Didn't catch a name — tap the mic to try again");return}
    this.showHint(l.heard?"“"+l.heard+"”":"Listening… say the layout's name");
  }
  /** Tidies a transcript into a layout name: trimmed, no trailing full stop, capitalised, length-capped. */
  private spokenName(text:string):string {
    const t=text.trim().replace(/[.。!?]+$/,"").slice(0,VOICE_NAME_MAX);
    return t?t.charAt(0).toUpperCase()+t.slice(1):"";
  }
  /** Opens the Specs keyboard to name a saved layout; the name updates as you type. */
  private renameLayout(id:string):void {
    this.lastAction=getTime();
    const info=this.layouts.get(id);
    if(!info)return;
    try{
      require("LensStudio:TextInputModule");
      const options=new TextInputSystem.KeyboardOptions();
      options.enablePreview=true;
      options.keyboardType=TextInputSystem.KeyboardType.Text;
      options.returnKeyType=TextInputSystem.ReturnKeyType.Done;
      options.initialText=info.name;
      options.onTextChanged=(text:string)=>{this.layouts.rename(id,text.trim()||"Untitled");this.palette.setLayouts(this.layouts.list());};
      options.onReturnKeyPressed=()=>global.textInputSystem.dismissKeyboard();
      options.onError=(_code:number,description:string)=>console.warn("Scout keyboard: "+description);
      global.textInputSystem.requestKeyboard(options);
    }catch(e){
      console.warn("Scout keyboard unavailable: "+e);
    }
  }
  private snapshot():string {
    const data:ScoutLayout={version:1,frame:'manual',markers:this.placed.map((obj,i)=>{
      const t=obj.getTransform(),p=t.getLocalPosition(),q=t.getLocalRotation();
      return {kind:this.kinds[i],label:obj.name,position:[p.x,p.y,p.z],rotation:[q.w,q.x,q.y,q.z],
        cameraState:this.cameraStates[i]?{...this.cameraStates[i]}:undefined,
        lightState:this.lightStates[i]?{...this.lightStates[i]}:undefined,
        noteState:this.noteStates[i]?{...this.noteStates[i]}:undefined};
    })};return JSON.stringify(data);
  }
  private restore(raw:string):void {
    const data=parseLayout(raw); // Validate every marker before removing current work.
    this.clear();
    this.markers.getTransform().setWorldPosition(this.camera.getTransform().getWorldPosition());
    this.markers.getTransform().setWorldRotation(this.camera.getTransform().getWorldRotation());
    for(const m of data.markers){const obj=this.makeMarker(m.kind,m.label,0,m),t=obj.getTransform();
      t.setLocalPosition(new vec3(m.position[0],m.position[1],m.position[2]));
      t.setLocalRotation(new quat(m.rotation[0],m.rotation[1],m.rotation[2],m.rotation[3]));
      if(m.kind===1)this.tiltKeyLight(obj);
      this.groundY[this.groundY.length-1]=this.bottomOf(obj);
    }
    this.sequence=Math.max(this.sequence,...data.markers.map(m=>Number(m.label.match(/(\d+)$/)?.[1])||0));this.refresh();
  }
  private refresh():void {
    // Only clear the gizmo when its target was actually removed; never auto-show it for a fresh placement.
    if(this.editing&&this.placed.indexOf(this.editing)<0){this.editing=null;this.gizmo?.select(null);}
    this.assignLightShadows();
    this.palette.setState(this.selected,this.placed.length);
  }
  /** Lens Studio renders shadows from only one directional light per scene, and each shadow map is an
   * extra full render pass — real GPU/battery cost on Specs. So only the oldest remaining Light casts
   * shadows; the others still light the scene. Re-run on every placement change so deleting the caster
   * hands shadows to the next Light. */
  private assignLightShadows():void {
    let hasCaster=false;
    this.lightRefs.forEach(ref=>{
      if(!ref)return;
      ref.light.shadowType=hasCaster?ShadowType.None:ShadowType.ShadowMap;
      hasCaster=true;
    });
  }
}
