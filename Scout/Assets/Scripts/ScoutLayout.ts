import type {CameraAssetState,LightAssetState,NoteAssetState} from "./ScoutAssetState";
/** Portable layout data. Coordinates are centimeters relative to the planning frame. */
export type MarkerRecord = {kind:number; label:string; position:number[]; rotation:number[]; cameraState?:CameraAssetState; lightState?:LightAssetState; noteState?:NoteAssetState};
export type ScoutLayout = {version:1; frame:'manual'; markers:MarkerRecord[]};
export function parseLayout(raw:string):ScoutLayout {
  if(raw.length>24000)throw new Error('Layout is too large');
  const data=JSON.parse(raw);
  if(data?.version!==1||data.frame!=='manual'||!Array.isArray(data.markers)||data.markers.length>20)throw new Error('Unsupported layout');
  const vector=(v:unknown,n:number)=>Array.isArray(v)&&v.length===n&&v.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=100000);
  for(const m of data.markers){
    if(!m||![0,1,2,3,4].includes(m.kind)||typeof m.label!=='string'||m.label.length>48||!vector(m.position,3)||!vector(m.rotation,4))throw new Error('Invalid marker');
    const index=(v:unknown,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=max;
    const c=m.cameraState,l=m.lightState,n=m.noteState;
    if(c!==undefined&&(m.kind!==0||!c||!index(c.isoIndex,7)||!index(c.apertureIndex,9)||!index(c.shutterIndex,18)||!index(c.kelvinIndex,11)))throw new Error('Invalid camera settings');
    if(l!==undefined&&(m.kind!==1||!l||!index(l.intensityIndex,20)||!index(l.kelvinIndex,11)))throw new Error('Invalid light settings');
    if(n!==undefined&&(m.kind!==2||!n||!index(n.step,4)||!index(n.shotNumber,10)||n.shotNumber<1||(n.shotType!==null&&!index(n.shotType,5))||(n.movementType!==null&&!index(n.movementType,5))))throw new Error('Invalid note settings');
    const norm=m.rotation.reduce((sum:number,x:number)=>sum+x*x,0);
    if(Math.abs(norm-1)>.02)throw new Error('Invalid orientation');
  }
  return data as ScoutLayout;
}
