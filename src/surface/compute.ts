// Molecular surfaces computed on a regular grid and triangulated with
// marching cubes. This module is pure computation (no WebGL, no mol types)
// so that it can run inside a worker and in node tests.
//
// Three surface types are supported, all for a set of spheres with centre a_i
// and van der Waals radius r_i:
//
//  - 'vdw': the union of the van der Waals spheres.
//  - 'sas': the solvent accessible surface, i.e. the union of spheres of
//    radius r_i + probe. This is the surface traced by the probe centre.
//  - 'ses': the solvent excluded (Connolly) surface, i.e. the surface traced
//    by the probe's front as it rolls over the molecule. A point is outside
//    the SES exactly when it lies within one probe radius of the region the
//    probe centre can reach (the SAS exterior), so the SES is the level set
//    at distance `probe` from the SAS exterior, taken inside the SAS.
//
// The field sampled on the grid is positive outside the surface and negative
// inside, and approximates the distance to the surface near it:
//
//  - vdw/sas: g(x) = min_i |x - a_i| - R_i, with R_i = r_i (+ probe for sas),
//    which is exact outside the spheres.
//  - ses: probe - D(x), where D is the distance from x to the SAS exterior.
//    D is measured against points sampled on the solvent accessible parts of
//    the SAS spheres (Shrake-Rupley dots). Because the SES sits a full probe
//    radius away from those dots, the error from sampling is quadratic in
//    the dot spacing (a few hundredths of an Angstrom), so re-entrant patches
//    come out smooth rather than faceted.

import { TRI_TABLE } from './mc-tables';

export type SurfaceType = 'vdw' | 'sas' | 'ses';

export interface SurfaceParams {
  type: SurfaceType;
  probeRadius: number;
  // requested grid spacing in Angstrom. May be increased to keep the number
  // of grid points below maxGridPoints.
  gridSpacing: number;
  maxGridPoints?: number;
  // upper bound for the number of vertices per chunk. Chunks are indexed with
  // 16 bit indices, and WebGL2 reserves 0xFFFF as the primitive restart
  // index, so this must not exceed 65535.
  maxChunkVerts?: number;
}

// One piece of the surface mesh that can be drawn with 16 bit indices.
// Within a chunk, vertices are sorted by atom.
export interface SurfaceChunk {
  positions: Float32Array;
  normals: Float32Array;
  // for every vertex, the index of the atom it belongs to (the one whose van
  // der Waals sphere is closest). Used for coloring and picking.
  atoms: Int32Array;
  indices: Uint16Array;
}

export interface SurfaceMesh {
  chunks: SurfaceChunk[];
  // the grid spacing that was actually used.
  gridSpacing: number;
}

const DEFAULT_MAX_GRID_POINTS = 8000000;
const DEFAULT_MAX_CHUNK_VERTS = 65535;

// Bins points into cubic cells for fixed radius neighbour queries. Points
// are stored in a flat xyz array; items lists point indices grouped by cell,
// with cell c occupying items[start[c]..start[c + 1]).
class CellGrid {
  readonly origin: [number, number, number];
  readonly size: number;
  readonly dims: [number, number, number];
  readonly start: Int32Array;
  readonly items: Int32Array;

