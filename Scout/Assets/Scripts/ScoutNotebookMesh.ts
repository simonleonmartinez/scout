/** 3D notebook geometry shared by the Note card and the Note tool's ghost: a back cover, a block of
 * stacked pages and a spiral binding down the left spine, built behind a page that lies in the z=0
 * plane (the page itself — and everything written on it — is drawn by the caller in front).
 *
 * The material is a flat vertex-colour one, so all shading is baked into the colours: faces toward the
 * viewer are lightest, edges and undersides darker, and the page block alternates two paper tones so its
 * edge reads as a stack of sheets. Everything is double-sided and sits behind z=0, so it never hides the
 * page's text (which doesn't write depth). */

type RGBA=[number,number,number,number];

const COVER:RGBA=[0.604,0.502,0.80,1];     // between #AA91D5 and #7656B5: solid on Specs, not see-through
const COVER_EDGE:RGBA=[0.47,0.37,0.66,1];
const SHEET_A:RGBA=[0.90,0.86,0.95,1];
const SHEET_B:RGBA=[0.80,0.75,0.88,1];
const RING:RGBA=[0.86,0.83,0.92,1];
const RING_SHADE:RGBA=[0.62,0.58,0.70,1];
const HOLE:RGBA=[0.52,0.46,0.62,1];

export type NotebookOptions={
  /** Page block thickness, and how many sheets it shows on its edge. */
  thickness?:number;sheets?:number;
  /** How far the cover sticks out past the pages on each side. */
  coverMargin?:number;coverThickness?:number;
  /** Spiral rings: how many, and their radius and wire thickness. */
  rings?:number;ringRadius?:number;ringWire?:number;
};

/** Builds the notebook body for a page `w`×`h` (rounded by `radius`) whose bottom-left is at
 * (-w/2, 0) and which faces +Z at z=0. Returns the SceneObject holding the mesh. */
export function buildNotebookBody(parent:SceneObject,material:Material,w:number,h:number,radius:number,opts:NotebookOptions={}):SceneObject {
  const thickness=opts.thickness??3.2,sheets=opts.sheets??6;
  const margin=opts.coverMargin??1.6,coverT=opts.coverThickness??1.1;
  const rings=opts.rings??Math.max(4,Math.round(h/9)),ringR=opts.ringRadius??2.4,wire=opts.ringWire??0.42;
  const so=global.scene.createSceneObject("Notebook body");so.setParent(parent);
  const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
  b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;
  const ix:number[]=[];
  const cy=h/2;
  // Page block: thin slabs stacked behind the page, alternating tones.
  const sheetT=thickness/sheets;
  for(let i=0;i<sheets;i++){
    const z1=-0.05-i*sheetT,z0=z1-sheetT*0.92;
    const c=i%2?SHEET_B:SHEET_A;
    prism(b,ix,0,cy,w-0.15*i,h-0.15*i,radius,z0,z1,c,shade(c,0.9),shade(c,0.8));
  }
  // Back cover, a little larger than the pages.
  const cz1=-0.05-thickness-0.05;
  prism(b,ix,0,cy,w+margin*2,h+margin*2,radius+margin*0.6,cz1-coverT,cz1,COVER,COVER_EDGE,shade(COVER_EDGE,0.85));
  // Spiral binding down the left spine: each ring loops through a punched hole near the page's edge,
  // around the spine and back through the cover.
  // Each loop passes through its hole near the page's left edge and wraps around past the cover's edge.
  const spineX=-w/2+2.2,outer=-w/2-margin-0.6;
  const loopX=(spineX+outer)/2,loopR=(spineX-outer)/2;
  const span=h-radius*2-ringR*1.2;
  const midZ=(0.4+cz1-coverT)/2,ringRz=(0.4-(cz1-coverT))/2+wire;
  for(let i=0;i<rings;i++){
    const y=radius+ringR*0.6+(rings>1?span*i/(rings-1):span/2);
    hole(b,ix,spineX,y,0.06,0.75);
    ring(b,ix,loopX,y,midZ,loopR,ringRz,wire);
  }
  b.appendIndices(ix);
  const v=so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
  v.mesh=b.getMesh();v.mainMaterial=material;b.updateMesh();
  return so;
}

