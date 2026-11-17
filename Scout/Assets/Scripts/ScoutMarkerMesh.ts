// Geometry helpers adapted from Snap CLAD. Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

/** Height from the floor to the notepad's mount point, shared with ScoutMain so its collider and
 * wizard-panel anchor line up with the geometry built here. Chosen so the whole pin+notepad assembly
 * tops out at about the Camera prop's own height (100 + notepad's own half-height ~45 ≈ 145). */
export const NOTE_PIN_HEIGHT=100;
/** How high the Note card's pointer tip floats above its spot on the floor (cm). */
export const NOTE_TIP_HEIGHT=52;

/** Where a Note is anchored: a small lavender disc on the floor and a faint dotted guide rising to the
 * tip of the card's pointer, so the floating card still reads as pinned to this spot. The disc is built
 * first so it's the mesh the floor-placement code measures (its bottom is the note's foot). */
export function buildWaypointPin(root:SceneObject, material:Material, height:number):SceneObject {
  const lav:[number,number,number,number]=[0.667,0.569,0.835,1];
  const pin=global.scene.createSceneObject("Pin");pin.setParent(root);
  const pb=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
  pb.topology=MeshTopology.Triangles;pb.indexType=MeshIndexType.UInt16;
  const ix:number[]=[];let vi=0;
  // Floor disc (flat, facing up, both sides).
  const disc=(cx:number,cy:number,r:number,upright:boolean)=>{
    const segs=20;
    pb.appendVerticesInterleaved([cx,cy,0,0,upright?0:1,upright?1:0,...lav]);
    for(let i=0;i<=segs;i++){
      const a=i*2*Math.PI/segs;
      const x=cx+r*Math.cos(a),o=r*Math.sin(a);
      pb.appendVerticesInterleaved(upright?[x,cy+o,0,0,0,1,...lav]:[x,cy,o,0,1,0,...lav]);
    }
    for(let i=1;i<=segs;i++)ix.push(vi,vi+i,vi+i+1,vi,vi+i+1,vi+i);
    vi+=segs+2;
  };
  disc(0,0,4,false);
  // Guide: small dots from just above the floor up to just under the pointer's tip.
  for(let y=6;y<height-3;y+=7)disc(0,y,0.55,true);
  pb.appendIndices(ix);
  const pv=pin.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
  pv.mesh=pb.getMesh();pv.mainMaterial=material.clone();pb.updateMesh();
  return root;
}

/** The Note tool's aiming ghost: a miniature of the field-journal card (page, tab, a few lines of text)
 * standing on its pointer over a small floor disc — about 30cm tall, like the other tools' ghosts.
 * Flat and double-sided, in the card's lavender. */
export function buildNoteGhost(parent:SceneObject, material:Material):SceneObject {
  const root=global.scene.createSceneObject("Note preview");root.setParent(parent);
  const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
  b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;
  const paper:[number,number,number,number]=[0.914,0.878,0.961,1],purple:[number,number,number,number]=[0.463,0.337,0.71,1];
  const lav:[number,number,number,number]=[0.667,0.569,0.835,1],tab:[number,number,number,number]=[0.80,0.73,0.90,1];
  const ix:number[]=[];let vi=0;
  const quad=(x0:number,y0:number,x1:number,y1:number,z:number,c:number[])=>{
    for(const [x,y] of [[x0,y0],[x1,y0],[x1,y1],[x0,y1]])b.appendVerticesInterleaved([x,y,z,0,0,1,...c]);
    ix.push(vi,vi+1,vi+2,vi,vi+2,vi+3,vi,vi+2,vi+1,vi,vi+3,vi+2);vi+=4;
  };
  const tri=(pts:number[][],z:number,c:number[])=>{
    pts.forEach(p=>b.appendVerticesInterleaved([p[0],p[1],z,0,0,1,...c]));
    ix.push(vi,vi+1,vi+2,vi,vi+2,vi+1);vi+=3;
  };
  // Floor disc.
  const segs=16;b.appendVerticesInterleaved([0,0.3,0,0,1,0,...lav]);
  for(let i=0;i<=segs;i++){const a=i*2*Math.PI/segs;b.appendVerticesInterleaved([3*Math.cos(a),0.3,3*Math.sin(a),0,1,0,...lav]);}
  for(let i=1;i<=segs;i++)ix.push(vi,vi+i,vi+i+1,vi,vi+i+1,vi+i);vi+=segs+2;
  // Pointer, page, tab, and a few "lines" of content.
  tri([[-3.5,9.5],[3.5,9.5],[0,5]],0,paper);
  quad(-9,9,9,29,0,paper);
  quad(-8.5,29,-1.5,31.2,0,tab);
  quad(-7,24.5,1,26.5,0.05,purple);
  quad(-7,21.5,6.5,22.2,0.05,lav);
  quad(-7,17.5,6.5,19.7,0.05,lav);
  quad(-7,13.5,0,15.7,0.05,lav);
  quad(2,11.4,7,13.4,0.05,purple);
  b.appendIndices(ix);
  const v=root.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
  v.mesh=b.getMesh();v.mainMaterial=material;b.updateMesh();
  return root;
}