  constructor(coords: Float32Array, count: number, size: number) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; ++i) {
      for (let k = 0; k < 3; ++k) {
        const v = coords[i * 3 + k]!;
        lo[k] = Math.min(lo[k]!, v);
        hi[k] = Math.max(hi[k]!, v);
      }
    }
    if (count === 0) {
      lo.fill(0);
      hi.fill(0);
    }
    this.origin = [lo[0]!, lo[1]!, lo[2]!];
    this.size = size;
    this.dims = [0, 1, 2].map((k) => Math.floor((hi[k]! - lo[k]!) / size) + 1) as
      [number, number, number];
    const numCells = this.dims[0] * this.dims[1] * this.dims[2];
    const cellOf = new Int32Array(count);
    this.start = new Int32Array(numCells + 1);
    for (let i = 0; i < count; ++i) {
      const c = this.cellIndex(coords[i * 3]!, coords[i * 3 + 1]!, coords[i * 3 + 2]!);
      cellOf[i] = c;
      this.start[c + 1]! += 1;
    }
    for (let c = 0; c < numCells; ++c) {
      this.start[c + 1]! += this.start[c]!;
    }
    const fill = this.start.slice(0, numCells);
    this.items = new Int32Array(count);
    for (let i = 0; i < count; ++i) {
      this.items[fill[cellOf[i]!]!++] = i;
    }
  }

  private cellIndex(x: number, y: number, z: number): number {
    const cx = Math.floor((x - this.origin[0]) / this.size);
    const cy = Math.floor((y - this.origin[1]) / this.size);
    const cz = Math.floor((z - this.origin[2]) / this.size);
    return cx + this.dims[0] * (cy + this.dims[1] * cz);
  }

  // calls callback for every point in a cell that intersects the cube of
  // half-width `radius` around (x, y, z). The callback may return true to
  // stop the iteration early.
  forEachNear(x: number, y: number, z: number, radius: number,
              callback: (index: number) => boolean | void): void {
    const lo = [x - radius, y - radius, z - radius], hi = [x + radius, y + radius, z + radius];
    const c0 = [0, 0, 0], c1 = [0, 0, 0];
    for (let k = 0; k < 3; ++k) {
      c0[k] = Math.max(0, Math.floor((lo[k]! - this.origin[k]!) / this.size));
      c1[k] = Math.min(this.dims[k]! - 1, Math.floor((hi[k]! - this.origin[k]!) / this.size));
      if (c0[k]! > c1[k]!) return;
    }
    for (let cz = c0[2]!; cz <= c1[2]!; ++cz) {
      for (let cy = c0[1]!; cy <= c1[1]!; ++cy) {
        let c = c0[0]! + this.dims[0] * (cy + this.dims[1] * cz);
        for (let cx = c0[0]!; cx <= c1[0]!; ++cx, ++c) {
          for (let j = this.start[c]!, e = this.start[c + 1]!; j < e; ++j) {
            if (callback(this.items[j]!) === true) return;
          }
        }
      }
    }
  }
}

// n points spread evenly over the unit sphere (Fibonacci lattice).
function unitSpherePoints(n: number): Float32Array {
  const points = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < n; ++k) {
    const y = 1 - (2 * k + 1) / n;
    const r = Math.sqrt(1 - y * y);
    const phi = k * golden;
    points[k * 3] = Math.cos(phi) * r;
    points[k * 3 + 1] = y;
    points[k * 3 + 2] = Math.sin(phi) * r;
  }
  return points;
}

// Points on the parts of the SAS spheres (centres, radii) not buried inside
// another SAS sphere, at a spacing of roughly `spacing`.
function accessibleDots(centers: Float32Array, radii: Float32Array, atomCells: CellGrid,
                        maxRadius: number, spacing: number): { coords: Float32Array; count: number } {
  const count = radii.length;
  const templates = new Map<number, Float32Array>();
  let coords = new Float32Array(1024 * 3);
  let numDots = 0;
  const neighbours: number[] = [];
  for (let i = 0; i < count; ++i) {
    const ax = centers[i * 3]!, ay = centers[i * 3 + 1]!, az = centers[i * 3 + 2]!;
    const ri = radii[i]!;
    neighbours.length = 0;
    atomCells.forEachNear(ax, ay, az, ri + maxRadius, (j) => {
      if (j === i) return;
      const dx = centers[j * 3]! - ax, dy = centers[j * 3 + 1]! - ay, dz = centers[j * 3 + 2]! - az;
      const reach = ri + radii[j]!;
      if (dx * dx + dy * dy + dz * dz < reach * reach) neighbours.push(j);
    });
    const n = Math.max(12, Math.ceil(4 * Math.PI * ri * ri / (spacing * spacing)));
    let unit = templates.get(n);
    if (!unit) {
      unit = unitSpherePoints(n);
      templates.set(n, unit);
    }
    // neighbouring dots tend to be buried by the same atom, so test that one
    // first.
    let lastBuriedBy = 0;
    for (let k = 0; k < n; ++k) {
      const x = ax + unit[k * 3]! * ri, y = ay + unit[k * 3 + 1]! * ri, z = az + unit[k * 3 + 2]! * ri;
      let buried = false;
      for (let m = 0; m < neighbours.length; ++m) {
        const idx = (m + lastBuriedBy) % neighbours.length;
        const j = neighbours[idx]!;
        const dx = x - centers[j * 3]!, dy = y - centers[j * 3 + 1]!, dz = z - centers[j * 3 + 2]!;
        const rj = radii[j]!;
        if (dx * dx + dy * dy + dz * dz < rj * rj) {
          buried = true;
          lastBuriedBy = idx;
          break;
        }
      }
      if (buried) continue;
      if (numDots * 3 === coords.length) {
        const grown = new Float32Array(coords.length * 2);
        grown.set(coords);
        coords = grown;
      }
      coords[numDots * 3] = x;
      coords[numDots * 3 + 1] = y;
      coords[numDots * 3 + 2] = z;
      numDots += 1;
    }
  }
  return { coords, count: numDots };
}