function shade(c:RGBA,k:number):RGBA {return [c[0]*k,c[1]*k,c[2]*k,c[3]];}
function vert(b:MeshBuilder,p:number[],n:number[],c:RGBA):number {
  b.appendVerticesInterleaved([p[0],p[1],p[2],n[0],n[1],n[2],...c]);
  return b.getVerticesCount()-1;
}
/** Both windings, so the face shows from either side. */
function tri(ix:number[],a:number,b:number,c:number):void {ix.push(a,b,c,a,c,b);}

/** A rounded-rectangle slab between z0 and z1: light front face, `side` edges, `back` rear face. */
function prism(b:MeshBuilder,ix:number[],cx:number,cy:number,w:number,h:number,r:number,z0:number,z1:number,front:RGBA,side:RGBA,back:RGBA):void {
  r=Math.min(r,w/2,h/2);
  const pts:number[][]=[];
  const corners=[[w/2-r,h/2-r,0],[-w/2+r,h/2-r,90],[-w/2+r,-h/2+r,180],[w/2-r,-h/2+r,270]];
  for(const [x,y,a0] of corners)for(let k=0;k<=5;k++){
    const a=(a0+k*18)*Math.PI/180;
    pts.push([cx+x+r*Math.cos(a),cy+y+r*Math.sin(a)]);
  }
  const fc=vert(b,[cx,cy,z1],[0,0,1],front),bc=vert(b,[cx,cy,z0],[0,0,-1],back);
  const f=pts.map(p=>vert(b,[p[0],p[1],z1],[0,0,1],front));
  const k=pts.map(p=>vert(b,[p[0],p[1],z0],[0,0,-1],back));
  const sf=pts.map(p=>vert(b,[p[0],p[1],z1],norm(p[0]-cx,p[1]-cy),side));
  // Edges darken toward the back, and the underside is darker than the top (light from above).
  const sb=pts.map(p=>vert(b,[p[0],p[1],z0],norm(p[0]-cx,p[1]-cy),shade(side,p[1]<cy?0.82:0.92)));
  for(let i=0;i<pts.length;i++){
    const j=(i+1)%pts.length;
    tri(ix,fc,f[i],f[j]);tri(ix,bc,k[j],k[i]);
    tri(ix,sf[i],sb[i],sb[j]);tri(ix,sf[i],sb[j],sf[j]);
  }
}
function norm(x:number,y:number):number[] {const m=Math.hypot(x,y)||1;return [x/m,y/m,0];}
/** A punched hole on the page front (a small dark disc just in front of z=0). */
function hole(b:MeshBuilder,ix:number[],x:number,y:number,z:number,r:number):void {
  const c=vert(b,[x,y,z],[0,0,1],HOLE),n=12,ring:number[]=[];
  for(let i=0;i<n;i++){const a=i*2*Math.PI/n;ring.push(vert(b,[x+r*Math.cos(a),y+r*Math.sin(a),z],[0,0,1],HOLE));}
  for(let i=0;i<n;i++)tri(ix,c,ring[i],ring[(i+1)%n]);
}
/** One spiral-binding loop: a torus in the XZ plane centred at (x,y,z), stretched to `rz` deep. */
function ring(b:MeshBuilder,ix:number[],x:number,y:number,z:number,rx:number,rz:number,wire:number):void {
  const seg=18,tube=6,base=b.getVerticesCount();
  for(let i=0;i<=seg;i++){
    const a=i*2*Math.PI/seg,ca=Math.cos(a),sa=Math.sin(a);
    // Lit from the front/top: the loop's front half is light, the back half shaded.
    const lit=0.5+0.5*Math.max(0,sa);
    for(let j=0;j<=tube;j++){
      const t=j*2*Math.PI/tube,ct=Math.cos(t),st=Math.sin(t);
      const nx=ca*ct,ny=st,nz=sa*ct;
      const c:RGBA=[
        RING_SHADE[0]+(RING[0]-RING_SHADE[0])*lit*(0.75+0.25*Math.max(0,ny)),
        RING_SHADE[1]+(RING[1]-RING_SHADE[1])*lit*(0.75+0.25*Math.max(0,ny)),
        RING_SHADE[2]+(RING[2]-RING_SHADE[2])*lit*(0.75+0.25*Math.max(0,ny)),1];
      vert(b,[x+(rx+wire*ct)*ca,y+wire*st,z+(rz+wire*ct)*sa],[nx,ny,nz],c);
    }
  }
  for(let i=0;i<seg;i++)for(let j=0;j<tube;j++){
    const a=base+i*(tube+1)+j,c=a+tube+1;
    tri(ix,a,c,a+1);tri(ix,a+1,c,c+1);
  }
}
