import {IMAGE_MATERIAL_ASSET} from "SpectaclesUIKit.lspkg/Scripts/Utility/Assets";
import {addBox} from "./ScoutMarkerMesh";

/** A moodboard poster pinned flat against a real wall, facing out along its local +Z. Until phone pairing
 * is live it shows a placeholder card — the flow (open Moodboard → pin to a wall) is real, the content
 * isn't yet. */
export const POSTER_WIDTH=60,POSTER_HEIGHT=80;
const PLACEHOLDER_ICON=requireAsset("../Icons/photo_library.png") as Texture;
const FONT=requireAsset("../Fonts/Inter.ttf") as Font;
const FRAME_COLOR:[number,number,number,number]=[0.42,0.32,0.82,1];
const PAPER_COLOR:[number,number,number,number]=[0.87,0.85,0.91,1];
const INK=new vec4(0.22,0.20,0.28,1);
// The aiming ghost is the same poster, dimmed — on an additive display dim reads as see-through.
const GHOST_DIM=0.35;

export function buildPoster(material:Material,ghost:boolean):SceneObject {
  const root=global.scene.createSceneObject(ghost?"Poster ghost":"Poster");
  const k=ghost?GHOST_DIM:1;
  const dim=(c:[number,number,number,number]):[number,number,number,number]=>[c[0]*k,c[1]*k,c[2]*k,1];
  const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
  b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;
  const ix:number[]=[];
  let v=addBox(b,ix,0,0,0,POSTER_WIDTH/2+1.5,POSTER_HEIGHT/2+1.5,0.4,dim(FRAME_COLOR),0);
  addBox(b,ix,0,0,0.3,POSTER_WIDTH/2,POSTER_HEIGHT/2,0.4,dim(PAPER_COLOR),v);
  b.appendIndices(ix);
  const card=root.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
  card.mesh=b.getMesh();card.mainMaterial=material;b.updateMesh();
  if(ghost)return root;
  const icon=global.scene.createSceneObject("Icon");icon.setParent(root);
  icon.getTransform().setLocalPosition(new vec3(0,10,1));
  icon.getTransform().setLocalScale(new vec3(26,26,1));
  const img=icon.createComponent("Component.Image") as Image;
  img.mainMaterial=IMAGE_MATERIAL_ASSET.clone();
  img.mainPass.baseTex=PLACEHOLDER_ICON;img.mainPass.baseColor=new vec4(FRAME_COLOR[0],FRAME_COLOR[1],FRAME_COLOR[2],1);
  text(root,"Reference image",new vec3(0,-14,1),110);
  text(root,"Pair your phone in\nMenu → Moodboard",new vec3(0,-26,1),70);
  return root;
}
function text(parent:SceneObject,value:string,pos:vec3,size:number):void {
  const so=global.scene.createSceneObject("Text");so.setParent(parent);
  so.getTransform().setLocalPosition(pos);
  const t=so.createComponent("Component.Text") as Text;
  t.text=value;t.font=FONT;t.size=size;t.textFill.color=INK;t.depthTest=true;
  t.horizontalAlignment=HorizontalAlignment.Center;t.verticalAlignment=VerticalAlignment.Center;
  t.horizontalOverflow=HorizontalOverflow.Overflow;t.verticalOverflow=VerticalOverflow.Overflow;
}