interface GridShape {
  origin: [number, number, number];
  spacing: number;
  nx: number;
  ny: number;
  nz: number;
}

interface Grid extends GridShape {
  values: Float32Array;
}

// Calls row(idx, count, dx0, dyz2) for every row of grid points inside the
// ball of radius r around c: count points starting at index idx, the first
// one at x offset dx0 from c, all at squared yz distance dyz2 from c.
function forEachBallRow(grid: GridShape, cx: number, cy: number, cz: number, r: number,
                        row: (idx: number, count: number, dx0: number, dyz2: number) => void): void {
  const { origin, spacing: h, nx, ny, nz } = grid;
  const r2 = r * r;
  const y0 = Math.max(0, Math.ceil((cy - r - origin[1]) / h)),
      y1 = Math.min(ny - 1, Math.floor((cy + r - origin[1]) / h));
  const z0 = Math.max(0, Math.ceil((cz - r - origin[2]) / h)),
      z1 = Math.min(nz - 1, Math.floor((cz + r - origin[2]) / h));
  for (let z = z0; z <= z1; ++z) {
    const dz = origin[2] + z * h - cz, dz2 = dz * dz;
    for (let y = y0; y <= y1; ++y) {
      const dy = origin[1] + y * h - cy, dyz2 = dy * dy + dz2;
      if (dyz2 >= r2) continue;
      const half = Math.sqrt(r2 - dyz2);
      const x0 = Math.max(0, Math.ceil((cx - half - origin[0]) / h)),
          x1 = Math.min(nx - 1, Math.floor((cx + half - origin[0]) / h));
      if (x1 < x0) continue;
      row(x0 + nx * (y + ny * z), x1 - x0 + 1, origin[0] + x0 * h - cx, dyz2);
    }
  }
}

