import {HandVisual,HandMeshType} from "InteractionKit.lspkg/Components/Interaction/HandVisual/HandVisual";
import {ScoutTransformGizmo} from "./ScoutTransformGizmo";
import {ScoutSharedSession} from "./ScoutSharedSession";
import {parseLayout,ScoutLayout,MarkerRecord} from "./ScoutLayout";
import {ScoutPaletteUI} from "./ScoutPaletteUI";
import {PosableDummy,DummyPose,DUMMY_PART_COUNT,SEATED_POSE} from "./ScoutPosableDummy";
import {buildMarkerMesh, buildNoteGhost, NOTE_PIN_HEIGHT, NOTE_TIP_HEIGHT} from "./ScoutMarkerMesh";
import type {ScoutNoteWizard, NoteReference} from "./ScoutNoteWizard";
import {Interactable,TargetingPriority} from "InteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import {InteractableManipulation,RotationAxis} from "InteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";
import {InteractionManager} from "InteractionKit.lspkg/Core/InteractionManager/InteractionManager";
import {Interactor,InteractorInputType,TargetingMode} from "InteractionKit.lspkg/Core/Interactor/Interactor";

import {HandInputData} from "InteractionKit.lspkg/Providers/HandInputData/HandInputData";
import {IMAGE_MATERIAL_ASSET} from "UIKit.lspkg/Scripts/Utility/Assets";
import {CameraAssetState, LightAssetState, NoteAssetState, defaultCameraState, defaultLightState, defaultNoteState, KELVIN_STOPS, INTENSITY_STOPS, kelvinToRGB} from "./ScoutAssetState";
import {HOVER_GLOW} from "./ScoutHover";
import {ScoutFloorSetup} from "./ScoutFloorSetup";
import {ScoutLayoutStore,MAX_SAVED_LAYOUTS} from "./ScoutLayoutStore";
import {buildPoster,POSTER_WIDTH,POSTER_HEIGHT} from "./ScoutPoster";
import {ScoutWorkbench,ShootType,buildBenchGhost,BENCH_SIZE} from "./ScoutWorkbench";
import {ScoutAngleCapture,AngleCameraRecord} from "./ScoutAngleCapture";
import {ScoutGrabMove,fingerCurl,PINCH_IS_FIST,NearGrab} from "./ScoutGrabMove";
import {ScoutRotaryDial} from "./ScoutRotaryDial";
import {BaseHand} from "InteractionKit.lspkg/Providers/HandInputData/BaseHand";
import {ScoutTips,ScoutToolkitCard,TourStep,IntroCard,Tip,introSeen,markIntroSeen,pillButton} from "./ScoutOnboarding";
import {ScoutLookUpNudge,NudgeTarget} from "./ScoutLookUpNudge";
import {ScoutRoomOutline} from "./ScoutRoomOutline";
import {ScoutAnchors,AnchorFrame} from "./ScoutAnchors";
import {BodyKind,CameraRig,HeightSlider,LightRig,MountKind,RigPrefabs,TiltRig,TiltWheel,rigHeight,RigSounds} from "./ScoutCameraRig";

type PointerRay={start:vec3;dir:vec3};
/** Saved-layout format: x/z are in the user's yaw-only frame at save time (their spot on the floor and
 * facing direction), h is height above the floor, r is yaw relative to the user's. */
type SavedMarker={k:number;l:string;x:number;z:number;h:number;r:number;c?:CameraAssetState;li?:LightAssetState;n?:NoteAssetState;ps?:DummyPose};
type SavedPoster={x:number;z:number;h:number;r:number};
// o: the room outline's corners as flat x,z pairs in the same frame — when present, the frame is the
// outline's rather than the user's, and loading lets the user line the outline up with the real room.
// a: the Spatial Anchor saved at the layout's frame (added once the anchor has been saved).
type SavedLayout={v:2;m:SavedMarker[];p:SavedPoster[];s?:ShootType;o?:number[];a?:string};
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
// With no surface found under the aim, a pinch still lands where the ray meets the floor up to this far (cm).
const FLOOR_FALLBACK_REACH=600;
// First-run intro, paged on the bench console before the Photo/Video buttons: what ShotScout is, when to
// use it, why.
const INTRO_CARDS:IntroCard[]=[
  {title:"Plan your shoot on location.",body:"Place cameras, lights, actors and shot notes right where they'll go."},
  {title:"Use it on a scout or the day before.",body:"Block every setup in the real space, so shoot day starts with shooting."},
  {title:"Save it for later.",body:"Come back with your crew and your plan is waiting where you left it."},
];
// One-time tips, each shown the first time its action becomes useful (see the tips.show calls).
// The toolbar tour shown after the shoot type is picked on the bench: one stop per toolbar button, top
// to bottom.
const KIT_TITLE="Your toolkit";
const TOUR_STEPS:TourStep[]=[
  {title:"Camera",body:"Place a camera where it'll stand, then grab a reference shot from its angle."},
  {title:"Light",body:"Add a key light and dial in its brightness and colour."},
  {title:"Shot notes",body:"Pin a note to a spot: shot number, framing, movement and your own notes."},
  {title:"Subject",body:"Place a stand-in actor and pose it. Tap again to switch standing and seated."},
  {title:"Hand",body:"Nothing to place: point, pinch and grab what's already here."},
  {title:"Reset the floor",body:"Floor looks off, or moved rooms? Reset it at any time from here."},
];
// Lets the bench clear away first (s).
const KIT_DELAY=0.6;
const TIPS:{[id:string]:Tip}={
  place:{title:"Point and pinch",body:"to place it on the floor or any surface.",icon:requireAsset("../Icons/arrow_forward.png") as Texture},
  grab:{title:"Grab it like a real object.",body:"Close your hand to pick it up, open to put it down.",icon:requireAsset("../Icons/pan_tool.png") as Texture},
  edit:{title:"Click edit",body:"to adjust tilt, rotation, and position.",icon:requireAsset("../Icons/edit.png") as Texture},
  pose:{title:"Click edit",body:"to adjust pose.",icon:requireAsset("../Icons/edit.png") as Texture},
  dials:{title:"Twist the dials",body:"like you would on set.",icon:requireAsset("../Icons/rotate_right.png") as Texture},
  note:{title:"Leave yourself a note",body:"for this angle.",icon:requireAsset("../Icons/sticky_note_2.png") as Texture},
  capture:{title:"See what it sees.",body:"Walk to the camera to grab a reference shot.",icon:requireAsset("../Icons/photo_camera.png") as Texture},
  save:{title:"Happy with it? Save it",body:"so it's here next time.",icon:requireAsset("../Icons/bookmarks.png") as Texture},
};
// A fist grabs the prop hovered up to this long ago (s) — the targeting ray drifts as the hand closes.
// Also how recent a queued placement must be for a starting grab to cancel it as the fist's own pinch.
const GRAB_TARGET_GRACE=0.35;
// How long a load waits for Specs to recognise the room from a layout's Spatial Anchor (s).
const ANCHOR_WAIT_SECONDS=6;
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
// A marker's floating UI (built by ScoutPaletteUI / ScoutNoteWizard under these names) turns to face the
// user once they've walked FACING_DEADZONE (radians) round the prop, easing over at FACING_EASE per second.
const FACING_UI=["Marker label","Asset controls","Angle screen","Note wizard"];
const FACING_DEADZONE=25*Math.PI/180,FACING_EASE=5;
function wrapAngle(a:number):number {
  while(a>Math.PI)a-=2*Math.PI;
  while(a<-Math.PI)a+=2*Math.PI;
  return a;
}
// Hovered props grow by less than buttons do: on a person-sized model even 5% is clearly visible.
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
// Camera height slider, in the prop's user-facing frame: out toward the user, off to the side, and up
// from the prop's mid-height origin so it sits around the camera body.
const SLIDER_OUT=14,SLIDER_SIDE=30,SLIDER_Y=28;
// The Tripod/Handheld pair mirrors the slider onto the prop's other side, this much further out (clear of the tilt wheel).
const MOUNT_EXTRA=14;
// Lights' sliders sit beside the pole at about the camera's slider height (~1 m), below the softbox.
const LIGHT_SLIDER_Y=18;
// When a moved asset settles, the downward ray starts this far above its feet (cm).
// How close (cm) a closed hand must be to a prop (or a rig's head) to take hold of it without pointing.
const NEAR_REACH=6;
// The bench ghost's turn ring on the floor: radius and band width (cm), and how many hit boxes make it up.
const GHOST_RING_RADIUS=62,GHOST_RING_WIDTH=8,GHOST_RING_HITS=32;
// The ghost's Place button floats this far (cm) above the floor, over the bench's top shelf.
// The Place button floats in front of the ghost at about chest height, where it's in view.
const BENCH_PLACE_UI_Y=105,BENCH_PLACE_UI_FRONT=BENCH_SIZE.z/2+18;
// The bench ghost stays this far (cm) from the user: never on top of them, never across the room.
const BENCH_GHOST_MIN=150,BENCH_GHOST_MAX=450;
// Within this far (cm, across the floor) of a camera being walked to for a capture, the UI clears away.
const CAPTURE_CLEAR_RADIUS=150;
// The edit badge: a pencil, or a check while its prop is being edited.
const EDIT_BADGE_ICON=requireAsset("../Icons/edit.png") as Texture;
const DONE_ICON=requireAsset("../Icons/check.png") as Texture;
// How far (cm) a placement message floats above the top of the prop preview it's about.
const HINT_ABOVE_PREVIEW=10;
// A placement hit counts as floor within this far (cm) of the confirmed floor height.
const FLOOR_MATCH=12;
const SETTLE_RAY_ABOVE=20;
// A surface at least this far above the floor (cm) is a seat for a seated subject: it sits on it by the hips.
const SEAT_SURFACE_MIN=25;
// Occlusion: the occluder renders first; its on/off setting is remembered per device.
const OCCLUDER_RENDER_ORDER=-100,OCCLUSION_KEY="scout.occlusion";
// The scanned floor is bumpy (rugs, scan noise), so at its true height it pokes through anything resting on
// the floor (tripod feet, the footprint outline). Sinking the occluder this far (cm) keeps the floor from
// hiding what sits on it, while furniture still hides what's behind it.
const OCCLUDER_SINK=4;
// Key light rig: local offset from the model's pivot to the softbox opening, in the model's own raw
// mesh units (meters) — a child's local position is carried through the SAME transform that maps the
// mesh's own vertices to world space, so using the mesh's own coordinates directly (not re-scaled)
// lands exactly where the panel is. Measured directly off Light.glb's mesh (the panel is the y>0.17
// band of the raw vertex data).
const KEY_LIGHT_OFFSET=new vec3(0.0095,0.235,0.08);
// "100%" baseline for the Light asset's Intensity dial — the light's original always-on brightness.
const KEY_LIGHT_INTENSITY=3;
// The key light's cone (degrees: full strength inside the inner, fading to nothing at the outer, like a
// softbox) and how far (cm) its quadratic falloff reaches.
const KEY_LIGHT_CONE_INNER=35,KEY_LIGHT_CONE_OUTER=70,KEY_LIGHT_RANGE=700;
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
// The open menu (~70 cm tall) sits a little further out so it fits the view with some margin.
const PALETTE_OPEN_DISTANCE=125;
const PALETTE_HEIGHT_OFFSET=-14;
const PALETTE_FOLLOW_EASE=4;
const PALETTE_COLLAPSED_SIDE_OFFSET=20; // shifts the collapsed toolbar toward the right edge of view instead of dead center
// Hysteresis band (cm/s of head movement) so the palette doesn't flicker collapsed/expanded near one threshold.
const FAST_MOVE_SPEED=130;
const SLOW_MOVE_SPEED=60;