/** Parametric, centimeter-authored marker geometry. The collider root stays unit scale. */
export function buildMarkerMesh(parent:SceneObject, kind:number, material:Material, preview:boolean):SceneObject {
  const root=global.scene.createSceneObject(preview?"Placement shape":"Marker shape");root.setParent(parent);
  const blue:[number,number,number,number]=preview?[0.65,0.9,1,1]:[0.25,0.7,1,1];
  const warm:[number,number,number,number]=preview?[1,0.9,0.65,1]:[1,0.7,0.2,1];
  const dark:[number,number,number,number]=[0.2,0.3,0.4,1];
  function mesh(name:string,build:(b:MeshBuilder)=>void,pos?:vec3,rot?:quat):SceneObject{
    const so=global.scene.createSceneObject(name);so.setParent(root);
    if(pos)so.getTransform().setLocalPosition(pos);if(rot)so.getTransform().setLocalRotation(rot);
    const b=new MeshBuilder([{name:"position",components:3},{name:"normal",components:3,normalized:true},{name:"color",components:4}]);
    b.topology=MeshTopology.Triangles;b.indexType=MeshIndexType.UInt16;build(b);
    const visual=so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh=b.getMesh();visual.mainMaterial=material;b.updateMesh();return so;
  }
  if(kind===0){
    mesh("Camera body",b=>{const ix:number[]=[];let v=0;v=addBox(b,ix,0,0,0,4,2.7,2,blue,v);v=addBox(b,ix,0,3.2,0,2,0.5,0.7,dark,v);v=addBox(b,ix,0,-3.6,0,0.5,0.9,0.5,dark,v);b.appendIndices(ix)});
    mesh("Camera lens",b=>{buildLathe(b,[[0,0],[2,0],[2,3],[1.7,3.5],[0,3.5]],24,dark)},new vec3(0,0,-2),quat.angleAxis(-Math.PI/2,vec3.right()));
    mesh("Shot direction",b=>{buildLathe(b,[[0,0],[0.25,0],[0.25,4],[1,4],[0,6]],16,blue)},new vec3(0,-4,-2),quat.angleAxis(-Math.PI/2,vec3.right()));
  }else if(kind===1){
    mesh("Light bulb",b=>{buildLathe(b,[[0,-2],[1,-2],[1.2,-1.3],[2.6,0],[3,1.5],[2.5,3.2],[1.4,4.2],[0,4.6]],28,warm)});
    mesh("Light base",b=>{buildLathe(b,[[0,-4],[1,-4],[1.1,-2],[0,-2]],24,dark)});
    mesh("Light rays",b=>{const ix:number[]=[];let v=0;v=addBox(b,ix,-4.3,1,0,0.65,0.22,0.22,warm,v);v=addBox(b,ix,4.3,1,0,0.65,0.22,0.22,warm,v);v=addBox(b,ix,0,6,0,0.22,0.65,0.22,warm,v);b.appendIndices(ix)});
  }else{
    buildWaypointPin(root,material,NOTE_TIP_HEIGHT);
  }
  return root;
}