// Samples the surface field (see top of file) on a grid covering all SAS
// spheres.
function sampleField(centers: Float32Array, radii: Float32Array, atomCells: CellGrid,
                     maxRadius: number, params: SurfaceParams): Grid {
  const count = radii.length;
  const probe = params.type === 'ses' ? params.probeRadius : 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; ++i) {
    for (let k = 0; k < 3; ++k) {
      lo[k] = Math.min(lo[k]!, centers[i * 3 + k]! - radii[i]!);
      hi[k] = Math.max(hi[k]!, centers[i * 3 + k]! + radii[i]!);
    }
  }
  const maxPoints = params.maxGridPoints || DEFAULT_MAX_GRID_POINTS;
  let h = params.gridSpacing;
  const extent = [0, 1, 2].map((k) => hi[k]! - lo[k]!);
  const pointsFor = (s: number) =>
    extent.reduce((p, e) => p * (Math.ceil(e / s) + 5), 1);
  while (pointsFor(h) > maxPoints) h *= 1.05;
  const pad = 2 * h;
  const origin: [number, number, number] = [lo[0]! - pad, lo[1]! - pad, lo[2]! - pad];
  const nx = Math.ceil(extent[0]! / h) + 5, ny = Math.ceil(extent[1]! / h) + 5,
      nz = Math.ceil(extent[2]! / h) + 5;
  const shape: GridShape = { origin, spacing: h, nx, ny, nz };
  const values = new Float32Array(nx * ny * nz);

  // g(x) = min |x - a_i| - R_i, evaluated exactly within `band` of the
  // spheres and clamped to `band` further out, where only the sign matters.
  const band = 2 * h;
  values.fill(band);
  for (let i = 0; i < count; ++i) {
    const R = radii[i]!;
    forEachBallRow(shape, centers[i * 3]!, centers[i * 3 + 1]!, centers[i * 3 + 2]!, R + band,
                   (idx, n, dx, dyz2) => {
      for (let end = idx + n; idx < end; ++idx, dx += h) {
        const d = Math.sqrt(dx * dx + dyz2) - R;
        if (d < values[idx]!) values[idx] = d;
      }
    });
  }
  if (probe === 0) {
    return { ...shape, values };
  }

  // SES: replace the SAS field by probe - D(x). Outside the SAS, D = -g.
  // Inside, D is the distance to the nearest dot, found by letting every dot
  // lower the squared distance of the grid points around it. Only values
  // within 2h of the SES are used for vertices and normals, so the search
  // stops at probe + 2h and points further inside get clamped. Since
  // D >= -g inside the SAS, points with -g >= reach are known to be clamped.
  const dotSpacing = Math.min(h, 0.5);
  const dots = accessibleDots(centers, radii, atomCells, maxRadius, dotSpacing);
  const reach = probe + 2 * h, reach2 = reach * reach;
  const dist2 = new Float32Array(values.length).fill(reach2);
  const dotCoords = dots.coords;
  for (let i = 0; i < dots.count; ++i) {
    forEachBallRow(shape, dotCoords[i * 3]!, dotCoords[i * 3 + 1]!, dotCoords[i * 3 + 2]!, reach,
                   (idx, n, dx, dyz2) => {
      for (let end = idx + n; idx < end; ++idx, dx += h) {
        const d2 = dx * dx + dyz2;
        if (d2 < dist2[idx]!) dist2[idx] = d2;
      }
    });
  }
  for (let idx = 0; idx < values.length; ++idx) {
    const g = values[idx]!;
    values[idx] = g > 0 || -g >= reach ? probe + g : probe - Math.sqrt(dist2[idx]!);
  }
  return { ...shape, values };
}

const CORNERS = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
                 [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
               [0, 4], [1, 5], [2, 6], [3, 7]];

interface RawMesh {
  positions: number[];
  normals: number[];
  triangles: number[];
}