const SELECT=requireAsset("../GeneratedSFX/ScoutSelect.wav") as AudioTrackAsset;
const PLACE=requireAsset("../GeneratedSFX/ScoutPlace.wav") as AudioTrackAsset;
// Dial clicks, from a recording of a film camera's dial: single detents (two takes, alternated). Dials and
// tilt wheels both use them; turned fast they just click a little quicker (DIAL_CLICK_GAP).
const DIAL_CLICKS=[requireAsset("../GeneratedSFX/ScoutDialClick.wav") as AudioTrackAsset,requireAsset("../GeneratedSFX/ScoutDialClick2.wav") as AudioTrackAsset];
// Tripod/stand height: a column sliding up into its clamp, or down. One plays per movement, after at least
// RIG_SOUND_MIN cm one way; a movement ends after RIG_SOUND_IDLE s still.
const RIG_TALLER=requireAsset("../GeneratedSFX/ScoutRigTaller.wav") as AudioTrackAsset;
const RIG_SHORTER=requireAsset("../GeneratedSFX/ScoutRigShorter.wav") as AudioTrackAsset;
const RIG_SOUND_MIN=1.5,RIG_SOUND_IDLE=0.4;
// The camera's and light's tilt wheels turn smoothly; they click like a dial every TILT_DETENT degrees.
const TILT_DETENT=5;
// Clicks never come closer together than this (s), however fast a dial or wheel turns.
const DIAL_CLICK_GAP=0.085;
// A camera shutter, when the angle monitor takes its shot.
const SHUTTER=requireAsset("../GeneratedSFX/ScoutShutter.wav") as AudioTrackAsset;

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
  @input @allowUndefined @hint("Spatial Anchors: saved layouts snap back into the same room") anchorModule:AnchorModule;
  @input @allowUndefined cameraPrefab:ObjectPrefab;
  @input @allowUndefined lightPrefab:ObjectPrefab;
  @input @allowUndefined standingPrefab:ObjectPrefab;
  @input @allowUndefined seatedPrefab:ObjectPrefab;
  @input @allowUndefined @hint("Posable dummy pieces (GeneratedMeshes/Dummy): pelvis, torso, head, upper arm L, forearm L, upper arm R, forearm R, thigh L, shin L, thigh R, shin R, hand L, hand R") dummyParts:ObjectPrefab[];
  @input @allowUndefined @hint("The standing dummy's own material, for the posable pieces") dummyMaterial:Material;
  // Onboarding workbench gear (generated models); any left empty is simply skipped.
  @input @allowUndefined workbenchPrefab:ObjectPrefab;
  @input @hint("Camera tripod parts: legs, column, head") classicRig:ObjectPrefab[];
  @input @hint("Camera bodies: cinema, photo") cameraBodies:ObjectPrefab[];
  @input @allowUndefined @hint("Handheld camera operators: cinema, photo") handheldCameras:ObjectPrefab[];
  @input @hint("Light stand parts: base, pole, upper pole, softbox head") lightRig:ObjectPrefab[];
  @input @allowUndefined @hint("World Mesh: the real room's reconstructed surfaces, for occlusion") worldMesh:RenderMesh;
  @input @allowUndefined @hint("Occluder material: writes depth only, so real objects hide what's behind them") occluderMaterial:Material;
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
  private dialClickAudio:AudioComponent[]=[];
  private dialClickNext=0;
  private lastDialClick=0;
  private rigTallerAudio:AudioComponent;
  private rigShorterAudio:AudioComponent;
  private liftMove={acc:0,dir:0,last:0};
  private tiltAcc=0;
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
  private pending:{kind:number;ray:PointerRay;aim:vec3;started:number;wallAt:number}=null;
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
  // Each Camera asset's "capture this angle" monitor and the walk-over guide behind it.
  private angleCapture:ScoutAngleCapture;
  // Fist-to-move for placed props, and the last prop the cursor was on (its grab target).
  private grabMove:ScoutGrabMove;
  private hoverSeen:{root:SceneObject;time:number}=null;
  // Each marker's floating UI pivot, turned to face the user (angle/target in radians about +Y).
  private facingUI:{root:SceneObject;pivot:SceneObject;facing:vec3;angle:number;target:number}[]=[];
  private lookUpNudge:ScoutLookUpNudge=null;
  /** Camera props' height sliders: shown beside the prop only while it's in edit mode. */
  /** Standing dummies whose limbs can be posed (in edit mode), by marker root. */
  private dummies=new Map<SceneObject,PosableDummy>();
  /** Each dummy's height when it was built: its labels were laid out for that (see fitDummy). */
  private dummyBuiltHeight=new Map<SceneObject,number>();
  /** Where each prop was (and the floor height) when keepAboveFloor last measured it. */
  private floorSeen=new Map<SceneObject,{pos:vec3;floor:number}>();
  private heightSliders:{root:SceneObject;pivot:SceneObject;slider:HeightSlider;facingPivot:SceneObject;rig:TiltRig;wheel:TiltWheel;afterAim?:()=>void;handheld:()=>boolean;
    lift:()=>number;setLift:(cm:number)=>void;setTilt:(deg:number)=>void}[]=[];
  // Onboarding (the intro itself lives on the bench): one-time tips as each action becomes useful.
  private tips:ScoutTips;
  private toolkitCard:ScoutToolkitCard;
  // Room outline that saved layouts are stored against; confirmed once drawn (or lined up) this session.
  private roomOutline:ScoutRoomOutline;
  private outlineConfirmed=false;
  private anchors:ScoutAnchors;
  // While a loaded layout is being lined up: each item's position in the outline frame, so it moves live.
  private aligning:{so:SceneObject;x:number;z:number;r:number}[]=null;

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
    this.dialClickAudio=DIAL_CLICKS.map(t=>this.audio(t));
    ScoutRotaryDial.onStep=()=>this.dialClick();
    this.rigTallerAudio=this.audio(RIG_TALLER);this.rigShorterAudio=this.audio(RIG_SHORTER);
    RigSounds.onLift=delta=>this.liftSound(delta);
    RigSounds.onTilt=delta=>{
      if(Math.sign(delta)!==Math.sign(this.tiltAcc))this.tiltAcc=0;
      this.tiltAcc+=delta;
      const steps=Math.floor(Math.abs(this.tiltAcc)/TILT_DETENT);
      if(steps>0){this.tiltAcc-=Math.sign(this.tiltAcc)*steps*TILT_DETENT;this.dialClick();}
    };
    this.palette.onSelect.add(kind=>{this.selectTool(kind);this.selectAudio.play(1);});
    this.gizmo=new ScoutTransformGizmo(this.markerMaterial,this.camera,()=>{this.lastAction=getTime();});
    // Arrow moves drop props onto the surface under them; actors may have been raised with the vertical
    // arrow on purpose, so they keep their height.
    this.gizmo.onMoved=root=>{const k=this.kinds[this.placed.indexOf(root)];if(k!==3&&k!==4)this.settleOnSurface(root);};
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
    this.lookUpNudge=new ScoutLookUpNudge(this.camera);
    this.floorSetup=new ScoutFloorSetup(this.markerMaterial,this.camera,y=>this.confirmFloor(y));
    this.palette.onResetFloor.add(()=>this.resetFloor());
    this.setupOcclusion();this.enableHandOcclusion();
    this.palette.onToggleShootType.add(()=>{if(this.shootType)this.chooseShoot(this.shootType==="photo"?"video":"photo");});
    this.palette.onToggleOcclusion.add(()=>{this.lastAction=getTime();this.setOcclusion(!this.occlusionOn);this.selectAudio.play(1);});
    this.workbench=new ScoutWorkbench(this.markerMaterial,this.camera,{
      bench:this.workbenchPrefab,cinemaCamera:this.cinemaCameraPrefab,gimbal:this.gimbalPrefab,lens:this.lensPrefab,
      clapperboard:this.clapperboardPrefab,filmReel:this.filmReelPrefab,photoCamera:this.photoCameraPrefab,
    },type=>this.chooseShoot(type,true));
    this.grabMove=new ScoutGrabMove(this.camera,{
      near:(point,hand)=>this.nearGrab(point,hand),
      target:()=>{
        // The prop under the cursor — or the one there a moment ago, since the targeting ray drifts as
        // the hand closes. Not one being walked to for an angle capture or open in the gizmo.
        const seen=this.hoverSeen&&getTime()-this.hoverSeen.time<GRAB_TARGET_GRACE?this.hoverSeen.root:null;
        const root=this.hovered&&!isNull(this.hovered)?this.hovered:seen;
        if(!root||isNull(root)||this.placed.indexOf(root)<0||this.gizmo.isEditing(root)||this.angleCapture.guiding)return null;
        return root;
      },
      onStart:root=>{
        this.lastAction=getTime();
        // The fist's pinch may already have queued a placement a moment ago; it was a grab, not a place.
        if(this.pending&&getTime()-this.pending.started<GRAB_TARGET_GRACE)this.pending=null;
        this.setCanDrag(root,false);
        this.selectAudio.play(1);
        this.tips.done("grab");
      },
      onEnd:(root,moved)=>{
        this.lastAction=getTime();
        this.setCanDrag(root,this.selected===HAND_KIND);
        if(moved){
          this.settleOnSurface(root);this.placeAudio.play(1);
          const k=this.kinds[this.placed.indexOf(root)];
          this.tips.show(k===3||k===4?"pose":"edit");
        }
      },
    });
    this.angleCapture=new ScoutAngleCapture(this.markerMaterial,this.camera,
      ()=>this.floorY===null?this.camera.getTransform().getWorldPosition().y-150:this.floorY,
      (seconds,fn)=>{const ev=this.createEvent("DelayedCallbackEvent");ev.bind(fn);ev.reset(seconds);});
    const shutter=this.audio(SHUTTER);
    this.angleCapture.onCaptured=()=>shutter.play(1);
    this.layouts=new ScoutLayoutStore();
    this.palette.setLayouts(this.layouts.list());
    this.palette.onSaveLayout.add(()=>this.saveLayout());
    this.palette.onLoadLayout.add(id=>this.loadLayout(id));
    this.palette.onRenameLayout.add(id=>this.renameLayout(id));
    this.palette.onVoiceRenameLayout.add(id=>this.voiceRenameLayout(id));
    this.palette.onDeleteLayout.add(id=>{this.lastAction=getTime();this.forgetAnchor(id);this.layouts.remove(id);this.palette.setLayouts(this.layouts.list());this.selectAudio.play(1);});
    this.posterGhost=buildPoster(this.markerMaterial,true);this.posterGhost.enabled=false;
    this.palette.onPinPoster.add(()=>{this.lastAction=getTime();this.pending=null;this.pinningPoster=true;this.wallHit=null;});
    this.tips=new ScoutTips(this.camera,TIPS,(s,fn)=>this.schedule(s,fn));
    this.toolkitCard=new ScoutToolkitCard(this.camera,(s,fn)=>this.schedule(s,fn));
    this.anchors=new ScoutAnchors(this.anchorModule||null);
    this.roomOutline=new ScoutRoomOutline(this.markerMaterial,this.camera,
      ()=>this.floorY===null?this.camera.getTransform().getWorldPosition().y-150:this.floorY,
      (s,fn)=>this.schedule(s,fn),()=>this.followOutline());
    this.rebuildPreview();this.refresh();this.ready=true;
    console.log("Scout ready: point at the floor to set it, then choose equipment, notes, or actors.");
  }
  private schedule(seconds:number,fn:()=>void):void {
    const ev=this.createEvent("DelayedCallbackEvent");ev.bind(fn);ev.reset(seconds);
  }
  /** A camera or light stand changed height: the taller or shorter sound, once per movement (and again if
   * the movement turns round). */
  private liftSound(delta:number):void {
    const m=this.liftMove,now=getTime();
    if(now-m.last>RIG_SOUND_IDLE){m.acc=0;m.dir=0;}
    m.last=now;
    if(Math.sign(delta)!==Math.sign(m.acc))m.acc=0;
    m.acc+=delta;
    const dir=Math.sign(m.acc);
    if(Math.abs(m.acc)<RIG_SOUND_MIN||dir===m.dir)return;
    m.dir=dir;
    const [play,stop]=dir>0?[this.rigTallerAudio,this.rigShorterAudio]:[this.rigShorterAudio,this.rigTallerAudio];
    if(stop.isPlaying())stop.stop(false);
    play.play(1);
  }
  /** One detent on a dial or tilt wheel: a single click, at most one per DIAL_CLICK_GAP, so a fast turn
   * just clicks a little quicker. */
  private dialClick():void {
    const now=getTime();
    if(now-this.lastDialClick<DIAL_CLICK_GAP)return;
    this.lastDialClick=now;
    this.dialClickAudio[this.dialClickNext].play(1);
    this.dialClickNext=(this.dialClickNext+1)%this.dialClickAudio.length;
  }
  private audio(track:AudioTrackAsset):AudioComponent {
    const audio=this.sceneObject.createComponent("Component.AudioComponent") as AudioComponent;
    audio.audioTrack=track;audio.volume=this.sfxVolume;audio.playbackMode=Audio.PlaybackMode.LowLatency;return audio;
  }
  private rebuildPreview():void {
    if(this.previewShape&&!isNull(this.previewShape))this.previewShape.destroy();
    if(this.selected===HAND_KIND){this.previewShape=null;return}
    const prefab=this.prefabFor(this.selected);
    const rigs=this.selected===0?this.rigPrefabs():null;
    if(rigs){
      // The camera ghost shows the body this shoot will place.
      this.previewShape=global.scene.createSceneObject("Camera rig preview");
      this.previewShape.setParent(this.placementPreview);
      const ghostBody=this.bodyFor({} as CameraAssetState);
      new CameraRig(this.previewShape,rigs,ghostBody,0);
      // The same small cursor size the other tools' ghosts have.
      this.previewShape.getTransform().setLocalScale(vec3.one().uniformScale(30/rigHeight(ghostBody)));
      const visual=findMeshVisual(this.previewShape);
      if(visual)this.previewShape.getTransform().setLocalPosition(new vec3(0,this.placementPreview.getTransform().getWorldPosition().y-visual.worldAabbMin().y,0));
    }else if(prefab){
      this.previewShape=prefab.instantiate(this.placementPreview);
      // A small cursor model indicates the selected tool without hiding the venue. Stand it on the ground
      // grid by its lowest point (not its pivot), the same way placed markers stand on the floor.
      const visual=findMeshVisual(this.previewShape);
      if(visual)this.previewShape.getTransform().setLocalPosition(new vec3(0,this.placementPreview.getTransform().getWorldPosition().y-visual.worldAabbMin().y,0));
    }else if(this.selected===2){
      // A miniature of the note's card on its pointer, the same cursor size as the other tools' ghosts.
      this.previewShape=buildNoteGhost(this.placementPreview,this.markerMaterial);
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
    this.updateHeightSliders();
    this.updateDummies();
    this.updateNotes();
    this.updateEditBadges();
    this.prioritizeMenu();
    this.workbench.update();
    const all=InteractionManager.getInstance().getInteractorsByType(InteractorInputType.All);
    all.forEach(interactor=>{
      if(this.interactors.indexOf(interactor)>=0)return;
      this.interactors.push(interactor);
      interactor.onTriggerStart.add(target=>{
        if(interactor.inputType===InteractorInputType.Mouse && !target && (this.selected!==HAND_KIND||this.pinningPoster) && getTime()-this.lastAction>0.25) this.placeAt(interactor);
      });
    });
    // What the hand is pointing at, for the far fist grab and the floor halo — worked out here from the
    // ray rather than from the cursor, since props don't catch the cursor.
    this.hovered=this.lastRayFromHand?this.pickProp(this.lastRay):null;
    // Grab-to-move runs first, so a fist that closes this frame claims it before a pinch can place.
    if(this.hovered&&!isNull(this.hovered)){this.hoverSeen={root:this.hovered,time:getTime()};this.tips.show("grab");}
    this.grabMove.update();
    // Hand pinch remains available in empty space even when SIK has no direct target.
    (["left","right"] as const).forEach((side,index)=>{
      const hand=HandInputData.getInstance().getHand(side);
      const down=hand.isPinching();
      const interactor=all.find(i=>i.inputType===(index===0?InteractorInputType.LeftHand:InteractorInputType.RightHand));
      // A closing fist often reads as a pinch too; with the other fingers curled it's a grab, not a place.
      const fistLike=(fingerCurl(hand)??2)<PINCH_IS_FIST;
      if(down&&!this.pinched[index]&&!fistLike&&!this.grabMove.holding&&!interactor?.currentInteractable&&(this.selected!==HAND_KIND||this.pinningPoster)&&getTime()-this.lastAction>0.25){
        this.placeAt(interactor);
      }
      this.pinched[index]=down;
    });
    const active=all.find(i=>i.isActive()&&i.isTargeting());
    // A lingering target on the palette itself (e.g. right after tapping a toolbar icon) shouldn't
    // suppress the placement guides — only a real scene object (a placed marker, a gizmo handle) should.
    // Pointing at a prop blocks placing too (props don't catch the cursor any more, so check the ray).
    const blocking=(active?.currentInteractable&&!this.isPaletteTarget(active.currentInteractable))||!!this.hovered;
    // Nothing to place (and no preview following the aim) while the toolkit card is up: it's the first
    // thing to read after the bench, and a prop ghost chasing the cursor would pull attention from it.
    const canPlace=!blocking&&this.placed.length<this.maxMarkers&&this.selected!==HAND_KIND&&!this.toolkitCard.active;
    const ray=this.rayFor(active);
    const aim=this.positionFor(active);
    this.lastRay=ray;this.lastAim=aim;this.lastRayFromHand=!!active;
    this.surfaceHitTest(ray,aim,point=>{
      if(!point)return;
      this.previewGroundY=point.y;this.previewPoint=point;this.previewHitTime=getTime();
      this.noteSurface(point.y);
    });
    // First run: nothing can be placed (and the palette stays hidden) until the floor is set and a shoot
    // type is picked at the workbench. The bench only stands on a real floor height: after a skipped setup
    // it waits (with the "look at the floor" hint) until surface tracking first sees the floor.
    const benchWaiting=this.floorSetup.done&&this.shootType===null&&!this.workbenchShown;
    // The bench is big and the room may be tight: the user first moves a see-through ghost of it into a
    // clear spot and pinches to put it there (placeBench).
    if(benchWaiting&&this.floorY!==null)this.updateBenchGhost();
    else if(this.benchGhost&&!isNull(this.benchGhost))this.benchGhost.enabled=false;
    const settingUp=!this.floorSetup.done||(benchWaiting&&!this.workbenchShown)||this.workbench.active;
    // The toolkit card goes first; the "point and pinch" tip waits until it's closed.
    this.tips.held=this.roomOutline.active||this.angleCapture.guiding||this.toolkitCard.active;
    this.tips.update();
    this.toolkitCard.update();
    // The menu also steps aside while the room outline is drawn or lined up: it would sit in front of the
    // outline panel and its buttons.
    // While the bench waits for a shoot type, only the floating Reset Floor button shows, so a bench
    // standing on a wrongly detected floor can be fixed straight away.
    const benchStep=this.floorSetup.done&&this.workbench.active;
    this.palette.setFloorOnly(benchStep);
    // The menu stays up beside the toolkit card, which points at it.
    const hideMenu=(settingUp&&!benchStep)||this.roomOutline.active||this.captureClear;
    if(this.paletteShown===hideMenu){this.paletteShown=!hideMenu;this.palette.sceneObject.enabled=!hideMenu;}
    const freshHit=getTime()-this.previewHitTime<PREVIEW_HIT_FRESH?this.previewPoint:null;
    const hand=active&&active.inputType!==InteractorInputType.Mouse?active.startPoint:null;
    this.floorSetup.update(freshHit&&this.isFloorHeight(freshHit.y)?freshHit:null,aim,hand);
    this.angleCapture.update();
    this.updateCaptureClear();
    this.roomOutline.update();
    if(settingUp||this.pinningPoster||this.angleCapture.guiding||this.roomOutline.active){
      this.placementPreview.enabled=false;
      this.updateGroundIndicator(false,aim);
      this.updatePosterGhost(ray,aim);
      this.updatePlacementFeedback(benchWaiting&&!this.workbenchShown&&this.floorY===null,ray,aim);
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
    this.updateFacingUI();
    this.updateLookUpNudge();
  }
  /** Cameras, lights and subjects are tall: when the user looks at one up close with its controls above
   * the view, a small chevron nudges them to look up (ScoutLookUpNudge). */
  private updateLookUpNudge():void {
    const targets:NudgeTarget[]=[];
    for(const e of this.facingUI){
      if(isNull(e.root)||isNull(e.pivot))continue;
      const kind=this.kinds[this.placed.indexOf(e.root)];
      if(kind!==0&&kind!==1&&kind!==3&&kind!==4)continue;
      // The name tag rides with the controls row, so it marks where the user needs to look.
      const tag=findChild(e.pivot,"Marker label");
      const ui=tag?null:worldBounds(e.pivot);
      const controls=tag?tag.getTransform().getWorldPosition():ui?ui.min.add(ui.max).uniformScale(0.5):null;
      if(!controls)continue;
      const p=e.root.getTransform().getWorldPosition(),feet=this.bottomOf(e.root);
      targets.push({body:new vec3(p.x,(feet+controls.y)/2,p.z),controls});
    }
    const allowed=this.shootType!==null&&!this.workbench.active&&!this.angleCapture.guiding&&!this.roomOutline.active&&!this.captureClear;
    this.lookUpNudge.update(targets,allowed);
  }
  /** Moves a fresh marker's floating UI (name tag + badges, dials, angle monitor, note panel) under one
   * pivot that turns about the prop's vertical axis to face the user — see updateFacingUI. Each piece
   * keeps its authored layout; `facing` is the side they were authored to face, in root space. */
  private groupFacingUI(root:SceneObject):void {
    const pivot=global.scene.createSceneObject("Facing UI");pivot.setParent(root);
    let facing:vec3=null;
    for(let i=root.getChildrenCount()-1;i>=0;i--){
      const c=root.getChild(i);
      if(FACING_UI.indexOf(c.name)<0)continue;
      if(!facing){
        const f=c.getTransform().getLocalRotation().multiplyVec3(vec3.forward());
        facing=new vec3(f.x,0,f.z).length>1e-3?new vec3(f.x,0,f.z).normalize():vec3.forward();
      }
      c.setParentPreserveWorldTransform(pivot);
    }
    if(facing)this.facingUI.push({root,pivot,facing,angle:null,target:0});
  }
  /** Swings each marker's UI pivot round to the user's side. It only starts turning once the user is
   * FACING_DEADZONE off, then eases over, so the panels hold still while a dial is being used. */
  private updateFacingUI():void {
    const cam=this.camera.getTransform().getWorldPosition();
    const k=Math.min(1,getDeltaTime()*FACING_EASE);
    this.facingUI=this.facingUI.filter(e=>!isNull(e.root)&&!isNull(e.pivot));
    for(const e of this.facingUI){
      const rt=e.root.getTransform();
      const toUser=rt.getInvertedWorldTransform().multiplyDirection(cam.sub(rt.getWorldPosition()));
      if(new vec2(toUser.x,toUser.z).length<1)continue;
      // Signed angle about +Y that turns `facing` toward the user, in the marker's own frame.
      const want=Math.atan2(e.facing.z*toUser.x-e.facing.x*toUser.z,e.facing.x*toUser.x+e.facing.z*toUser.z);
      if(e.angle===null){e.angle=e.target=want;}
      else if(Math.abs(wrapAngle(want-e.target))>FACING_DEADZONE)e.target=want;
      e.angle+=wrapAngle(e.target-e.angle)*k;
      e.pivot.getTransform().setLocalRotation(quat.angleAxis(e.angle,vec3.up()));
    }
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
    this.benchHeld=false;
    // A bench still waiting for a shoot type goes too; it's put back on the new floor once that's confirmed.
    if(this.workbench.active){this.workbench.dismiss();this.workbenchShown=false;}
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
    const dummy=this.dummies.get(root);
    if(dummy&&!isNull(dummy.root))return dummy.bottom();
    const visual=findMeshVisual(root);
    return visual?visual.worldAabbMin().y:root.getTransform().getWorldPosition().y;
  }
  /** Drops `body` (a fresh marker's pivot, still at the root's origin) to its mesh's lowest point while
   * keeping the mesh where it is, so scaling `body` grows the prop up from its feet. */
  private pivotAtFeet(root:SceneObject,body:SceneObject,bottom?:number):void {
    const visual=findMeshVisual(body);
    if(!visual)return;
    const feet=(bottom??visual.worldAabbMin().y)-root.getTransform().getWorldPosition().y;
    body.getTransform().setLocalPosition(new vec3(0,feet,0));
    for(let i=0;i<body.getChildrenCount();i++){
      const t=body.getChild(i).getTransform();
      t.setLocalPosition(t.getLocalPosition().sub(new vec3(0,feet,0)));
    }
  }
  /** Keeps a dummy's marker at the middle of its body and its hit box around it, so a dummy tipped over
   * by its hips (see PosableDummy) still sits on its spot, shows its halo and labels over itself, and can
   * be grabbed anywhere along it. `moveMarker` moves the marker to the body (after a pose change, so
   * nothing jumps); otherwise the body is moved onto the marker (when building it, e.g. from a saved
   * layout, whose saved spot is that middle). Resting on the floor is left to liftOnto. */
  private fitDummy(root:SceneObject,moveMarker:boolean):void {
    const dummy=this.dummies.get(root);
    if(!dummy||isNull(dummy.root))return;
    const rt=root.getTransform(),b=dummy.bounds();
    if(!Number.isFinite(b.min.x)||b.max.x<b.min.x)return;
    const p=rt.getWorldPosition();
    const delta=b.min.add(b.max).uniformScale(0.5).sub(p);
    if(delta.length>0.5){
      if(moveMarker)rt.setWorldPosition(p.add(delta));
      const dt=dummy.root.getTransform();
      const shift=dummy.root.getParent().getTransform().getInvertedWorldTransform().multiplyDirection(delta);
      dt.setLocalPosition(dt.getLocalPosition().sub(shift));
    }
    // Hit box: wide enough for the body in the marker's own (yawed) frame; its height is unchanged.
    const col=root.getComponent("Physics.ColliderComponent") as ColliderComponent;
    const shape=col?col.shape as BoxShape:null;
    if(!shape)return;
    const c=rt.getWorldPosition(),inv=rt.getWorldRotation().invert();
    const bb=dummy.bounds();
    let ax=0,az=0;
    for(const x of [bb.min.x,bb.max.x])for(const z of [bb.min.z,bb.max.z]){
      const l=inv.multiplyVec3(new vec3(x-c.x,0,z-c.z));
      ax=Math.max(ax,Math.abs(l.x));az=Math.max(az,Math.abs(l.z));
    }
    const box=Shape.createBoxShape();
    const h=bb.max.y-bb.min.y;
    box.size=new vec3(Math.max(55,ax*2+10),Math.max(30,h),Math.max(55,az*2+10));
    col.shape=box;
    // The name tag and badges float a set height over the middle: lower them with the body.
    const ui=findChild(root,"Facing UI"),built=this.dummyBuiltHeight.get(root);
    if(ui&&built!==undefined){
      const t=ui.getTransform(),l=t.getLocalPosition();
      t.setLocalPosition(new vec3(l.x,(h-built)/2,l.z));
    }
  }
  /** Moves a marker vertically so its lowest point rests at `surfaceY`. */
  /** Puts a prop down on a surface: by its lowest point, except a seated subject on something raised (a
   * chair, a table edge), which sits on it by the hips so its legs hang down. */
  private standOn(root:SceneObject,surfaceY:number,kind:number):void {
    const dummy=this.dummies.get(root);
    if(kind===4&&dummy&&this.floorY!==null&&surfaceY>this.floorY+SEAT_SURFACE_MIN){
      const t=root.getTransform();
      t.setWorldPosition(t.getWorldPosition().add(new vec3(0,surfaceY-dummy.seatBottom(),0)));
      return;
    }
    this.liftOnto(root,surfaceY);
  }
  private liftOnto(root:SceneObject,surfaceY:number):void {
    const t=root.getTransform();
    t.setWorldPosition(t.getWorldPosition().add(new vec3(0,surfaceY-this.bottomOf(root),0)));
  }
  /** Nothing may sit below the floor — not after a grab, a gizmo drag, or a restored layout. */
  private keepAboveFloor():void {
    this.placed.forEach((root,i)=>{
      if(isNull(root))return;
      // A dummy mid-pose may swing through the floor (tipping it over by the hips); it settles on release.
      if(this.dummies.get(root)?.dragging)return;
      const floor=this.floorY===null?this.groundY[i]:this.floorY;
      // Measuring a prop's lowest point walks all its meshes (a dummy has dozens), so it's only redone
      // when the prop has moved, its pose changed or the floor did — not every frame.
      const pos=root.getTransform().getWorldPosition(),seen=this.floorSeen.get(root);
      if(seen&&seen.floor===floor&&seen.pos.distance(pos)<0.01)return;
      this.floorSeen.set(root,{pos,floor});
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
    const idx=this.placed.indexOf(root);
    if(idx<0)return;
    const kind=this.kinds[idx];
    const p=root.getTransform().getWorldPosition(),dummy=this.dummies.get(root);
    // A seated subject is measured from its seat, so legs hanging off a table edge don't make it miss the top.
    const feet=kind===4&&dummy?dummy.seatBottom():this.bottomOf(root);
    // Cast from just above the feet, so a table or shelf overhead isn't taken for the surface below.
    const top=new vec3(p.x,feet+SETTLE_RAY_ABOVE,p.z),bottom=new vec3(p.x,feet-400,p.z);
    const land=(y:number)=>{
      if(isNull(root)||this.placed.indexOf(root)<0)return;
      this.groundY[this.placed.indexOf(root)]=y;
      this.standOn(root,y,kind);
      if(this.editing===root)this.gizmo.update();
    };
    const fallback=()=>{
      // Nothing flat below (moved off the edge of a chair, say): stand on the floor rather than float.
      // (Actors are left alone: they may be held up on purpose.)
      if(this.floorY!==null&&!(kind===3||kind===4)&&feet>this.floorY+1)land(this.floorY);
    };
    if(!this.hitSession){fallback();return}
    this.hitSession.hitTest(top,bottom,result=>{
      if(isNull(root))return;
      if(this.isFlat(result)){this.noteSurface(result.position.y);land(result.position.y);}
      else fallback();
    });
  }
  /** Resolves a queued pinch: places on the first flat surface Specs finds under the aim — the floor, a
   * seat, a table. If none turns up in time, it lands where the pointing ray meets the known floor, as long
   * as nothing upright (a wall) is in the way. Only aiming at a wall, or up off the floor, gets a message. */
  private updatePending():void {
    const p=this.pending;
    if(!p)return;
    this.surfaceHitTest(p.ray,p.aim,point=>{
      if(this.pending!==p||!point)return;
      this.noteSurface(point.y);
      this.pending=null;
      this.spawnMarker(p.kind,this.landingSpot(point));
    });
    if(getTime()-p.started<PLACE_SEARCH_SECONDS)return;
    this.pending=null;
    if(this.floorY!==null&&p.ray.dir.y<-0.05){
      const t=(this.floorY-p.ray.start.y)/p.ray.dir.y;
      if(t>0&&t<FLOOR_FALLBACK_REACH&&t<p.wallAt){
        this.spawnMarker(p.kind,p.ray.start.add(p.ray.dir.uniformScale(t)));
        return;
      }
    }
    this.showHint(this.floorY===null?this.floorHint(p.ray):p.wallAt<Infinity?"Point at the floor or a surface":"Aim lower, at the floor or a surface");
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
    // Above the prop preview when one is standing there, so the message isn't hidden inside it.
    let lift=SPINNER_RADIUS+6;
    if(this.placementPreview.enabled){
      const box=worldBounds(this.placementPreview);
      if(box)lift=Math.max(lift,box.max.y-anchor.y+HINT_ABOVE_PREVIEW);
    }
    this.hint.getTransform().setWorldPosition(anchor.add(new vec3(0,lift,0)));
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
  /** A pinch never drags a prop around: props move with their edit arrows or a fist grab only. */
  private applyDragMode():void {
    this.placed.forEach(root=>{if(!isNull(root))this.setCanDrag(root,false);});
  }
  private setCanDrag(root:SceneObject,_can:boolean):void {
    const m=root.getComponent(InteractableManipulation.getTypeName()) as InteractableManipulation;
    if(m)m.setCanTranslate(false);
  }
  private updateHoverHalo():void {
    // A held prop keeps its halo even when the closed hand's ray has drifted off it.
    const held=this.grabMove.holding;
    // Only while a prop is actually held: pointing at one stays quiet.
    const target=held;
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
    // The small collapsed bar sits low and to the right; the open menu (~70 cm tall) is centred on the gaze
    // so it fits the glasses' view top to bottom.
    const drop=this.palette.isCollapsed?PALETTE_HEIGHT_OFFSET:0;
    const distance=this.palette.isCollapsed?PALETTE_DISTANCE:PALETTE_OPEN_DISTANCE;
    const target=camPos.add(forward.uniformScale(distance)).add(new vec3(0,drop,0)).add(side);
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
    // Walking over to capture a camera angle: a stray pinch must not drop a new asset.
    if(this.angleCapture.guiding||this.roomOutline.active)return;
    if(!this.floorSetup.done){
      if(this.floorSetup.canSkip){this.lastAction=getTime();this.floorSetup.skip();}
      return;
    }
    // A pinch while the bench ghost is up puts the bench there.
    if(this.benchGhost&&!isNull(this.benchGhost)&&this.benchGhost.enabled){this.lastAction=getTime();this.benchHeld=true;this.placeAudio.play(1);return}
    // Nothing is placed before the bench (and its intro) is done: its own keys take pinches then.
    if(this.workbench.active||this.shootType===null)return;
    if(this.toolkitCard.active)return;
    if(this.pinningPoster){this.pinPoster();return}
    if(this.placed.length>=this.maxMarkers){this.palette.setHint("Marker limit reached — Undo or Clear All");return}
    if(this.pending)return;
    // A pinch aimed at an existing prop isn't a placement on the floor behind it.
    if(this.hovered&&!isNull(this.hovered))return;
    this.lastAction=getTime();
    const ray=this.rayFor(interactor),aim=this.positionFor(interactor);
    // The placement grid is showing on a surface Specs just saw (floor, seat, table): put it right there.
    if(getTime()-this.previewHitTime<PREVIEW_HIT_FRESH&&this.previewPoint){
      this.spawnMarker(this.selected,this.landingSpot(this.onPlane(ray,aim,this.previewGroundY)));
      return;
    }
    // Otherwise queued: updatePending waits (spinner showing) for a surface under the aim point.
    const p={kind:this.selected,ray,aim,started:getTime(),wallAt:Infinity};
    this.pending=p;
    // Note anything upright in the way (a wall), so the floor fallback won't place behind it.
    this.hitSession?.hitTest(ray.start,ray.start.add(ray.dir.uniformScale(RAY_REACH)),hit=>{
      if(this.pending===p&&hit&&!this.isFlat(hit))p.wallAt=hit.position.distance(ray.start);
    });
  }
  /** A spot within FLOOR_MATCH of the confirmed floor lands exactly on it; anything else (a seat, a
   * table) stays at its own height. */
  private landingSpot(point:vec3):vec3 {
    return this.floorY!==null&&Math.abs(point.y-this.floorY)<=FLOOR_MATCH?new vec3(point.x,this.floorY,point.z):point;
  }
  /** `position` is the point on the real surface; the marker's lowest point is stood on it. */
  /** Picks the tool used for the next pinch on the floor (an asset kind, or HAND_KIND for none). */
  private selectTool(kind:number):void {
    this.pinningPoster=false;this.selected=kind;this.lastAction=getTime();
    this.rebuildPreview();this.refresh();this.applyDragMode();
  }
  private spawnMarker(kind:number,position:vec3):void {
    // Placing something new means the user has moved on: close edit mode on whatever was being adjusted.
    this.closeEdit();
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
    this.standOn(root,position.y,kind);
    if(kind===1)this.tiltKeyLight(root);
    this.placeAudio.play(1);this.refresh();
    console.log("Scout placed "+label);
    this.tips.done("place");
    this.toolkitCard.close();
    // First thing after placing: how to fine-tune it (tilt, rotation, position) — then the rest.
    // Dummies get their own: in edit mode their limbs can be posed.
    if(kind===3||kind===4)this.tips.show("pose");
    else if(kind!==2)this.tips.show("edit");
    if(kind===0||kind===1)this.tips.show("dials");
    if(kind===0)this.tips.show("capture");
    if(kind===2)this.tips.show("note");
    if(this.placed.length>=3)this.tips.show("save");
    // Back to the Hand: after placing something the user usually wants to look at or adjust it, not
    // drop another of the same right away. Picking a tool again places another.
    this.selectTool(HAND_KIND);
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
    // A light on a tilting rig: now the beam is aimed relative to the level softbox, restore its saved tilt.
    // Applying a saved tilt isn't the user turning the wheel: no clicks.
    RigSounds.muted=true;
    try{this.heightSliders.find(h=>h.root===root)?.afterAim?.();}finally{RigSounds.muted=false;}
  }
  /** The tripod and both bodies, or null if they aren't wired (the Camera prop then falls back to cameraPrefab). */
  private rigPrefabs():RigPrefabs {
    if(this.classicRig?.length!==3||this.cameraBodies?.length!==2)return null;
    const handheld=this.handheldCameras?.length===2&&this.handheldCameras.every(p=>!!p)?{cinema:this.handheldCameras[0],photo:this.handheldCameras[1]}:undefined;
    return {tripod:this.classicRig,bodies:{cinema:this.cameraBodies[0],photo:this.cameraBodies[1]},handheld};
  }
  /** A camera's body: the one it was saved with, else cinema for video shoots and photo for photo shoots. */
  private bodyFor(state:CameraAssetState):BodyKind {
    if(state.body==="cinema"||state.body==="photo")return state.body;
    return this.shootType==="photo"?"photo":"cinema";
  }
  /** Gives a Camera or Light prop its edit-mode controls: the height slider (plus, for cameras, the body
   * picker) and the tilt wheel. The floating UI and the hit box follow the top of the prop. */
  private attachRigControls(root:SceneObject,rig:TiltRig&{lift:number;setLift(cm:number):void;setTilt(deg:number):void},
    state:{lift?:number;tilt?:number},height:number,col:ColliderComponent,
    opts:{sliderY:number;camera?:CameraRig;savedTilt?:number}):void {
    const entry=this.facingUI.find(e=>e.root===root);
    const facing=entry?entry.facing:vec3.forward();
    const side=vec3.up().cross(facing).normalize();
    // A pivot that turns with the floating UI keeps the slider on the user's side of the prop, off to
    // one side of it and clear of the gizmo's arrows (77 cm out) and turn ring (55 cm, at root height).
    const pivot=global.scene.createSceneObject("Height slider pivot");pivot.setParent(root);
    const pos=facing.uniformScale(SLIDER_OUT).add(side.uniformScale(SLIDER_SIDE)).add(new vec3(0,opts.sliderY,0));
    // The floating UI was laid out for the prop as built; another camera body or a raised column moves
    // the top of the prop, and the UI and hit box follow it.
    const cam=opts.camera;
    const fit=()=>{
      const rise=(cam?cam.totalHeight:rig.lift+height)-height;
      if(entry&&!isNull(entry.pivot))entry.pivot.getTransform().setLocalPosition(new vec3(0,rise,0));
      // The hit box stays centred on the root; the extra below the floor is harmless.
      const shape=Shape.createBoxShape();shape.size=new vec3(70,height+2*Math.max(0,rise),70);col.shape=shape;
    };
    const apply=(cm:number)=>{
      rig.setLift(cm);
      state.lift=Math.round(rig.lift*10)/10;
      fit();
    };
    const touched=()=>{this.lastAction=getTime();};
    const tilt=(deg:number)=>{rig.setTilt(deg);state.tilt=Math.round(rig.tiltAngle);};
    const wheel=new TiltWheel(rig,this.wheelMaterial(),this.camera,tilt,touched);
    const pick=cam?(kind:BodyKind)=>{
      if(kind===cam.body)return;
      cam.setBody(kind);(state as CameraAssetState).body=kind;fit();
      wheel.rebuild(this.wheelMaterial());
      this.selectAudio.play(1);
    }:undefined;
    // Cameras can also be handheld: the tripod gives way to an operator holding the camera.
    const pickMount=cam?.canHandhold?(kind:MountKind)=>{
      if(kind===cam.mount)return;
      cam.setMount(kind);(state as CameraAssetState).mount=kind;fit();
      this.selectAudio.play(1);
    }:undefined;
    // The Tripod/Handheld pair goes on the prop's other side (mirroring the slider), balancing the toolbar.
    const slider=new HeightSlider(pivot,pos,this.camera,()=>rig.lift,apply,touched,cam?.body,pick,pickMount?cam.mount:undefined,pickMount,-2*SLIDER_SIDE-MOUNT_EXTRA);
    slider.root.getTransform().setLocalRotation(quat.lookAt(facing,vec3.up()));
    const afterAim=opts.savedTilt!==undefined?()=>tilt(opts.savedTilt):undefined;
    this.heightSliders.push({root,pivot,slider,facingPivot:entry?entry.pivot:null,rig,wheel,afterAim,handheld:()=>cam?.mount==="handheld",
      lift:()=>rig.lift,setLift:apply,setTilt:tilt});
    apply(rig.lift);
  }
  /** One shared material for the tilt wheels (vertex-coloured, like the gizmo's handles). */
  private tiltWheelMaterial:Material=null;
  private wheelMaterial():Material {
    if(!this.tiltWheelMaterial){
      this.tiltWheelMaterial=this.markerMaterial.clone();
      // The ring is translucent glass: blend it over what's behind, without hiding things in the depth buffer.
      this.tiltWheelMaterial.mainPass.blendMode=BlendMode.Normal;
      this.tiltWheelMaterial.mainPass.depthWrite=false;
    }
    return this.tiltWheelMaterial;
  }
  /** Every placed Note's card, refreshed so a camera's new reference photo shows up on nearby notes. */
  private noteWizards:ScoutNoteWizard[]=[];
  private updateNotes():void {
    this.noteWizards=this.noteWizards.filter(w=>!isNull(w.root));
    for(const w of this.noteWizards)w.refresh();
  }
  /** The reference frame a Note shows: the nearest camera's captured angle. */
  private noteReference(note:SceneObject):NoteReference|null {
    if(isNull(note))return null;
    const rec=this.angleCapture.nearest(note.getTransform().getWorldPosition());
    if(!rec)return null;
    const state=this.angleCapture.isGuiding(rec)?"guiding":rec.captured?(rec.stale?"stale":"captured"):"empty";
    return {camera:rec.root.name,state,texture:rec.screen.image,capture:()=>{this.lastAction=getTime();this.tips.done("capture");this.angleCapture.start(rec);}};
  }
  private lastRay:PointerRay={start:vec3.zero(),dir:vec3.forward()};
  private lastRayFromHand=false;
  private lastAim:vec3=vec3.zero();
  private benchGhost:SceneObject=null;
  private benchAim:vec3=null;
  /** The see-through bench follows the floor spot the user points at, facing them, at least
   * BENCH_GHOST_MIN away so it's never placed on top of them. */
  /** The nearest placed prop whose box the ray passes through (not one open in edit mode), or null. */
  private pickProp(ray:PointerRay):SceneObject|null {
    if(!ray||!this.placed.length)return null;
    let best:SceneObject=null,bestT=Infinity;
    for(const root of this.placed){
      if(isNull(root)||!root.enabled||this.gizmo.isEditing(root))continue;
      const col=root.getComponent("Physics.ColliderComponent") as ColliderComponent;
      const shape=col?col.shape as BoxShape:null;
      if(!shape)continue;
      const inv=root.getTransform().getInvertedWorldTransform();
      const o=inv.multiplyPoint(ray.start),d=inv.multiplyDirection(ray.dir);
      const h=shape.size.uniformScale(0.5);
      let t0=-Infinity,t1=Infinity,hit=true;
      for(const [oc,dc,hc] of [[o.x,d.x,h.x],[o.y,d.y,h.y],[o.z,d.z,h.z]]){
        if(Math.abs(dc)<1e-6){if(Math.abs(oc)>hc){hit=false;break}continue}
        let a=(-hc-oc)/dc,b=(hc-oc)/dc;if(a>b){const x=a;a=b;b=x;}
        t0=Math.max(t0,a);t1=Math.min(t1,b);
        if(t0>t1){hit=false;break}
      }
      if(!hit||t1<0)continue;
      const t=Math.max(0,t0);
      if(t<bestT){bestT=t;best=root;}
    }
    return best;
  }
  private benchHeld=false;
  private benchPlaceUI:SceneObject=null;
  /** The see-through bench, before it's put down. It follows the floor spot the user points at (at least
   * BENCH_GHOST_MIN away, facing them) until a pinch on the floor sets it down, or the user takes hold of
   * it. Then it's theirs to adjust: pinch and drag it with one hand to slide it across the floor, twist
   * with two hands to turn it. The Place button above it confirms. */
  private updateBenchGhost():void {
    if(!this.benchGhost||isNull(this.benchGhost))this.buildGhostControls();
    this.benchGhost.enabled=true;
    const t=this.benchGhost.getTransform();
    const cam=this.camera.getTransform(),head=cam.getWorldPosition();
    if(!this.benchHeld){
      const fresh=getTime()-this.previewHitTime<PREVIEW_HIT_FRESH&&this.previewPoint&&Math.abs(this.previewPoint.y-this.floorY)<FLOOR_MATCH?this.previewPoint:null;
      let spot=fresh?fresh:this.onPlane(this.lastRay,this.lastAim,this.floorY);
      let flat=new vec3(spot.x-head.x,0,spot.z-head.z);
      if(flat.length<1){const f=cam.forward.uniformScale(-1);flat=new vec3(f.x,0,f.z);}
      const dist=Math.min(BENCH_GHOST_MAX,Math.max(BENCH_GHOST_MIN,flat.length)),dir=flat.normalize();
      spot=new vec3(head.x+dir.x*dist,this.floorY,head.z+dir.z*dist);
      this.benchAim=this.benchAim?vec3.lerp(this.benchAim,spot,Math.min(1,getDeltaTime()*12)):spot;
      t.setWorldPosition(this.benchAim);
      t.setWorldRotation(quat.angleAxis(Math.atan2(-dir.x,-dir.z),vec3.up()));
      this.showHint("Place in open space");
    }else{
      // Held: keep it standing on the floor and upright, whatever the hands did.
      const p=t.getWorldPosition();
      if(Math.abs(p.y-this.floorY)>0.01)t.setWorldPosition(new vec3(p.x,this.floorY,p.z));
      const f=t.getWorldRotation().multiplyVec3(vec3.forward());
      if(Math.abs(f.y)>0.001)t.setWorldRotation(quat.angleAxis(Math.atan2(f.x,f.z),vec3.up()));
      this.benchAim=t.getWorldPosition();
    }
    // The Place button floats in front of the ghost, turned to face the user.
    if(this.benchPlaceUI&&!isNull(this.benchPlaceUI)){
      this.benchPlaceUI.enabled=this.benchHeld;
      const ut=this.benchPlaceUI.getTransform(),up=ut.getWorldPosition();
      const front=t.getWorldRotation().multiplyVec3(vec3.forward());
      ut.setWorldPosition(t.getWorldPosition().add(new vec3(front.x*BENCH_PLACE_UI_FRONT,BENCH_PLACE_UI_Y,front.z*BENCH_PLACE_UI_FRONT)));
      ut.setWorldRotation(quat.angleAxis(Math.atan2(head.x-up.x,head.z-up.z),vec3.up()));
    }
  }
  /** The ghost, made grabbable: one hand slides it over the floor, two hands turn it about vertical. */
  private buildGhostControls():void {
    const g=buildBenchGhost(this.markerMaterial);
    this.benchGhost=g;
    // The hit box is centred on the ghost's pivot, which is on the floor (so it turns about its middle):
    // twice the bench's height covers it, and the half below the floor can't be reached anyway.
    const hc=g.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const hb=Shape.createBoxShape();hb.size=new vec3(BENCH_SIZE.x,BENCH_SIZE.y*2,BENCH_SIZE.z);hc.shape=hb;
    const input=g.createComponent(Interactable.getTypeName()) as Interactable;
    input.targetingMode=3;input.allowMultipleInteractors=true;
    const m=g.createComponent(InteractableManipulation.getTypeName()) as InteractableManipulation;
    m.setCanScale(false);m.setCanTranslate(true);m.setCanRotate(true);
    m.rotationAxis=RotationAxis.Y;m.enableYTranslation=false;
    m.onManipulationStart.add(()=>{this.benchHeld=true;this.lastAction=getTime();});
    this.buildGhostTurnRing(g);
    // Place button, in front of the ghost.
    const ui=global.scene.createSceneObject("Workbench place button");
    ui.createComponent("Component.Canvas");
    pillButton(ui,"Place workbench",vec3.zero(),44,11,170,false,()=>{this.lastAction=getTime();this.placeBench();});
    ui.enabled=false;
    this.benchPlaceUI=ui;
  }
  /** A clear, thick ring on the floor around the ghost: pinch it (near or far) and drag around it to turn
   * the bench about its middle. Brightens under the cursor. */
  private buildGhostTurnRing(g:SceneObject):void {
    const mat=this.markerMaterial.clone();
    mat.mainPass.blendMode=BlendMode.Normal;mat.mainPass.depthWrite=false;
    const ring=global.scene.createSceneObject("Ghost turn ring");ring.setParent(g);
    ring.getTransform().setLocalPosition(new vec3(0,0.6,0));
    const band=(c:[number,number,number,number])=>{
      const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
      b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;
      const ix:number[]=[],seg=96,r0=GHOST_RING_RADIUS-GHOST_RING_WIDTH/2,r1=GHOST_RING_RADIUS+GHOST_RING_WIDTH/2;
      for(let i=0;i<=seg;i++){
        const a=i*2*Math.PI/seg,cs=Math.cos(a),sn=Math.sin(a);
        b.appendVerticesInterleaved([cs*r0,0,sn*r0,0,1,0,...c]);b.appendVerticesInterleaved([cs*r1,0,sn*r1,0,1,0,...c]);
        if(i<seg){const v=i*2;ix.push(v,v+1,v+3,v,v+3,v+2,v,v+3,v+1,v,v+2,v+3);}
      }
      b.appendIndices(ix);const mesh=b.getMesh();b.updateMesh();return mesh;
    };
    const idle=band([0.85,0.8,1,0.35]),hot=band([0.8,0.68,1,0.8]);
    const visual=ring.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh=idle;visual.mainMaterial=mat;
    let hover=-1,drag:{interactor:Interactor;from:number;rot:quat}|null=null;
    const angleAt=(it:Interactor):number|null=>{
      const center=g.getTransform().getWorldPosition();
      let p:vec3=null;
      if(it.activeTargetingMode===TargetingMode.Direct||it.activeTargetingMode===TargetingMode.Poke)p=it.startPoint;
      else if(it.startPoint&&it.direction&&Math.abs(it.direction.y)>0.02){
        const t=(center.y-it.startPoint.y)/it.direction.y;
        if(t>0)p=it.startPoint.add(it.direction.uniformScale(t));
      }
      if(!p)return null;
      const dx=p.x-center.x,dz=p.z-center.z;
      return Math.hypot(dx,dz)<5?null:Math.atan2(dx,dz);
    };
    const refresh=()=>{visual.mesh=drag||getTime()-hover<0.15?hot:idle;};
    for(let i=0;i<GHOST_RING_HITS;i++){
      const a=i*2*Math.PI/GHOST_RING_HITS;
      const hit=global.scene.createSceneObject("Turn ring hit");hit.setParent(ring);
      hit.getTransform().setLocalPosition(new vec3(Math.cos(a)*GHOST_RING_RADIUS,4,Math.sin(a)*GHOST_RING_RADIUS));
      hit.getTransform().setLocalRotation(quat.angleAxis(-a,vec3.up()));
      const col=hit.createComponent("Physics.ColliderComponent") as ColliderComponent;
      const box=Shape.createBoxShape();box.size=new vec3(GHOST_RING_WIDTH+8,10,2*Math.PI*GHOST_RING_RADIUS/GHOST_RING_HITS+2);col.shape=box;
      const input=hit.createComponent(Interactable.getTypeName()) as Interactable;
      input.targetingMode=TargetingMode.All;input.enableInstantDrag=true;input.targetingPriority=TargetingPriority.High;
      input.onHoverEnter.add(()=>{hover=getTime();refresh();});
      input.onHoverUpdate.add(()=>{hover=getTime();});
      input.onHoverExit.add(()=>{hover=-1;refresh();});
      input.onTriggerStart.add(e=>{
        e.stopPropagation();
        const from=angleAt(e.interactor);
        if(from===null||drag)return;
        drag={interactor:e.interactor,from,rot:g.getTransform().getWorldRotation()};
        this.benchHeld=true;this.lastAction=getTime();refresh();
      });
      input.onTriggerUpdate.add(e=>{
        if(!drag||drag.interactor!==e.interactor)return;
        e.stopPropagation();
        const now=angleAt(e.interactor);
        if(now===null)return;
        g.getTransform().setWorldRotation(quat.angleAxis(now-drag.from,vec3.up()).multiply(drag.rot));
        this.lastAction=getTime();
      });
      const end=()=>{drag=null;refresh();};
      input.onTriggerEnd.add(end);input.onTriggerEndOutside.add(end);input.onTriggerCanceled.add(end);
    }
  }
  private placeBench():void {
    if(!this.benchAim||this.floorY===null||!this.benchGhost)return;
    const rot=this.benchGhost.getTransform().getWorldRotation();
    this.benchGhost.enabled=false;
    if(this.benchPlaceUI&&!isNull(this.benchPlaceUI))this.benchPlaceUI.enabled=false;
    this.workbenchShown=true;this.benchHeld=false;
    this.placeAudio.play(1);
    // A first-time user pages through the intro on the bench console before the Photo/Video buttons.
    this.workbench.show(this.floorY,{cards:INTRO_CARDS,onDone:()=>{markIntroSeen();this.lastAction=getTime();}},!introSeen(),this.benchAim,true,rot);
    this.benchAim=null;
  }
  /** A fist closing right next to something (no pointing needed): turns a dial, the edit ring or a tilt
   * wheel; on a camera or light head, raising/lowering the hand sets the rig's height and tipping the
   * wrist up/down tilts it; on any other prop, picks it up to move one-to-one with the hand. */
  private nearGrab(point:vec3,hand:BaseHand):NearGrab|null {
    if(this.workbench.active||this.angleCapture.guiding)return null;
    for(let i=ScoutRotaryDial.all.length-1;i>=0;i--){
      const d=ScoutRotaryDial.all[i];
      if(isNull(d.root)){ScoutRotaryDial.all.splice(i,1);continue}
      if(d.handTurnBegin(point)){this.lastAction=getTime();return {update:p=>d.handTurnUpdate(p),end:()=>d.handTurnEnd()};}
    }
    if(this.gizmo.handTurnBegin(point))return {update:p=>this.gizmo.handTurnUpdate(p),end:()=>this.gizmo.handTurnEnd()};
    for(const h of this.heightSliders){
      if(isNull(h.root)||!h.wheel.root.isEnabledInHierarchy)continue;
      if(h.wheel.handTurnBegin(point))return {update:p=>h.wheel.handTurnUpdate(p),end:()=>h.wheel.handTurnEnd()};
    }
    for(const h of this.heightSliders){
      if(isNull(h.root)||!h.root.enabled)continue;
      const box=worldBounds(h.rig.tilting);
      if(!box||!insideBox(point,box.min,box.max,NEAR_REACH))continue;
      const startLift=h.lift(),startY=point.y,startPitch=handPitch(hand),startTilt=h.rig.tiltAngle;
      this.lastAction=getTime();this.selectAudio.play(1);
      return {
        update:(p,hd)=>{
          h.setLift(startLift+(p.y-startY));
          h.setTilt(startTilt+(handPitch(hd)-startPitch));
          this.lastAction=getTime();
        },
        end:()=>{this.lastAction=getTime();},
      };
    }
    for(const root of this.placed){
      if(isNull(root)||!root.enabled||this.dummies.get(root)?.dragging||(this.dummies.has(root)&&this.gizmo.isEditing(root)))continue;
      const col=root.getComponent("Physics.ColliderComponent") as ColliderComponent;
      const shape=col?col.shape as BoxShape:null;
      if(!shape)continue;
      const local=root.getTransform().getInvertedWorldTransform().multiplyPoint(point),s=shape.size;
      if(Math.abs(local.x)<s.x/2+NEAR_REACH&&Math.abs(local.y)<s.y/2+NEAR_REACH&&Math.abs(local.z)<s.z/2+NEAR_REACH)return {move:root};
    }
    return null;
  }
  /** Each prop's edit badge icon, found once: a pencil, or a check while that prop is in edit mode (so
   * the same badge reads as "done" and closes it). */
  private editIcons=new Map<SceneObject,{img:Image;editing:boolean}>();
  private updateEditBadges():void {
    for(const root of this.placed){
      if(isNull(root))continue;
      let e=this.editIcons.get(root);
      if(!e){
        const badge=findDescendant(root,n=>n==="Edit"||n==="EditBadge");
        const img=badge?findComponentBelow(badge,"Component.Image") as Image:null;
        if(!img)continue;
        e={img,editing:false};this.editIcons.set(root,e);
      }
      const editing=this.gizmo.isEditing(root);
      if(editing===e.editing||isNull(e.img))continue;
      e.editing=editing;
      e.img.mainPass.baseTex=editing?DONE_ICON:EDIT_BADGE_ICON;
    }
    for(const k of this.editIcons.keys())if(isNull(k))this.editIcons.delete(k);
  }
  private captureClear=false;
  private captureHidden:SceneObject=null;
  /** Walking up to a camera to capture its angle: once close, every floating panel (name tags, dials,
   * monitors, notes, the menu) and that camera's own model step aside so the view is clear. They come
   * back when the capture finishes, is cancelled, or the user steps away. */
  private updateCaptureClear():void {
    const target=this.angleCapture.target;
    let near=false;
    if(target){
      const head=this.camera.getTransform().getWorldPosition(),p=target.getTransform().getWorldPosition();
      near=Math.hypot(head.x-p.x,head.z-p.z)<CAPTURE_CLEAR_RADIUS;
    }
    if(near===this.captureClear)return;
    this.captureClear=near;
    for(const e of this.facingUI)if(!isNull(e.pivot))e.pivot.enabled=!near;
    for(const w of this.noteWizards)if(!isNull(w.root))w.root.enabled=!near;
    if(this.captureHidden&&!isNull(this.captureHidden))this.captureHidden.enabled=true;
    this.captureHidden=near?target:null;
    if(near)target.enabled=false;
  }
  private menuSweepAt=0;
  /** The menu wins any pinch over the props behind it: its buttons get top targeting priority. Its
   * contents are rebuilt as pages change, so new buttons are picked up by a sweep twice a second. */
  private prioritizeMenu():void {
    if(getTime()<this.menuSweepAt||!this.palette||isNull(this.palette.sceneObject))return;
    this.menuSweepAt=getTime()+0.5;
    const visit=(so:SceneObject)=>{
      const it=so.getComponent(Interactable.getTypeName()) as Interactable;
      if(it&&it.targetingPriority!==TargetingPriority.High)it.targetingPriority=TargetingPriority.High;
      for(let i=0;i<so.getChildrenCount();i++)visit(so.getChild(i));
    };
    visit(this.palette.sceneObject);
  }
  /** A dummy's limbs are grabbable (and its joints show) only while it's in edit mode. */
  private updateDummies():void {
    for(const [root,dummy] of this.dummies){
      if(isNull(root)||isNull(dummy.root)){this.dummies.delete(root);continue}
      dummy.setEditable(this.gizmo.isEditing(root)||dummy.dragging);
      dummy.update();
    }
  }
  /** Each camera's height slider and tilt wheel show only while it's in edit mode (or mid-drag), so
   * moving the camera can never change its height or tilt by accident. */
  private updateHeightSliders():void {
    this.heightSliders=this.heightSliders.filter(h=>!isNull(h.root)&&!isNull(h.pivot));
    for(const h of this.heightSliders){
      const editing=this.gizmo.isEditing(h.root);
      const show=editing||h.slider.dragging;
      if(h.slider.root.enabled!==show)h.slider.root.enabled=show;
      if(show&&h.facingPivot&&!isNull(h.facingPivot))h.pivot.getTransform().setLocalRotation(h.facingPivot.getTransform().getLocalRotation());
      // Handheld: no tilt wheel (the operator holds the camera).
      const wheel=(editing||h.wheel.dragging)&&!h.handheld();
      if(h.wheel.root.enabled!==wheel)h.wheel.root.enabled=wheel;
      if(wheel){h.wheel.updateGlow();h.wheel.faceViewer(this.camera.getTransform().getWorldPosition());}
    }
  }
  /** Occlusion: the World Mesh (the room as Specs reconstructs it) drawn with a depth-only occluder, so
   * props, actors and their UI hide behind real furniture and walls. On by default; turning it off (which
   * also stops reconstructing the room, saving battery) is remembered per device. */
  private occluder:SceneObject=null;
  private occluderProvider:WorldRenderObjectProvider=null;
  private occlusionOn=false;
  /** Your real hands hide the props behind them: InteractionKit's hand visuals switch to their Full
   * hand mesh, which renders as an occluder by default. Separate from (and much cheaper than) the room
   * occlusion toggle, so it's always on. Found by walking the scene once the kit has spawned them. */
  private enableHandOcclusion():void {
    const apply=():number=>{
      let n=0;
      const visit=(so:SceneObject)=>{
        for(const c of so.getComponents("Component.ScriptComponent") as any[]){
          if(c&&c instanceof HandVisual){c.meshType=HandMeshType.Full;n++;}
        }
        for(let i=0;i<so.getChildrenCount();i++)visit(so.getChild(i));
      };
      for(let i=0;i<global.scene.getRootObjectsCount();i++)visit(global.scene.getRootObject(i));
      return n;
    };
    const ev=this.createEvent("DelayedCallbackEvent");
    ev.bind(()=>{const n=apply();if(n===0)console.warn("Scout: no hand visuals found for hand occlusion");});
    ev.reset(0.5);
  }
  private setupOcclusion():void {
    if(!this.worldMesh||!this.occluderMaterial)return;
    this.occluder=global.scene.createSceneObject("World occluder");
    const visual=this.occluder.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh=this.worldMesh;visual.mainMaterial=this.occluderMaterial;
    this.occluder.getTransform().setWorldPosition(new vec3(0,-OCCLUDER_SINK,0));
    // Drawn before everything else, so its depth is in place when the props render.
    visual.setRenderOrder(OCCLUDER_RENDER_ORDER);
    this.occluderProvider=this.worldMesh.control as WorldRenderObjectProvider;
    // Off unless the user has turned it on on this device: reconstructing the room heats Specs fast.
    let on=false;
    try{const store=global.persistentStorageSystem.store;if(store.has(OCCLUSION_KEY))on=store.getBool(OCCLUSION_KEY);}catch(e){}
    this.setOcclusion(on,false);
  }
  private setOcclusion(on:boolean,remember=true):void {
    this.occlusionOn=on;
    if(this.occluder&&!isNull(this.occluder))this.occluder.enabled=on;
    // Turning it off also stops reconstructing the room, which is where the battery goes.
    if(this.occluderProvider)this.occluderProvider.enableWorldMeshesTracking=on;
    this.palette.setOcclusion(on);
    if(remember)try{global.persistentStorageSystem.store.putBool(OCCLUSION_KEY,on);}catch(e){}
    console.log("Scout occlusion "+(on?"on":"off"));
  }
  private prefabFor(kind:number):ObjectPrefab {return [this.cameraPrefab,this.lightPrefab,null,this.standingPrefab,this.seatedPrefab][kind];}
  private makeMarker(kind:number,label:string,groundY:number,saved?:MarkerRecord):SceneObject {
    const root=global.scene.createSceneObject(label);root.setParent(this.markers);
    const prefab=this.prefabFor(kind);
    const cameraState=kind===0?{...defaultCameraState(),...saved?.cameraState}:null;
    // Camera props stand on a rig whose centre column can rise (see ScoutCameraRig).
    const bodyKind=cameraState&&this.rigPrefabs()?this.bodyFor(cameraState):null;
    if(bodyKind)cameraState.body=bodyKind;
    let height=bodyKind?rigHeight(bodyKind):MODEL_HEIGHTS[kind];
    let rig:CameraRig=null;
    let lightRigObj:LightRig=null;
    const lightState=kind===1?{...defaultLightState(),...saved?.lightState}:null;
    const noteState=kind===2?{...defaultNoteState(),...saved?.noteState}:null;
    let lightRef:LightMarkerRef|null=null;
    // The prop's body hangs under a pivot at its feet (kept the root's first child, so bottomOf still
    // finds the body's mesh first): hover grows the pivot, so the prop swells up from the floor.
    const body=global.scene.createSceneObject("Body");body.setParent(root);
    if(bodyKind){
      const holder=global.scene.createSceneObject("Rig");holder.setParent(body);
      holder.getTransform().setLocalPosition(new vec3(0,-height/2,0));
      rig=new CameraRig(holder,this.rigPrefabs(),bodyKind,cameraState.lift||0,cameraState.tilt||0,cameraState.mount==="handheld"?"handheld":"tripod");
      this.pivotAtFeet(root,body);
    }else if(lightState&&this.lightRig?.length===4){
      // Lights stand on a rig too: the pole rises and the softbox tilts (see ScoutCameraRig).
      const holder=global.scene.createSceneObject("Rig");holder.setParent(body);
      holder.getTransform().setLocalPosition(new vec3(0,-height/2,0));
      // Built level: tiltKeyLight aims the beam first, then the saved tilt is applied (afterAim).
      lightRigObj=new LightRig(holder,this.lightRig,lightState.lift||0,0);
      this.pivotAtFeet(root,body);
      lightRef=this.buildKeyLight(lightRigObj.frame,lightState);
    }else if((kind===3||kind===4)&&this.dummyParts?.length===DUMMY_PART_COUNT&&this.dummyParts.every(p=>!!p)){
      // Both subjects are the dummy cut at its joints so its limbs can be posed (see ScoutPosableDummy);
      // the seated one just starts sitting.
      const dummy=new PosableDummy(body,this.dummyParts,this.dummyMaterial||null,this.markerMaterial,saved?.pose??(kind===4?SEATED_POSE:undefined));
      const t=dummy.root.getTransform();
      // Sized as the standing figure (the model is 30 tall) — sitting just bends it.
      t.setLocalScale(vec3.one().uniformScale(MODEL_HEIGHTS[3]/30));
      // Its height is whatever its pose makes it (sitting is shorter), and the label, buttons and collider
      // all go by height — so measure it, and centre it on the marker like every other prop.
      const rootY=root.getTransform().getWorldPosition().y,feet=dummy.bottom()-rootY;
      height=dummy.top()-dummy.bottom();
      t.setLocalPosition(new vec3(0,-height/2-feet,0));
      this.pivotAtFeet(root,body,dummy.bottom());
      this.dummies.set(root,dummy);this.dummyBuiltHeight.set(root,height);
      // Posing pivots at the joints, so bending the knees would leave it floating: let go, and its
      // lowest point drops back to where it was.
      dummy.onChanged=before=>{
        this.lastAction=getTime();
        if(isNull(root))return;
        this.floorSeen.delete(root);
        this.fitDummy(root,true);
        this.liftOnto(root,before);
        if(this.editing===root)this.gizmo.update();
      };
    }else if(prefab){
      const model=prefab.instantiate(body),t=model.getTransform();
      t.setLocalScale(t.getLocalScale().uniformScale(height/30));
      t.setLocalPosition(new vec3(0,-height/2,0));
      this.pivotAtFeet(root,body);
      if(lightState)lightRef=this.buildKeyLight(model,lightState);
      // Subjects cast shadows but don't receive them: receiving its own shadow map made a lit dummy
      // ripple with shadow-acne ridges on whichever side faced the Light.
      if(kind===3||kind===4){
        const visual=findMeshVisual(model);
        if(visual)visual.meshShadowMode=MeshShadowMode.Caster;
      }
    }else{
      buildMarkerMesh(body,kind,this.markerMaterial,false);
      this.pivotAtFeet(root,body);
    }
    // Note's pin rises from the floor to eye level, so its interactive content anchors near the top of
    // the pin rather than just above a ground-level card, like every other asset's label/dial row does.
    const labelY=kind===2?NOTE_TIP_HEIGHT:height/2+8;
    if(noteState){
      const wizard=this.palette.buildNoteWizard(root,label,labelY,noteState,patch=>Object.assign(noteState,patch),()=>this.editMarker(root),()=>this.deleteMarker(root),this.shootType==="photo",()=>this.noteReference(root));
      if(wizard)this.noteWizards.push(wizard);
    }else{
      this.palette.decorateMarker(root,label,labelY,()=>this.editMarker(root),()=>this.deleteMarker(root),kind===0?1:kind===1?2:0);
    }
    // Two separate systems by design: Camera dials are informational only (no real-world effect is
    // requested for them); Light dials drive the marker's own LightSource/glow directly by closing
    // over `lightRef` — never an array index, so a later deletion of some other marker can't leave
    // this callback pointing at the wrong asset.
    if(cameraState){
      this.palette.buildCameraControls(root,labelY,cameraState,patch=>Object.assign(cameraState,patch));
      // Monitor above the dials for a reference photo of this camera's angle.
      const photo=this.shootType==="photo";
      let rec:AngleCameraRecord=null;
      const screen=this.palette.buildAngleScreen(root,labelY,photo,
        ()=>{this.lastAction=getTime();this.tips.done("capture");if(rec)this.angleCapture.start(rec);},
        ()=>{this.lastAction=getTime();this.angleCapture.cancel();});
      if(screen)rec=this.angleCapture.register(root,screen,photo);
    }
    if(lightState){
      const ref=lightRef;
      this.palette.buildLightControls(root,labelY,lightState,patch=>{
        Object.assign(lightState,patch);
        if(ref)this.applyLightLook(ref,lightState);
      });
    }
    this.groupFacingUI(root);
    const col=root.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const shape=Shape.createBoxShape();shape.size=kind===2?new vec3(14,NOTE_PIN_HEIGHT,14):new vec3(kind>=3?55:70,height,kind>=3?55:70);
    col.shape=shape;col.debugDrawEnabled=this.debugColliders;
    // The prop itself never catches the cursor: pointing past it at a dial, a button or another prop
    // shouldn't snag on it. The box still sizes things (the fist grab's reach, the floor halo, a lying
    // dummy's footprint) and pickProp aims the far fist grab with it; its own buttons and dials have
    // their own colliders.
    col.enabled=false;
    if(rig)this.attachRigControls(root,rig,cameraState,height,col,{sliderY:SLIDER_Y,camera:rig});
    if(lightRigObj)this.attachRigControls(root,lightRigObj,lightState,height,col,{sliderY:LIGHT_SLIDER_Y,savedTilt:lightState.tilt||0});
    // A saved dummy may be lying down: centre it on its marker and fit its hit box (see fitDummy).
    if(this.dummies.has(root))this.fitDummy(root,false);
    const interactable=root.createComponent(Interactable.getTypeName()) as Interactable;
    interactable.targetingMode=3;
    interactable.onTriggerStart.add(e=>{
      this.lastAction=getTime();
      // Pinching the prop itself (not its buttons) is the old way to move it: point to the fist instead.
      if(e.target===interactable&&this.selected!==HAND_KIND)this.tips.nudge("grab");
    });
    // The floor halo and the grow below track the prop itself, not the label/dials floating above it,
    // whose hover SIK bubbles up to this interactable too.
    const onProp=(e:{target:Interactable})=>{      if(e.target===interactable)this.hovered=root;
      else if(this.hovered===root)this.hovered=null;
    };
    interactable.onHoverEnter.add(onProp);
    interactable.onHoverUpdate.add(onProp);
    interactable.onHoverExit.add(()=>{if(this.hovered===root)this.hovered=null;});
    const manipulation=root.createComponent(InteractableManipulation.getTypeName()) as InteractableManipulation;
    manipulation.setCanScale(false);
    manipulation.setCanRotate(false);
    // Moving is a grab (ScoutGrabMove) or the edit arrows; a pinch never drags a prop, so pinching its
    // buttons, dials or limbs can't nudge it by accident.
    manipulation.setCanTranslate(false);
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
    // A real key light is a Spot: a soft cone that falls off with distance, so a light across the room
    // barely touches a subject. Built here (the runtime API sets the cone and falloff), on the same render
    // layer as the props so it actually lights them.
    // The aiming in tiltKeyLight points the bulb's -Z along the beam (what a Directional light wanted);
    // a Spot shines out of its +Z, so it sits on a child turned half round to face out of the softbox.
    const emitter=global.scene.createSceneObject("Spot");emitter.setParent(bulb);
    emitter.getTransform().setLocalRotation(quat.angleAxis(Math.PI,vec3.up()));
    const light=emitter.createComponent("Component.LightSource") as LightSource;
    light.lightType=LightType.Spot;
    light.innerConeAngleDegrees=KEY_LIGHT_CONE_INNER;
    light.outerConeAngleDegrees=KEY_LIGHT_CONE_OUTER;
    light.falloffType=FalloffType.Quadratic;
    light.falloffRange=KEY_LIGHT_RANGE;
    light.renderLayer=model.layer;
    console.log("Scout light: type="+light.lightType+" cone="+light.innerConeAngleDegrees+"/"+light.outerConeAngleDegrees
      +" falloff="+light.falloffType+"@"+light.falloffRange+" layer="+JSON.stringify(light.renderLayer.numbers)+" propLayer="+JSON.stringify(model.layer.numbers)+" camLayer="+JSON.stringify(this.camera.renderLayer.numbers));
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
    // The bulb glow keeps its colour bright at any intensity — dimming it by multiplying turned warm
    // colours brown. Intensity only takes a little off the top.
    const glow=0.82+0.18*pct;
    this.rebuildGlowMesh(ref.glowVisual,[rgb.x*glow,rgb.y*glow,rgb.z*glow,1]);
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
  /** Closes edit mode (handles, height slider and tilt wheel) if it's open on anything. */
  private closeEdit():void {
    if(!this.editing)return;
    this.gizmo.select(null);this.editing=null;
  }
  private editMarker(root:SceneObject):void {
    this.lastAction=getTime();
    const idx=this.placed.indexOf(root);
    if(idx<0)return;
    this.tips.done(this.kinds[idx]===3||this.kinds[idx]===4?"pose":"edit");
    if(this.gizmo.isEditing(root)){this.gizmo.select(null);this.editing=null;this.selectAudio.play(1);return}
    this.editing=root;
    // The same click as delete, so toggling edit is heard even when the handles appear out of view.
    this.selectAudio.play(1);
    // No up/down handle: everything stands on the floor (subjects included).
    const allowVertical=false;
    // The gizmo clamps the root, so translate "lowest point on the floor" into a minimum root height.
    const floor=this.floorY===null?this.groundY[idx]:this.floorY;
    const minRootY=root.getTransform().getWorldPosition().y-this.bottomOf(root)+floor;
    this.gizmo.select(root,allowVertical,minRootY);
    this.gizmo.setMode("Show handles");
  }
  /** A posed dummy's joint rotations, or undefined when it's at rest (or not a dummy). */
  private poseOf(root:SceneObject):DummyPose|undefined {
    const dummy=this.dummies.get(root);
    if(!dummy||isNull(dummy.root))return undefined;
    const pose=dummy.pose();
    return Object.keys(pose).length?pose:undefined;
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
  /** `fromBench`: the user just picked it on the bench (not restored from a layout), so introduce the toolkit. */
  private chooseShoot(type:ShootType,fromBench=false):void {
    this.shootType=type;this.lastAction=getTime();
    this.palette.setShootType(type);this.placeAudio.play(1);
    // The camera ghost shows this shoot's rig.
    this.rebuildPreview();
    if(fromBench)this.schedule(KIT_DELAY,()=>this.toolkitCard.show(KIT_TITLE,TOUR_STEPS,i=>this.palette&&!isNull(this.palette.sceneObject)&&this.palette.sceneObject.enabled?this.palette.toolAnchor(i):null));
    this.tips.show("place");
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
    this.closeEdit();
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
    this.tips.done("save");
    if(this.layouts.list().length>=MAX_SAVED_LAYOUTS){this.showHint("Delete a saved layout to make room");this.selectAudio.play(1);return}
    if(!this.placed.length&&!this.posters.length){this.showHint("Place something before saving");this.selectAudio.play(1);return}
    if(this.outlineConfirmed){this.writeLayout(this.roomOutline.frame,this.roomOutline.points);return}
    // First save this session: outline the room, so the layout can be put back exactly where it is.
    // Skipping saves it around where the user stands, as before.
    this.roomOutline.define(ok=>{
      this.lastAction=getTime();
      if(ok){this.outlineConfirmed=true;this.writeLayout(this.roomOutline.frame,this.roomOutline.points);}
      else this.writeLayout(this.userFrame(),null);
    });
  }
  /** Stores what's placed relative to `frame` (the room outline's, or the user's), plus the outline. */
  private writeLayout(frame:UserFrame,outline:vec2[]):void {
    const floor=frame.origin.y;
    // Millimetres for positions; yaw (radians) needs finer steps — 0.1 rad would be ~6°.
    const round=(n:number)=>Math.round(n*10)/10,roundYaw=(n:number)=>Math.round(n*1000)/1000;
    const data:SavedLayout={v:2,s:this.shootType||undefined,
      m:this.placed.map((root,i)=>{
        const p=this.toFrame(frame,root.getTransform().getWorldPosition());
        return {k:this.kinds[i],l:root.name,x:round(p.x),z:round(p.z),h:round(this.bottomOf(root)-floor),
          r:roundYaw(this.yawOf(root)-frame.yaw),c:this.cameraStates[i]||undefined,li:this.lightStates[i]||undefined,n:this.noteStates[i]||undefined,
          ps:this.poseOf(root)};
      }),
      p:this.posters.map(poster=>{
        const pos=poster.getTransform().getWorldPosition(),p=this.toFrame(frame,pos);
        return {x:round(p.x),z:round(p.z),h:round(pos.y-floor),r:roundYaw(this.yawOf(poster)-frame.yaw)};
      }),
      o:outline?outline.reduce((a,q)=>a.concat([round(q.x),round(q.y)]),[] as number[]):undefined,
    };
    const info=this.layouts.save(this.layouts.nextUntitledName(),JSON.stringify(data),data.m.length+data.p.length);
    if(!info){this.showHint("Couldn't save — storage is full");return}
    this.placeAudio.play(1);
    this.palette.setLayouts(this.layouts.list());
    console.log("Scout saved layout "+info.name+" ("+info.count+" items)");
    // Anchor the layout's frame in the background; once saved, the layout records the anchor's id.
    this.anchors.saveFrame(frame).then(anchorId=>{
      if(!anchorId)return;
      data.a=anchorId;
      this.layouts.update(info.id,JSON.stringify(data));
      console.log("Scout anchored layout "+info.name);
    });
    this.renameLayout(info.id);
  }
  /** Deletes the Spatial Anchor of a layout that's being deleted. */
  private forgetAnchor(id:string):void {
    try{const a=(JSON.parse(this.layouts.load(id)) as SavedLayout)?.a;if(a)this.anchors.remove(a);}catch(e){}
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
    const items:{so:SceneObject;x:number;z:number;r:number}[]=[];
    for(const m of data.m.slice(0,this.maxMarkers)){
      if(![0,1,2,3,4].includes(m.k))continue;
      const surface=floor+m.h;
      const root=this.makeMarker(m.k,m.l,surface,{cameraState:m.c,lightState:m.li,noteState:m.n,pose:m.ps} as MarkerRecord);
      root.getTransform().setWorldPosition(this.fromFrame(frame,m.x,m.z,surface));
      root.getTransform().setWorldRotation(quat.angleAxis(frame.yaw+m.r,vec3.up()));
      this.liftOnto(root,surface);
      if(m.k===1)this.tiltKeyLight(root);
      items.push({so:root,x:m.x,z:m.z,r:m.r});
    }
    for(const p of data.p){
      const poster=this.makePoster();
      poster.getTransform().setWorldPosition(this.fromFrame(frame,p.x,p.z,floor+p.h));
      poster.getTransform().setWorldRotation(quat.angleAxis(frame.yaw+p.r,vec3.up()));
      items.push({so:poster,x:p.x,z:p.z,r:p.r});
    }
    const o=Array.isArray(data.o)&&data.o.length>=6&&data.o.length%2===0?data.o:null;
    const pts:vec2[]=[];if(o)for(let i=0;i<o.length;i+=2)pts.push(new vec2(o[i],o[i+1]));
    // Saved against a room outline: show it where the layout landed and let the user line it up with the
    // real walls; everything follows the outline live (followOutline) until they tap Done.
    const lineUp=()=>{
      if(!o)return;
      this.aligning=items;
      this.roomOutline.align(pts,frame,()=>{this.aligning=null;this.outlineConfirmed=true;this.lastAction=getTime();});
    };
    // With a Spatial Anchor, first give Specs a moment to recognise the room: found, everything snaps to
    // exactly where it was saved; not found (or no anchors, as in the preview), the outline step above.
    this.anchors.release();
    if(typeof data.a==="string"&&this.anchorModule){
      this.showHint("Finding this room…");
      this.anchors.find(data.a,ANCHOR_WAIT_SECONDS,(s,fn)=>this.schedule(s,fn),found=>{
        this.placeItems(items,found);
        if(o){this.roomOutline.adopt(pts,found);this.outlineConfirmed=true;}
        this.showHint("Back where you left it");this.placeAudio.play(1);
        console.log("Scout placed layout "+id+" from its anchor");
      },()=>{
        if(o)this.showHint("Couldn't recognise the room — line it up by hand");
        lineUp();
      });
    }else lineUp();
    this.sequence=Math.max(this.sequence,...data.m.map(m=>Number(m.l.match(/(\d+)$/)?.[1])||0));
    this.refresh();this.placeAudio.play(1);
    console.log("Scout loaded layout "+id+" ("+data.m.length+" markers, "+data.p.length+" posters)");
  }
  /** While lining up a loaded layout: re-places each item in the outline's current frame (height kept). */
  private followOutline():void {
    if(!this.aligning)return;
    this.aligning=this.aligning.filter(it=>!isNull(it.so));
    this.placeItems(this.aligning,this.roomOutline.frame);
  }
  /** Re-places loaded items (saved x/z/yaw relative to a layout frame) in `frame`, keeping their height. */
  private placeItems(items:{so:SceneObject;x:number;z:number;r:number}[],frame:AnchorFrame):void {
    for(const it of items){
      if(isNull(it.so))continue;
      const t=it.so.getTransform();
      t.setWorldPosition(this.fromFrame(frame,it.x,it.z,t.getWorldPosition().y));
      t.setWorldRotation(quat.angleAxis(frame.yaw+it.r,vec3.up()));
    }
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
        noteState:this.noteStates[i]?{...this.noteStates[i]}:undefined,pose:this.poseOf(obj)};
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

function findChild(root:SceneObject,name:string):SceneObject|null {
  for(let i=0;i<root.getChildrenCount();i++)if(root.getChild(i).name===name)return root.getChild(i);
  return null;
}

/** World-space box around every mesh under `root`, or null if it has none. */
function worldBounds(root:SceneObject):{min:vec3;max:vec3}|null {
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  const visit=(so:SceneObject)=>{
    const v=so.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    if(v&&so.isEnabledInHierarchy){
      const a=v.worldAabbMin(),b=v.worldAabbMax();
      lo[0]=Math.min(lo[0],a.x);lo[1]=Math.min(lo[1],a.y);lo[2]=Math.min(lo[2],a.z);
      hi[0]=Math.max(hi[0],b.x);hi[1]=Math.max(hi[1],b.y);hi[2]=Math.max(hi[2],b.z);
    }
    for(let i=0;i<so.getChildrenCount();i++)visit(so.getChild(i));
  };
  visit(root);
  return Number.isFinite(lo[0])?{min:new vec3(lo[0],lo[1],lo[2]),max:new vec3(hi[0],hi[1],hi[2])}:null;
}
function insideBox(p:vec3,min:vec3,max:vec3,pad:number):boolean {
  return p.x>min.x-pad&&p.x<max.x+pad&&p.y>min.y-pad&&p.y<max.y+pad&&p.z>min.z-pad&&p.z<max.z+pad;
}
/** How far the hand is tipped up (+) or down (-), in degrees: wrist to middle knuckle against level. */
function handPitch(hand:BaseHand):number {
  const f=hand.middleKnuckle.position.sub(hand.wrist.position);
  return f.length>0.1?Math.asin(Math.max(-1,Math.min(1,f.y/f.length)))*180/Math.PI:0;
}

function findDescendant(root:SceneObject,match:(name:string)=>boolean):SceneObject|null {
  for(let i=0;i<root.getChildrenCount();i++){
    const c=root.getChild(i);
    if(match(c.name))return c;
    const d=findDescendant(c,match);
    if(d)return d;
  }
  return null;
}
function findComponentBelow(root:SceneObject,type:string):Component|null {
  const own=root.getComponent(type as any) as Component;
  if(own)return own;
  for(let i=0;i<root.getChildrenCount();i++){const c=findComponentBelow(root.getChild(i),type);if(c)return c;}
  return null;
}