export function addBox(
  builder: MeshBuilder,
  indices: number[],
  cx: number, cy: number, cz: number,
  hw: number, hh: number, hd: number,   // half-extents on x, y, z
  color: [number, number, number, number],
  baseIdx: number
): number {
  const x0 = cx - hw, x1 = cx + hw;
  const y0 = cy - hh, y1 = cy + hh;
  const z0 = cz - hd, z1 = cz + hd;

  const verts: number[] = [];
  let vi = baseIdx;

  const face = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    n:  [number, number, number],
  ) => {
    verts.push(
      ...p0, ...n, ...color,
      ...p1, ...n, ...color,
      ...p2, ...n, ...color,
      ...p3, ...n, ...color,
    );
    // CCW from outside: p0 → p1 → p2 → p3 traces counter-clockwise
    indices.push(vi, vi+1, vi+2,  vi, vi+2, vi+3);
    vi += 4;
  };

  face([x1,y0,z0], [x1,y1,z0], [x1,y1,z1], [x1,y0,z1], [ 1, 0, 0]); // +X
  face([x0,y0,z1], [x0,y1,z1], [x0,y1,z0], [x0,y0,z0], [-1, 0, 0]); // -X
  face([x0,y1,z0], [x0,y1,z1], [x1,y1,z1], [x1,y1,z0], [ 0, 1, 0]); // +Y
  face([x0,y0,z1], [x0,y0,z0], [x1,y0,z0], [x1,y0,z1], [ 0,-1, 0]); // -Y
  face([x0,y0,z1], [x1,y0,z1], [x1,y1,z1], [x0,y1,z1], [ 0, 0, 1]); // +Z
  face([x1,y0,z0], [x0,y0,z0], [x0,y1,z0], [x1,y1,z0], [ 0, 0,-1]); // -Z

  builder.appendVerticesInterleaved(verts);
  return vi;
}

export function buildLathe(
  builder: MeshBuilder,
  profile: [number, number][],    // [[r, y], ...] bottom→top, r >= 0
  segments: number,                // angular subdivisions (16–32 typical)
  color: [number, number, number, number],
  baseIdx: number = 0,
): number {
  const P = profile.length;
  let vi = baseIdx;
  const startIdx = vi;
  const indices: number[] = [];

  // Profile tangent → outward 2D normal = (dy, -dx), normalized
  const prof2dN: [number, number][] = [];
  for (let j = 0; j < P; j++) {
    const prev = profile[Math.max(0, j - 1)];
    const next = profile[Math.min(P - 1, j + 1)];
    const dx = next[0] - prev[0], dy = next[1] - prev[1];
    const len = Math.hypot(dy, -dx) || 1;
    prof2dN.push([dy / len, -dx / len]);
  }

  // Emit (segments+1) rings × P vertices (duplicated seam for clean UVs)
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const c = Math.cos(theta), s = Math.sin(theta);
    for (let j = 0; j < P; j++) {
      const [r, y] = profile[j];
      const [n2x, n2y] = prof2dN[j];
      builder.appendVerticesInterleaved([
        r * c, y, r * s,
        n2x * c, n2y, n2x * s,
        ...color,
      ]);
      vi++;
    }
  }

  // Side quads — correct winding for Y-axis lathe
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < P - 1; j++) {
      const bl = startIdx + i * P + j;
      const br = startIdx + i * P + (j + 1);
      const tl = startIdx + (i + 1) * P + j;
      const tr = startIdx + (i + 1) * P + (j + 1);
      indices.push(bl, br, tr,  bl, tr, tl);
    }
  }

  // Bottom cap (normal -Y) — (center, ring+i, ring+i+1) makes the cross product
  // point in -Y, outward for the bottom face.
  if (profile[0][0] > 1e-6) {
    const y = profile[0][1], r = profile[0][0];
    const center = vi;
    builder.appendVerticesInterleaved([0, y, 0, 0, -1, 0, ...color]); vi++;
    const ring = vi;
    for (let i = 0; i <= segments; i++) {
      const th = (i / segments) * Math.PI * 2;
      builder.appendVerticesInterleaved([r * Math.cos(th), y, r * Math.sin(th), 0, -1, 0, ...color]); vi++;
    }
    for (let i = 0; i < segments; i++) indices.push(center, ring + i, ring + i + 1);
  }

  // Top cap (normal +Y) — reversed order of the bottom cap winding.
  if (profile[P - 1][0] > 1e-6) {
    const y = profile[P - 1][1], r = profile[P - 1][0];
    const center = vi;
    builder.appendVerticesInterleaved([0, y, 0, 0, 1, 0, ...color]); vi++;
    const ring = vi;
    for (let i = 0; i <= segments; i++) {
      const th = (i / segments) * Math.PI * 2;
      builder.appendVerticesInterleaved([r * Math.cos(th), y, r * Math.sin(th), 0, 1, 0, ...color]); vi++;
    }
    for (let i = 0; i < segments; i++) indices.push(center, ring + i + 1, ring + i);
  }

  builder.appendIndices(indices);
  return vi;
}