// Marching cubes over the zero level of grid.values. Vertices are shared
// between neighbouring cells (keyed by the grid edge they lie on) and
// normals come from the field gradient, so the mesh is smooth and closed.
function triangulate(grid: Grid): RawMesh {
  const { nx, ny, nz, values, origin, spacing: h } = grid;
  const strides = [1, nx, nx * ny];
  // per cube edge: corner offset of its lower end within the cell, and the
  // axis it runs along.
  const edgeBase = EDGES.map(([a, b]) =>
    [0, 1, 2].map((k) => Math.min(CORNERS[a!]![k]!, CORNERS[b!]![k]!)));
  const edgeAxis = EDGES.map(([a, b]) =>
    [0, 1, 2].find((k) => CORNERS[a!]![k] !== CORNERS[b!]![k])!);
  const cornerOffset = CORNERS.map((c) => c[0]! + nx * (c[1]! + ny * c[2]!));

  const positions: number[] = [], normals: number[] = [], triangles: number[] = [];
  // vertex ids on the edges starting at grid layers z and z + 1, which are
  // all the edges the cells of layer z can touch. Indexed by layer parity.
  const layerSize = nx * ny * 3;
  const edgeVerts = [new Int32Array(layerSize).fill(-1), new Int32Array(layerSize).fill(-1)];
  const cellVerts = new Int32Array(16);
  const g0 = [0, 0, 0], g1 = [0, 0, 0];

  const gradient = (out: number[], x: number, y: number, z: number) => {
    const idx = x + nx * (y + ny * z);
    const coords = [x, y, z], dims = [nx, ny, nz];
    for (let k = 0; k < 3; ++k) {
      const lower = coords[k]! > 0 ? idx - strides[k]! : idx;
      const upper = coords[k]! < dims[k]! - 1 ? idx + strides[k]! : idx;
      out[k] = values[upper]! - values[lower]!;
    }
  };

  const vertexFor = (x: number, y: number, z: number, axis: number): number => {
    const idx = x + nx * (y + ny * z);
    const layer = edgeVerts[z & 1]!, key = (x + nx * y) * 3 + axis;
    if (layer[key]! >= 0) return layer[key]!;
    const f0 = values[idx]!, f1 = values[idx + strides[axis]!]!;
    const t = f0 / (f0 - f1);
    const p = [x, y, z];
    const q = [x, y, z];
    q[axis]! += 1;
    gradient(g0, p[0]!, p[1]!, p[2]!);
    gradient(g1, q[0]!, q[1]!, q[2]!);
    const n = [0, 1, 2].map((k) => g0[k]! + t * (g1[k]! - g0[k]!));
    const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    for (let k = 0; k < 3; ++k) {
      positions.push(origin[k]! + (p[k]! + (k === axis ? t : 0)) * h);
      normals.push(n[k]! / len);
    }
    const index = positions.length / 3 - 1;
    layer[key] = index;
    return index;
  };

  for (let z = 0; z < nz - 1; ++z) {
    edgeVerts[(z + 1) & 1]!.fill(-1);
    for (let y = 0; y < ny - 1; ++y) {
      let idx = nx * (y + ny * z);
      for (let x = 0; x < nx - 1; ++x, ++idx) {
        let config = 0;
        for (let c = 0; c < 8; ++c) {
          if (values[idx + cornerOffset[c]!]! > 0) config |= 1 << c;
        }
        if (config === 0 || config === 255) continue;
        const row = config * 16;
        for (let i = 0; i < 16 && TRI_TABLE[row + i]! >= 0; ++i) {
          const e = TRI_TABLE[row + i]!;
          const base = edgeBase[e]!;
          cellVerts[i] = vertexFor(x + base[0]!, y + base[1]!, z + base[2]!, edgeAxis[e]!);
          if (i % 3 === 2) {
            // the table winds triangles counter-clockwise seen from outside;
            // pv culls front faces and expects clockwise.
            triangles.push(cellVerts[i - 2]!, cellVerts[i]!, cellVerts[i - 1]!);
          }
        }
      }
    }
  }
  return { positions, normals, triangles };
}

// For every vertex, the atom with the closest van der Waals surface.
function assignAtoms(mesh: RawMesh, centers: Float32Array, vdwRadii: Float32Array,
                     atomCells: CellGrid, searchRadius: number): Int32Array {
  const numVerts = mesh.positions.length / 3;
  const owner = new Int32Array(numVerts);
  const pos = mesh.positions;
  for (let v = 0; v < numVerts; ++v) {
    const x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
    let best = Infinity, bestAtom = -1;
    const visit = (j: number) => {
      const dx = x - centers[j * 3]!, dy = y - centers[j * 3 + 1]!, dz = z - centers[j * 3 + 2]!;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - vdwRadii[j]!;
      if (d < best) {
        best = d;
        bestAtom = j;
      }
    };
    atomCells.forEachNear(x, y, z, searchRadius, visit);
    if (bestAtom < 0) {
      for (let j = 0; j < vdwRadii.length; ++j) visit(j);
    }
    owner[v] = bestAtom;
  }
  return owner;
}

// Splits the mesh into chunks of at most maxVerts vertices. Vertices are
// ordered by atom first, so each atom's vertices end up contiguous within a
// chunk; vertices of triangles straddling two chunks are duplicated.
function splitIntoChunks(mesh: RawMesh, owner: Int32Array, maxVerts: number): SurfaceChunk[] {
  const numVerts = owner.length;
  const numTris = mesh.triangles.length / 3;
  // order[k] is the k-th vertex when sorted by atom; rank is its inverse.
  const order = new Int32Array(numVerts);
  for (let v = 0; v < numVerts; ++v) order[v] = v;
  order.sort((a, b) => owner[a]! - owner[b]! || a - b);
  const rank = new Int32Array(numVerts);
  for (let k = 0; k < numVerts; ++k) rank[order[k]!] = k;

  // triangles sorted by their lowest ranked vertex (counting sort)
  const triStart = new Int32Array(numVerts + 1);
  const triKey = new Int32Array(numTris);
  for (let t = 0; t < numTris; ++t) {
    const k = Math.min(rank[mesh.triangles[t * 3]!]!, rank[mesh.triangles[t * 3 + 1]!]!,
                       rank[mesh.triangles[t * 3 + 2]!]!);
    triKey[t] = k;
    triStart[k + 1]! += 1;
  }
  for (let k = 0; k < numVerts; ++k) triStart[k + 1]! += triStart[k]!;
  const sortedTris = new Int32Array(numTris);
  for (let t = 0; t < numTris; ++t) sortedTris[triStart[triKey[t]!]!++] = t;

  const chunks: SurfaceChunk[] = [];
  const chunkOf = new Int32Array(numVerts).fill(-1);
  const local = new Int32Array(numVerts);
  let chunkVerts: number[] = [], chunkTris: number[] = [];
  const flush = () => {
    if (chunkTris.length === 0) return;
    // renumber the chunk's vertices in rank (= atom) order
    const ranks = Int32Array.from(chunkVerts, (v) => rank[v]!).sort();
    const n = ranks.length;
    const chunk: SurfaceChunk = {
      positions: new Float32Array(n * 3),
      normals: new Float32Array(n * 3),
      atoms: new Int32Array(n),
      indices: new Uint16Array(chunkTris.length),
    };
    for (let i = 0; i < n; ++i) {
      const v = order[ranks[i]!]!;
      local[v] = i;
      for (let k = 0; k < 3; ++k) {
        chunk.positions[i * 3 + k] = mesh.positions[v * 3 + k]!;
        chunk.normals[i * 3 + k] = mesh.normals[v * 3 + k]!;
      }
      chunk.atoms[i] = owner[v]!;
    }
    for (let i = 0; i < chunkTris.length; ++i) {
      chunk.indices[i] = local[chunkTris[i]!]!;
    }
    chunks.push(chunk);
    chunkVerts = [];
    chunkTris = [];
  };
  for (let s = 0; s < numTris; ++s) {
    const t = sortedTris[s]!;
    let missing = 0;
    for (let c = 0; c < 3; ++c) {
      if (chunkOf[mesh.triangles[t * 3 + c]!] !== chunks.length) missing += 1;
    }
    if (chunkVerts.length + missing > maxVerts) flush();
    for (let c = 0; c < 3; ++c) {
      const v = mesh.triangles[t * 3 + c]!;
      if (chunkOf[v] !== chunks.length) {
        chunkOf[v] = chunks.length;
        chunkVerts.push(v);
      }
      chunkTris.push(v);
    }
  }
  flush();
  return chunks;
}

// atoms holds x, y, z and van der Waals radius for each atom.
export function computeSurface(atoms: Float32Array, params: SurfaceParams): SurfaceMesh {
  const count = atoms.length / 4;
  if (count === 0) {
    return { chunks: [], gridSpacing: params.gridSpacing };
  }
  const centers = new Float32Array(count * 3);
  const vdwRadii = new Float32Array(count);
  const radii = new Float32Array(count);
  const inflate = params.type === 'vdw' ? 0 : params.probeRadius;
  let maxRadius = 0;
  for (let i = 0; i < count; ++i) {
    centers[i * 3] = atoms[i * 4]!;
    centers[i * 3 + 1] = atoms[i * 4 + 1]!;
    centers[i * 3 + 2] = atoms[i * 4 + 2]!;
    vdwRadii[i] = atoms[i * 4 + 3]!;
    radii[i] = vdwRadii[i]! + inflate;
    maxRadius = Math.max(maxRadius, radii[i]!);
  }
  const atomCells = new CellGrid(centers, count, 2 * maxRadius);
  const grid = sampleField(centers, radii, atomCells, maxRadius, params);
  const mesh = triangulate(grid);
  // every SES/SAS/vdW point lies within probe + h of some vdW sphere
  const owner = assignAtoms(mesh, centers, vdwRadii, atomCells,
                            maxRadius + grid.spacing);
  const chunks = splitIntoChunks(mesh, owner,
                                 params.maxChunkVerts || DEFAULT_MAX_CHUNK_VERTS);
  return { chunks, gridSpacing: grid.spacing };
}
