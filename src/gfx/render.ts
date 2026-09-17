// Copyright (c) 2013-2015 Marco Biasini
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import geom from '../geom';
import BillboardGeomCtor, { type BillboardGeom } from './billboard-geom';
import LineGeomCtor, { type LineGeom } from './line-geom';
import MeshGeomCtor, { type MeshGeom } from './mesh-geom';
import gfxGeomBuilders from './geom-builders';
import { AtomVertexAssoc, TraceVertexAssoc } from './vert-assoc';
import color from '../color';
import { vec3, vec4, mat3 } from 'gl-matrix';
import type UniqueObjectIdPool from '../unique-object-id-pool';
import type { ContinuousIdRange } from '../unique-object-id-pool';

// Structural typing for the mol data model (some tiers already typed, some
// not): only what render.ts touches to build geometry.
export interface RenderAtom {
  pos(): vec3;
  element(): string;
  bonds(): RenderBond[];
  bondCount(): number;
  eachBond(callback: (bond: RenderBond) => void): void;
  full(): RenderAtom;
}
interface RenderBond {
  mid_point(out: vec3): vec3;
}
interface RenderResidue {
  ss(): string;
  isNucleotide(): boolean;
  isAminoacid(): boolean;
  name(): string;
  atom(name: string): RenderAtom | null;
}
interface RenderTrace {
  length(): number;
  posAt(out: vec3, index: number): vec3;
  centralAtomAt(index: number): RenderAtom;
  residueAt(index: number): RenderResidue;
  smoothPosAt(out: vec3, index: number, strength: number): vec3;
  smoothNormalAt(out: vec3, index: number, strength: number): vec3;
  fullTraceIndex(index: number): number;
}
interface RenderChain {
  atomCount(): number;
  eachAtom(callback: (atom: RenderAtom) => void): void;
  backboneTraces(): RenderTrace[];
  name(): string;
}
export interface RenderStructure {
  eachChain(callback: (chain: RenderChain) => void): void;
  select(what: unknown): RenderStructure;
}

interface AllocatorLike<T> {
  request(length: number): T;
  release(buffer: T): void;
}

type ObjIdData = { geom: unknown; atom?: RenderAtom; isTrace?: boolean };

type ProtoSphereT = InstanceType<typeof gfxGeomBuilders.ProtoSphere>;
type ProtoCylinderT = InstanceType<typeof gfxGeomBuilders.ProtoCylinder>;
type TubeProfileT = InstanceType<typeof gfxGeomBuilders.TubeProfile>;

// This options bag is built up by Viewer (not yet converted) and mutated
// in place by the render functions below (e.g. exports.spheres assigns
// opts.protoSphere for spheresForChain to read) -- every field ends up
// required from the perspective of whichever function reads it.
export interface RenderOptions {
  color: InstanceType<typeof color.ColorOp>;
  idPool: UniqueObjectIdPool<ObjIdData>;
  float32Allocator: AllocatorLike<Float32Array>;
  uint16Allocator: AllocatorLike<Uint16Array>;
  showRelated: string | null;
  radiusMultiplier: number;
  sphereDetail: number;
  arcDetail: number;
  splineDetail: number;
  strength: number;
  radius: number;
  scaleByAtomRadius?: boolean;
  sphereRadius: number;
  cylRadius: number;
  lineWidth: number;
  pointSize: number;
  forceTube?: boolean;
  smoothStrands?: boolean;
  arrowSkip: number;
  protoSphere: ProtoSphereT;
  protoCyl: ProtoCylinderT;
  coilProfile: TubeProfileT;
  arrowProfile: TubeProfileT;
  helixProfile: TubeProfileT;
  strandProfile: TubeProfileT;
}

const TubeProfile = gfxGeomBuilders.TubeProfile;
const ProtoSphere = gfxGeomBuilders.ProtoSphere;
const ProtoCylinder = gfxGeomBuilders.ProtoCylinder;

const interpolateColor = color.interpolateColor;

const exports: Record<string, unknown> = {};

const R = 0.6;
const R2 = 0.8071;
const COIL_POINTS = [ -R, -R, 0, R, -R, 0, R, R, 0, -R, R, 0 ];

const HELIX_POINTS = [
  -6.0 * R, -0.9 * R2, 0,
  -5.8 * R, -1.0 * R2, 0,

   5.8 * R, -1.0 * R2, 0,
   6.0 * R, -0.9 * R2, 0,

   6.0 * R,  0.9 * R2, 0,
   5.8 * R,  1.0 * R2, 0,

  -5.8 * R,  1.0 * R2, 0,
  -6.0 * R,  0.9 * R2, 0
];


const ARROW_POINTS = [
 -10.0 * R, -0.9 * R2, 0,
  -9.8 * R, -1.0 * R2, 0,

   9.8 * R, -1.0 * R2, 0,
  10.0 * R, -0.9 * R2, 0,

  10.0 * R,  0.9 * R2, 0,
   9.8 * R,  1.0 * R2, 0,

  -9.8 * R,  1.0 * R2, 0,
 -10.0 * R,  0.9 * R2, 0
];

/* van der Waals radius by atom._element
 * from Royal Society of Chemistry
 * http://www.rsc.org/periodic-table/trends
*/
const VDW_RADIUS = {
  H: 1.1,
  C: 1.7,
  N: 1.55,
  O: 1.52,
  F: 1.47,
  CL: 1.75,
  BR: 1.85,
  I : 1.98,
  HE : 1.4,
  NE : 1.54,
  AR : 1.88,
  XE : 2.16,
  KR : 2.02,
  P: 1.8,
  S: 1.8,
  B : 1.92,
  LI : 1.82,
  NA : 2.27,
  K : 2.75,
  RB : 3.03,
  CS : 3.43,
  FR : 3.48,
  BE : 1.53,
  MG : 1.73,
  SR : 2.49,
  BA : 2.68,
  RA : 2.83,
  TI : 2.11,
  FE : 2.04,
  CU: 1.96,
};

// performs an in-place smoothing over 3 consecutive positions.
const smoothStrandInplace = (function() {
  const bf = vec3.create(), af = vec3.create(), cf = vec3.create();
  return function(p: Float32Array, from: number, to: number, length: number) {
    from = Math.max(from, 1);
    to = Math.min(length - 1, to);
    let startIndex = 3 * (from - 1);
    vec3.set(bf, p[startIndex]!, p[startIndex + 1]!, p[startIndex + 2]!);
    vec3.set(cf, p[3 * from]!, p[3 * from + 1]!, p[3 * from + 2]!);
    for (let i = from; i < to; ++i) {
      startIndex = 3 * (i + 1);
      vec3.set(af, p[startIndex]!, p[startIndex + 1]!, p[startIndex + 2]!);
      p[3 * i + 0] = af[0] * 0.25 + cf[0] * 0.50 + bf[0] * 0.25;
      p[3 * i + 1] = af[1] * 0.25 + cf[1] * 0.50 + bf[1] * 0.25;
      p[3 * i + 2] = af[2] * 0.25 + cf[2] * 0.50 + bf[2] * 0.25;
      vec3.copy(bf, cf);
      vec3.copy(cf, af);
    }
  };
})();


const spheresForChain = (function() {
  const color = vec4.fromValues(0.0, 0.0, 0.0, 1.0);

  return function(meshGeom: MeshGeom, vertAssoc: InstanceType<typeof AtomVertexAssoc>,
                  opts: RenderOptions, chain: RenderChain) {
    const atomCount = chain.atomCount();
    const idRange = opts.idPool.getContinuousRange(atomCount)!;
    meshGeom.addIdRange(idRange);
    const vertsPerSphere = opts.protoSphere.numVerts();
    const indicesPerSphere = opts.protoSphere.numIndices();
    const radius = 1.5 * opts.radiusMultiplier;
    meshGeom.addChainVertArray(chain as never, vertsPerSphere*atomCount,
                              indicesPerSphere*atomCount);
    chain.eachAtom(function(atom) {
      const va = meshGeom.vertArrayWithSpaceFor(vertsPerSphere);
      opts.color.colorFor(atom as never, color as Float32Array, 0);
      const vertStart = va.numVerts();
      const objId = idRange.nextId({ geom: meshGeom, atom : atom });
      opts.protoSphere.addTransformed(va as never, atom.pos(), radius, color, objId);
      const vertEnd = va.numVerts();
      vertAssoc.addAssoc(atom as never, va as never, vertStart, vertEnd);
    });
  };
})();

exports.spheres = function(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions) {
  console.time('spheres');
  const protoSphere = new ProtoSphere(opts.sphereDetail, opts.sphereDetail);
  opts.protoSphere = protoSphere;
  const geom = new MeshGeomCtor(gl, opts.float32Allocator, opts.uint16Allocator);
  const vertAssoc = new AtomVertexAssoc(structure as never, true);
  geom.addVertAssoc(vertAssoc as never);
  geom.setShowRelated(opts.showRelated);
  opts.color.begin(structure as never);
  structure.eachChain(function(chain) {
    spheresForChain(geom, vertAssoc, opts, chain);
  });
  opts.color.end();
  console.timeEnd('spheres');
  return geom;
};

const billboardedSpheresForChain = (function() {
  const color = vec4.fromValues(0.0, 0.0, 0.0, 1.0);

  return function(meshGeom: BillboardGeom, vertAssoc: InstanceType<typeof AtomVertexAssoc>,
                  opts: RenderOptions, chain: RenderChain) {
    const atomCount = chain.atomCount();
    const idRange = opts.idPool.getContinuousRange(atomCount)!;
    meshGeom.addIdRange(idRange);
    const vertsPerSphere = 4; // one quad per sphere
    const indicesPerSphere = 6; // two triangles per quad
    const radius = 1.5 * opts.radiusMultiplier;
    meshGeom.addChainVertArray(chain as never, vertsPerSphere*atomCount,
                              indicesPerSphere*atomCount);
    chain.eachAtom(function(atom) {
      const va = meshGeom.vertArrayWithSpaceFor(vertsPerSphere);
      opts.color.colorFor(atom as never, color as Float32Array, 0);
      const objId = idRange.nextId({ geom: meshGeom, atom : atom });
      const vertStart = va.numVerts();
      const p = atom.pos();
      va.addVertex(p, [-1.0, -1.0, radius], color, objId);
      va.addVertex(p, [+1.0, +1.0, radius], color, objId);
      va.addVertex(p, [+1.0, -1.0, radius], color, objId);
      va.addVertex(p, [-1.0, +1.0, radius], color, objId);
      va.addTriangle(vertStart + 0, vertStart + 1, vertStart + 2);
      va.addTriangle(vertStart + 0, vertStart + 3, vertStart + 1);
      const vertEnd = va.numVerts();
      vertAssoc.addAssoc(atom as never, va as never, vertStart, vertEnd);
    });
  };
})();

exports.billboardedSpheres = function(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions) {
  console.time('billboardedSpheres');
  const geom = new BillboardGeomCtor(gl, opts.float32Allocator,
                               opts.uint16Allocator);
  const vertAssoc = new AtomVertexAssoc(structure as never, true);
  geom.addVertAssoc(vertAssoc as never);
  geom.setShowRelated(opts.showRelated);
  opts.color.begin(structure as never);
  structure.eachChain(function(chain) {
    billboardedSpheresForChain(geom, vertAssoc, opts, chain);
  });
  opts.color.end();
  console.timeEnd('billboardedSpheres');
  return geom;
};




const ballsAndSticksForChain = (function() {
  const midPoint = vec3.create(), dir = vec3.create();
  const color = vec4.fromValues(0.0, 0.0, 0.0, 1.0);
  const left = vec3.create(), up = vec3.create();
  const rotation = mat3.create();
  return function(meshGeom: MeshGeom, vertAssoc: InstanceType<typeof AtomVertexAssoc>,
                  opts: RenderOptions, chain: RenderChain) {
    // determine required number of vertices and indices for this chain
    const atomCount = chain.atomCount();
    let bondCount = 0;
    chain.eachAtom(function(a) { bondCount += a.bonds().length; });
    const numVerts = atomCount * opts.protoSphere.numVerts() +
                   bondCount * opts.protoCyl.numVerts();
    const numIndices = atomCount * opts.protoSphere.numIndices() +
                     bondCount * opts.protoCyl.numIndices();
    meshGeom.addChainVertArray(chain as never, numVerts, numIndices);
    const idRange = opts.idPool.getContinuousRange(atomCount)!;
    meshGeom.addIdRange(idRange);
    // generate geometry for each atom
    chain.eachAtom(function(atom) {
      const atomScale = opts.scaleByAtomRadius ?
        (VDW_RADIUS as Record<string, number>)[atom.element()] || 1 :
        1;
      const atomRadius = opts.sphereRadius * atomScale;
      const atomVerts = opts.protoSphere.numVerts() +
                      atom.bondCount() * opts.protoCyl.numVerts();
      const va = meshGeom.vertArrayWithSpaceFor(atomVerts);
      const vertStart = va.numVerts();
      const objId = idRange.nextId({ geom: meshGeom, atom : atom });

      opts.color.colorFor(atom as never, color as Float32Array, 0);
      opts.protoSphere.addTransformed(va as never, atom.pos(), atomRadius, color,
                                         objId);
      atom.eachBond(function(bond) {
        bond.mid_point(midPoint);
        vec3.sub(dir, atom.pos(), midPoint);
        const length = vec3.length(dir);

        vec3.scale(dir, dir, 1.0/length);

        geom.buildRotation(rotation, dir, left, up, false);

        vec3.add(midPoint, midPoint, atom.pos());
        vec3.scale(midPoint, midPoint, 0.5);
        opts.protoCyl.addTransformed(va as never, midPoint, length, opts.cylRadius,
                                        rotation, color, color, objId, objId);
      });
      const vertEnd = va.numVerts();
      vertAssoc.addAssoc(atom as never, va as never, vertStart, vertEnd);
    });
  };
})();

exports.ballsAndSticks = function(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions) {
  console.time('ballsAndSticks');
  const vertAssoc = new AtomVertexAssoc(structure as never, true);
  const protoSphere = new ProtoSphere(opts.sphereDetail, opts.sphereDetail);
  const protoCyl = new ProtoCylinder(opts.arcDetail);
  opts.protoSphere = protoSphere;
  opts.protoCyl = protoCyl;
  const meshGeom = new MeshGeomCtor(gl, opts.float32Allocator,
                              opts.uint16Allocator);
  meshGeom.addVertAssoc(vertAssoc as never);
  meshGeom.setShowRelated(opts.showRelated);
  opts.color.begin(structure as never);
  structure.eachChain(function(chain) {
    ballsAndSticksForChain(meshGeom, vertAssoc, opts, chain);
  });
  opts.color.end();
  console.timeEnd('ballsAndSticks');
  return meshGeom;
};

const pointsForChain = (function () {
  const clr = vec4.fromValues(0.0, 0.0, 0.0, 1.0);
  return function(lineGeom: LineGeom, vertAssoc: InstanceType<typeof AtomVertexAssoc>,
                  chain: RenderChain, opts: RenderOptions) {
    const atomCount = chain.atomCount();
    const idRange = opts.idPool.getContinuousRange(atomCount)!;
    lineGeom.addIdRange(idRange);
    const va = lineGeom.addChainVertArray(chain as never, atomCount) as unknown as {
      numVerts(): number; setDrawAsPoints(v: boolean): void; addPoint(p: vec3, c: vec4, id: number): void;
    };
    va.setDrawAsPoints(true);
    chain.eachAtom(function(atom) {
      const vertStart = va.numVerts();
      opts.color.colorFor(atom as never, clr as Float32Array, 0);
      const objId = idRange.nextId({ geom : lineGeom, atom: atom });
      va.addPoint(atom.pos(), clr, objId);
      const vertEnd = va.numVerts();
      vertAssoc.addAssoc(atom as never, va as never, vertStart, vertEnd);
    });
  };
})();


exports.points = function(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions) {
  console.time('points');
  const vertAssoc = new AtomVertexAssoc(structure as never, true);
  opts.color.begin(structure as never);
  const lineGeom = new LineGeomCtor(gl, opts.float32Allocator);
  lineGeom.setPointSize(opts.pointSize);
  lineGeom.addVertAssoc(vertAssoc as never);
  lineGeom.setShowRelated(opts.showRelated);
  structure.eachChain(function(chain) {
    pointsForChain(lineGeom, vertAssoc, chain, opts);
  });
  opts.color.end();
  console.timeEnd('points');
  return lineGeom;
};

const linesForChain = (function () {
  const mp = vec3.create();
  const clr = vec4.fromValues(0.0, 0.0, 0.0, 1.0);
  return function(lineGeom: LineGeom, vertAssoc: InstanceType<typeof AtomVertexAssoc>,
                  chain: RenderChain, opts: RenderOptions) {
    let lineCount = 0;
    const atomCount = chain.atomCount();
    const idRange = opts.idPool.getContinuousRange(atomCount)!;
    lineGeom.addIdRange(idRange);
    // determine number of required lines to draw the full structure
    chain.eachAtom(function(atom) {
      const numBonds = atom.bonds().length;
      if (numBonds) {
        lineCount += numBonds;
      } else {
        lineCount += 3;
      }
    });
    const va = lineGeom.addChainVertArray(chain as never, lineCount * 2);
    chain.eachAtom(function(atom) {
      // for atoms without bonds, we draw a small cross, otherwise these atoms
      // would be invisible on the screen.
      const vertStart = va.numVerts();
      const objId = idRange.nextId({ geom : lineGeom, atom: atom });
      if (atom.bonds().length) {
        atom.eachBond(function(bond) {
          bond.mid_point(mp);
          opts.color.colorFor(atom as never, clr as Float32Array, 0);
          va.addLine(atom.pos(), clr, mp, clr, objId, objId);
        });
      } else {
        const cs = 0.2;
        const pos = atom.pos();
        opts.color.colorFor(atom as never, clr as Float32Array, 0);
        va.addLine([ pos[0] - cs, pos[1], pos[2] ], clr,
                   [ pos[0] + cs, pos[1], pos[2] ], clr, objId, objId);
        va.addLine([ pos[0], pos[1] - cs, pos[2] ], clr,
                   [ pos[0], pos[1] + cs, pos[2] ], clr, objId, objId);
        va.addLine([ pos[0], pos[1], pos[2] - cs ], clr,
                   [ pos[0], pos[1], pos[2] + cs ], clr, objId, objId);
      }
      const vertEnd = va.numVerts();
      vertAssoc.addAssoc(atom as never, va as never, vertStart, vertEnd);
    });

  };
})();


exports.lines = function(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions) {
  console.time('lines');
  const vertAssoc = new AtomVertexAssoc(structure as never, true);
  opts.color.begin(structure as never);
  const lineGeom = new LineGeomCtor(gl, opts.float32Allocator);
  lineGeom.setLineWidth(opts.lineWidth);
  lineGeom.addVertAssoc(vertAssoc as never);
  lineGeom.setShowRelated(opts.showRelated);
  structure.eachChain(function(chain) {
    linesForChain(lineGeom, vertAssoc, chain, opts);
  });
  opts.color.end();
  console.timeEnd('lines');
  return lineGeom;
};

const _lineTraceNumVerts = function(traces: RenderTrace[]) {
  let numVerts = 0;
  for (let i = 0; i < traces.length; ++i) {
    numVerts += 2 * (traces[i]!.length() - 1);
  }
  return numVerts;
};

const makeLineTrace = (function() {
  const colorOne = vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      colorTwo = vec4.fromValues(0.0, 0.0, 0.0, 1.0);
  const posOne = vec3.create(), posTwo = vec3.create();

  return function makeLineTrace(
    lineGeom: LineGeom, vertAssoc: InstanceType<typeof TraceVertexAssoc>,
    va: ReturnType<LineGeom['addChainVertArray']>, traceIndex: number,
    trace: RenderTrace, opts: RenderOptions,
  ) {
    vertAssoc.addAssoc(traceIndex, va as never, 0, va.numVerts(),
                        va.numVerts() + 1);

    const colors = opts.float32Allocator.request(trace.length() * 4);
    const idRange = opts.idPool.getContinuousRange(trace.length())!;
    lineGeom.addIdRange(idRange);
    let idOne = idRange.nextId({ geom: lineGeom,
                                 atom : trace.centralAtomAt(0),
                                 isTrace : true });
    let idTwo;
    for (let i = 1; i < trace.length(); ++i) {

      opts.color.colorFor(trace.centralAtomAt(i - 1) as never, colorOne as Float32Array, 0);
      colors[(i - 1) * 4 + 0] = colorOne[0];
      colors[(i - 1) * 4 + 1] = colorOne[1];
      colors[(i - 1) * 4 + 2] = colorOne[2];
      colors[(i - 1) * 4 + 3] = colorOne[3];
      opts.color.colorFor(trace.centralAtomAt(i) as never, colorTwo as Float32Array, 0);
      trace.posAt(posOne, i - 1);
      trace.posAt(posTwo, i);
      idTwo = idRange.nextId({
        geom: lineGeom, atom : trace.centralAtomAt(i), isTrace : true});
      va.addLine(posOne, colorOne, posTwo, colorTwo, idOne, idTwo);
      idOne = idTwo;
      idTwo = null as unknown as number;
      const vertEnd = va.numVerts();
      vertAssoc.addAssoc(traceIndex, va as never, i, vertEnd - 1,
                          vertEnd + ((i === trace.length() - 1) ? 0 : 1));
    }
    colors[trace.length() * 4 - 4] = colorTwo[0];
    colors[trace.length() * 4 - 3] = colorTwo[1];
    colors[trace.length() * 4 - 2] = colorTwo[2];
    colors[trace.length() * 4 - 1] = colorTwo[3];
    vertAssoc.setPerResidueColors(traceIndex, colors);
    return traceIndex + 1;
  };
})();

const lineTraceForChain = function(lineGeom: LineGeom, vertAssoc: InstanceType<typeof TraceVertexAssoc>,
                                 opts: RenderOptions, traceIndex: number,
                                 chain: RenderChain) {
  const backboneTraces =  chain.backboneTraces();
  const numVerts = _lineTraceNumVerts(backboneTraces);
  const va = lineGeom.addChainVertArray(chain as never, numVerts);
  for (let i = 0; i < backboneTraces.length; ++i) {
    traceIndex = makeLineTrace(lineGeom, vertAssoc, va, traceIndex,
                               backboneTraces[i]!, opts);
  }
  return traceIndex;


};
//--------------------------------------------------------------------------
// Some thoughts on trace-based render styles
//
//  * Backbone traces must be determined from the complete structure (Chain
//    as opposed to ChainView).
//
//  * For subsets, the trace must start midway between the residue before
//    the visible part, and end midway after the last visible residue.
//
//  * Curvature of trace subsets must be based on the full backbone trace.
//--------------------------------------------------------------------------
exports.lineTrace = function(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions) {


  console.time('lineTrace');
  const vertAssoc = new TraceVertexAssoc(structure as never, 1, true);
  opts.color.begin(structure as never);
  const lineGeom = new LineGeomCtor(gl, opts.float32Allocator);
  lineGeom.setLineWidth(opts.lineWidth);
  let traceIndex = 0;
  structure.eachChain(function(chain) {
    traceIndex = lineTraceForChain(lineGeom, vertAssoc, opts,
                                   traceIndex, chain);
  });
  lineGeom.addVertAssoc(vertAssoc as never);
  lineGeom.setShowRelated(opts.showRelated);
  opts.color.end();
  console.timeEnd('lineTrace');
  return lineGeom;
};

const _slineNumVerts = function(traces: RenderTrace[], splineDetail: number) {
  let numVerts = 0;
  for (let i = 0; i < traces.length; ++i) {
    numVerts += 2 * (splineDetail * (traces[i]!.length() - 1) + 1);
  }
  return numVerts;
};

const slineMakeTrace = (function() {
  const posOne = vec3.create(), posTwo = vec3.create();
  const colorOne = vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      colorTwo = vec4.fromValues(0.0, 0.0, 0.0, 1.0);
  return function(
    lineGeom: LineGeom, vertAssoc: InstanceType<typeof TraceVertexAssoc>,
    va: ReturnType<LineGeom['addChainVertArray']>, opts: RenderOptions,
    traceIndex: number, trace: RenderTrace,
  ) {
    const firstSlice = trace.fullTraceIndex(0);
    const positions = opts.float32Allocator.request(trace.length() * 3);
    const colors = opts.float32Allocator.request(trace.length() * 4);
    const objIds: number[] = [];
    let i;
    const idRange = opts.idPool.getContinuousRange(trace.length())!;
    lineGeom.addIdRange(idRange);
    for (i = 0; i < trace.length(); ++i) {
      const atom = trace.centralAtomAt(i);
      trace.smoothPosAt(posOne, i, opts.strength);
      opts.color.colorFor(atom as never, colors, 4 * i);
      positions[i * 3] = posOne[0];
      positions[i * 3 + 1] = posOne[1];
      positions[i * 3 + 2] = posOne[2];
      objIds.push(idRange.nextId({ geom : lineGeom, atom : atom,
                                   isTrace : true }));
    }
    let idStart = objIds[0]!, idEnd = 0;
    const sdiv = geom.catmullRomSpline(positions, trace.length(),
                                     opts.splineDetail, opts.strength,
                                     false, opts.float32Allocator);
    const interpColors = interpolateColor(colors, opts.splineDetail);
    const vertStart = va.numVerts();
    vertAssoc.addAssoc(traceIndex, va as never, firstSlice, vertStart, vertStart + 1);
    const halfSplineDetail = Math.floor(opts.splineDetail / 2);
    const steps = geom.catmullRomSplineNumPoints(trace.length(),
                                               opts.splineDetail, false);
    for (i = 1; i < steps; ++i) {
      posOne[0] = sdiv[3 * (i - 1)]!;
      posOne[1] = sdiv[3 * (i - 1) + 1]!;
      posOne[2] = sdiv[3 * (i - 1) + 2]!;
      posTwo[0] = sdiv[3 * (i - 0)]!;
      posTwo[1] = sdiv[3 * (i - 0) + 1]!;
      posTwo[2] = sdiv[3 * (i - 0) + 2]!;

      colorOne[0] = interpColors[4 * (i - 1) + 0]!;
      colorOne[1] = interpColors[4 * (i - 1) + 1]!;
      colorOne[2] = interpColors[4 * (i - 1) + 2]!;
      colorOne[3] = interpColors[4 * (i - 1) + 3]!;

      colorTwo[0] = interpColors[4 * (i - 0) + 0]!;
      colorTwo[1] = interpColors[4 * (i - 0) + 1]!;
      colorTwo[2] = interpColors[4 * (i - 0) + 2]!;
      colorTwo[3] = interpColors[4 * (i - 0) + 3]!;
      const index = Math.floor((i + halfSplineDetail) / opts.splineDetail);
      idEnd = objIds[Math.min(objIds.length - 1, index)]!;
      va.addLine(posOne, colorOne, posTwo, colorTwo, idStart, idEnd);
      idStart = idEnd;
      const vertEnd = va.numVerts();
      vertAssoc.addAssoc(traceIndex, va as never, firstSlice + i, vertEnd - 1,
                         vertEnd + ((i === (trace.length as unknown as number) - 1) ? 0 : 1));
    }
    vertAssoc.setPerResidueColors(traceIndex, colors);
    opts.float32Allocator.release(positions);
    opts.float32Allocator.release(sdiv);
    return traceIndex + 1;
  };
})();

const slineForChain = function(lineGeom: LineGeom, vertAssoc: InstanceType<typeof TraceVertexAssoc>,
                             opts: RenderOptions, chain: RenderChain, traceIndex: number) {
  const backboneTraces = chain.backboneTraces();
  const numVerts = _slineNumVerts(backboneTraces, opts.splineDetail);
  const va = lineGeom.addChainVertArray(chain as never, numVerts);
  for (let i = 0; i < backboneTraces.length; ++i) {
    traceIndex = slineMakeTrace(lineGeom, vertAssoc, va, opts,
                                traceIndex, backboneTraces[i]!);
  }
  return traceIndex;
};

exports.sline = function(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions) {
  console.time('sline');
  opts.color.begin(structure as never);
  const vertAssoc =
      new TraceVertexAssoc(structure as never, opts.splineDetail, true);
  const lineGeom = new LineGeomCtor(gl, opts.float32Allocator);
  lineGeom.addVertAssoc(vertAssoc as never);
  lineGeom.setLineWidth(opts.lineWidth);
  lineGeom.setShowRelated(opts.showRelated);
  let traceIndex = 0;
  structure.eachChain(function(chain) {
    traceIndex = slineForChain(lineGeom, vertAssoc, opts, chain, traceIndex);
  });
  opts.color.end();
  console.timeEnd('sline');
  return lineGeom;
};

const _traceNumVerts = function(traces: RenderTrace[], sphereNumVerts: number, cylNumVerts: number) {
  let numVerts = 0;
  for (let i = 0; i < traces.length; ++i) {
    numVerts += traces[i]!.length() * sphereNumVerts;
    numVerts += (traces[i]!.length() - 1) * cylNumVerts;
  }
  return numVerts;
};

const _traceNumIndices = function(traces: RenderTrace[], sphereNumIndices: number, cylNumIndices: number) {
  let numIndices = 0;
  for (let i = 0; i < traces.length; ++i) {
    numIndices += traces[i]!.length() * sphereNumIndices;
    numIndices += (traces[i]!.length() - 1) * cylNumIndices;
  }
  return numIndices;
};

const traceForChain = function(meshGeom: MeshGeom, vertAssoc: InstanceType<typeof TraceVertexAssoc>,
                             opts: RenderOptions, traceIndex: number, chain: RenderChain) {
  // determine number of verts required to render the traces
  const traces = chain.backboneTraces();
  const numVerts = _traceNumVerts(traces, opts.protoSphere.numVerts(),
                                opts.protoCyl.numVerts());
  const numIndices = _traceNumIndices(traces, opts.protoSphere.numIndices(),
                                    opts.protoCyl.numIndices());
  meshGeom.addChainVertArray(chain as never, numVerts, numIndices);
  for (let ti = 0; ti < traces.length; ++ti) {
    _renderSingleTrace(meshGeom, vertAssoc, traces[ti]!, traceIndex, opts);
    traceIndex++;
  }
  return traceIndex;
};

exports.trace = function(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions) {
  console.time('trace');

  opts.protoCyl = new ProtoCylinder(opts.arcDetail);
  opts.protoSphere =
      new ProtoSphere(opts.sphereDetail, opts.sphereDetail);

  const meshGeom = new MeshGeomCtor(gl, opts.float32Allocator,
                              opts.uint16Allocator);
  const vertAssoc = new TraceVertexAssoc(structure as never, 1, true);
  meshGeom.addVertAssoc(vertAssoc as never);
  meshGeom.setShowRelated(opts.showRelated);

  opts.color.begin(structure as never);
  let traceIndex = 0;
  structure.eachChain(function(chain) {
    traceIndex = traceForChain(meshGeom, vertAssoc, opts, traceIndex, chain);
  });
  opts.color.end();

  console.timeEnd('trace');
  return meshGeom;
};

// calculates the number of vertices required for the cartoon and
// tube render styles
const _cartoonNumVerts = function(traces: RenderTrace[], vertsPerSlice: number, splineDetail: number) {
  let numVerts = 0;
  for (let i = 0; i < traces.length; ++i) {
    const traceVerts =
      ((traces[i]!.length() - 1) * splineDetail + 1) * vertsPerSlice;
    // in case there are more than 2^16 vertices for a single trace, we
    // need to manually split the trace in two and duplicate one of the
    // trace slices. Let's make room for some additional space...
    const splits = Math.ceil((traceVerts + 2)/65536);
    numVerts += traceVerts + (splits - 1) * vertsPerSlice;
    // triangles for capping the tube
    numVerts += 2;
  }
  return numVerts;
};

const _cartoonNumIndices = function(traces: RenderTrace[], vertsPerSlice: number, splineDetail: number) {
  let numIndices = 0;
  for (let i = 0; i < traces.length; ++i) {
    numIndices += (traces[i]!.length() * splineDetail - 1) * vertsPerSlice * 6;
    // triangles for capping the tube
    numIndices += 2 * 3 * vertsPerSlice;
  }
  return numIndices;
};

// creates the capped cylinders for DNA/RNA pointing towards the end of the
// bases.
const _addNucleotideSticks = (function() {
  const rotation = mat3.create();
  const up = vec3.create(), left = vec3.create(), dir = vec3.create();
  const center = vec3.create();
  const color = vec4.create();
  return function(meshGeom: MeshGeom, vertAssoc: InstanceType<typeof AtomVertexAssoc>,
                  traces: RenderTrace[], opts: RenderOptions) {
    const radius = opts.radius * 1.8;
    const vertsPerNucleotideStick = opts.protoCyl.numVerts() +
       2 * opts.protoSphere.numVerts();
    for (let i = 0; i < traces.length; ++i) {
      const trace = traces[i]!;
      const idRange = opts.idPool.getContinuousRange(trace.length())!;
      meshGeom.addIdRange(idRange);
      for (let j = 0; j <  trace.length(); ++j) {
        const va = meshGeom.vertArrayWithSpaceFor(vertsPerNucleotideStick);
        const vertStart = va.numVerts();
        const residue = trace.residueAt(j);
        const resName = residue.name();
        const startAtom = residue.atom('C3\'');
        let endAtom = null;
        if (resName === 'A' || resName === 'G' ||
            resName === 'DA' || resName === 'DG') {
          endAtom = residue.atom('N1');
        } else {
          endAtom = residue.atom('N3');
        }
        if (endAtom === null || startAtom === null) {
          continue;
        }
        const objId = idRange.nextId({ geom: meshGeom, atom :
                                     endAtom, isTrace : true });
        vec3.add(center, startAtom.pos(), endAtom.pos());
        vec3.scale(center, center, 0.5);

        opts.color.colorFor(endAtom as never, color as Float32Array, 0);
        vec3.sub(dir, endAtom.pos(), startAtom.pos());
        const length = vec3.length(dir);
        vec3.scale(dir, dir, 1.0/length);
        geom.buildRotation(rotation, dir, left, up, false);

        opts.protoCyl.addTransformed(va as never, center, length, radius,
                                     rotation, color, color, objId, objId);
        opts.protoSphere.addTransformed(va as never, endAtom.pos(), radius,
                                        color, objId);
        opts.protoSphere.addTransformed(va as never, startAtom.pos(), radius,
                                        color, objId);
        const vertEnd = va.numVerts();
        console.assert(vertEnd <= 65536, 'too many vertices');
        vertAssoc.addAssoc(endAtom as never, va as never, vertStart, vertEnd);
      }
    }
  };
})();

// generates the mesh geometry for displaying a single chain as either cartoon
// or tube (opts.forceTube === true).
const cartoonForChain = function(
  meshGeom: MeshGeom, vertAssoc: InstanceType<typeof TraceVertexAssoc>,
  nucleotideAssoc: InstanceType<typeof AtomVertexAssoc>, opts: RenderOptions,
  traceIndex: number, chain: RenderChain,
) {
  const traces = chain.backboneTraces();
  let numVerts = _cartoonNumVerts(traces, opts.arcDetail * 4,
                                  opts.splineDetail);
  let numIndices = _cartoonNumIndices(traces, opts.arcDetail * 4,
                                      opts.splineDetail);
  // figure out which of the traces consist of nucleic acids. They require
  // additional space for rendering the sticks.
  const nucleicAcidTraces: RenderTrace[] = [];
  const vertForBaseSticks = opts.protoCyl.numVerts() +
    2 * opts.protoSphere.numVerts();
  const indicesForBaseSticks = opts.protoCyl.numIndices() +
    2 * opts.protoSphere.numIndices();
  for (let i = 0; i < traces.length; ++i) {
    const trace = traces[i]!;
    if (trace.residueAt(0).isNucleotide()) {
      nucleicAcidTraces.push(trace);
      // each DNA/RNA base gets a double-capped cylinder
      numVerts += trace.length() * vertForBaseSticks;
      numIndices += trace.length() * indicesForBaseSticks;
    }
  }
  meshGeom.addChainVertArray(chain as never, numVerts, numIndices);
  for (let ti = 0; ti < traces.length; ++ti) {
    traceIndex = _cartoonForSingleTrace(meshGeom, vertAssoc, traces[ti]!,
                                        traceIndex, opts);
  }
  _addNucleotideSticks(meshGeom, nucleotideAssoc, nucleicAcidTraces, opts);
  return traceIndex;
};

exports.cartoon = function(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions) {
  console.time('cartoon');
  opts.arrowSkip = Math.floor(opts.splineDetail * 3 / 4);
  opts.coilProfile = new TubeProfile(COIL_POINTS, opts.arcDetail, 1.0);
  opts.arrowProfile = new TubeProfile(ARROW_POINTS, opts.arcDetail/2, 0.1);
  opts.helixProfile = new TubeProfile(HELIX_POINTS, opts.arcDetail/2, 0.1);
  opts.strandProfile = new TubeProfile(HELIX_POINTS, opts.arcDetail/2, 0.1);
  opts.protoCyl = new ProtoCylinder(opts.arcDetail * 4);
  opts.protoSphere = new ProtoSphere(opts.arcDetail * 4,
                                        opts.arcDetail * 4);

  const meshGeom = new MeshGeomCtor(gl, opts.float32Allocator,
                              opts.uint16Allocator);
  const vertAssoc = new TraceVertexAssoc(structure as never, opts.splineDetail, true);
  meshGeom.addVertAssoc(vertAssoc as never);
  meshGeom.setShowRelated(opts.showRelated);

  opts.color.begin(structure as never);

  let traceIndex = 0;
  // the following vert-assoc is for rendering of DNA/RNA. Create vertex assoc
  // from N1/N3 atoms only, this will speed up recoloring later on, which when
  // performed on the complete structure, is slower than recalculating the
  // whole geometry.
  const selection = structure.select({anames: ['N1', 'N3']});
  const nucleotideAssoc = new AtomVertexAssoc(selection as never, true);
  meshGeom.addVertAssoc(nucleotideAssoc as never);
  structure.eachChain(function(chain) {
    traceIndex = cartoonForChain(meshGeom, vertAssoc, nucleotideAssoc, opts,
                                 traceIndex, chain);
  });

  opts.color.end();
  console.timeEnd('cartoon');
  return meshGeom;
};

exports.surface = (function() {
  const pos = vec3.create(), normal = vec3.create(),
      color = vec4.fromValues(0.8, 0.8, 0.8, 1.0);
  return function(data: DataView, gl: WebGL2RenderingContext, opts: RenderOptions) {
    let offset = 0;
    /*var version = */data.getUint32(0);
    offset += 4;
    const numVerts = data.getUint32(offset);
    offset += 4;
    const vertexStride = 4 * 6;
    const facesDataStart = vertexStride * numVerts + offset;
    const numFaces = data.getUint32(facesDataStart);
    const meshGeom = new MeshGeomCtor(gl, opts.float32Allocator,
                                opts.uint16Allocator);
    meshGeom.setShowRelated('asym');
    const va = meshGeom.addVertArray(numVerts, numFaces * 3);
    let i;
    for (i = 0 ; i < numVerts; ++i) {
      vec3.set(pos, data.getFloat32(offset + 0), data.getFloat32(offset + 4),
               data.getFloat32(offset + 8));
      offset += 12;
      vec3.set(normal, data.getFloat32(offset + 0), data.getFloat32(offset + 4),
               data.getFloat32(offset + 8));
      offset += 12;
      va.addVertex(pos, normal, color, 0);
    }
    offset = facesDataStart + 4;
    for (i = 0 ; i < numFaces; ++i) {
      const idx0 = data.getUint32(offset + 0),
          idx1 = data.getUint32(offset + 4),
          idx2 = data.getUint32(offset + 8);
      offset += 12;
      va.addTriangle(idx0 - 1, idx2 -1, idx1 - 1);
    }
    return meshGeom;
  };
})();

const _cartoonAddTube = (function() {
  const rotation = mat3.create();
  const up = vec3.create();

  return function(
    vertArray: ReturnType<MeshGeom['vertArrayWithSpaceFor']>, pos: vec3, left: vec3,
    ss: string, tangent: vec3, color: vec4, radius: number, first: boolean,
    opts: RenderOptions, offset: number, objId: number,
  ) {
    let prof = opts.coilProfile;
    if (ss !== 'C' && !opts.forceTube) {
      if (ss === 'H') {
        prof = opts.helixProfile;
      } else if (ss === 'E') {
        prof = opts.strandProfile;
      } else if (ss === 'A') {
        prof = opts.arrowProfile;
      } 
    } else {
      if (first) {
        geom.ortho(left, tangent);
      } else {
        vec3.cross(left, up, tangent);
      }
    }

    geom.buildRotation(rotation, tangent, left, up, true);
    prof.addTransformed(vertArray, pos, radius, rotation, color, first,
                        offset, objId);
  };
})();

// INTERNAL: fills positions, normals and colors from the information found in
// trace. The 3 arrays must already have the correct size (3*trace.length).
const _colorPosNormalsFromTrace = (function() {
  const pos = vec3.create();
  const normal = vec3.create(), lastNormal = vec3.create();

  return function(
    meshGeom: MeshGeom, trace: RenderTrace, colors: Float32Array, positions: Float32Array,
    normals: Float32Array, objIds: number[], pool: ContinuousIdRange<ObjIdData>,
    opts: RenderOptions,
  ) {
    let strandStart: number | null = null, strandEnd: number | null = null;
    const trace_length = trace.length();
    vec3.set(lastNormal, 0.0, 0.0, 0.0);
    for (let i = 0; i < trace_length; ++i) {
      objIds.push(pool.nextId({ geom : meshGeom,
                                atom : trace.centralAtomAt(i),
                                isTrace : true }));
      trace.smoothPosAt(pos, i, opts.strength);
      positions[i * 3] = pos[0];
      positions[i * 3 + 1] = pos[1];
      positions[i * 3 + 2] = pos[2];

      trace.smoothNormalAt(normal, i, opts.strength);

      const atom = trace.centralAtomAt(i);
      opts.color.colorFor(atom as never, colors, i * 4);

      if (vec3.dot(normal, lastNormal) < 0) {
        vec3.scale(normal, normal, -1);
      }
      if (trace.residueAt(i).ss() === 'E' &&
          !opts.forceTube && opts.smoothStrands) {
        if (strandStart === null) {
          strandStart = i;
        }
        strandEnd = i;
      }
      if (trace.residueAt(i).ss() === 'C' && strandStart !== null) {
        smoothStrandInplace(positions, strandStart, strandEnd!, trace_length);
        smoothStrandInplace(normals, strandStart, strandEnd!, trace_length);
        strandStart = null;
        strandEnd = null;
      }
      normals[i * 3] = positions[3 * i]! + normal[0] + lastNormal[0];
      normals[i * 3 + 1] = positions[3 * i + 1]! + normal[1] + lastNormal[1];
      normals[i * 3 + 2] = positions[3 * i + 2]! + normal[2] + lastNormal[2];
      vec3.copy(lastNormal, normal);
    }
  };
})();


function capTubeStart(va: ReturnType<MeshGeom['vertArrayWithSpaceFor']>, baseIndex: number, numTubeVerts: number) {
  for (let i = 0; i < numTubeVerts - 1; ++i) {
    va.addTriangle(baseIndex, baseIndex + 1 + i, baseIndex + 2 + i);
  }
  va.addTriangle(baseIndex, baseIndex + numTubeVerts, baseIndex + 1);
}

function capTubeEnd(va: ReturnType<MeshGeom['vertArrayWithSpaceFor']>, baseIndex: number, numTubeVerts: number) {
  const center = baseIndex + numTubeVerts;
  for (let i = 0; i < numTubeVerts - 1; ++i) {
    va.addTriangle(center, baseIndex + i + 1, baseIndex + i);
  }
  va.addTriangle(center, baseIndex, baseIndex + numTubeVerts - 1);
}


// constructs a cartoon representation for a single consecutive backbone
// trace.
// Referenced by cartoonForChain above, before this binding is assigned;
// using let/const would make that a TDZ reference error.
// eslint-disable-next-line no-var
var _cartoonForSingleTrace = (function() {

  const tangent = vec3.create(), pos = vec3.create(),
      color = vec4.fromValues(0.0, 0.0, 0.0, 1.0),
      normal = vec3.create(), normal2 = vec3.create();
  return function(
    meshGeom: MeshGeom, vertAssoc: InstanceType<typeof TraceVertexAssoc>, trace: RenderTrace,
    traceIndex: number, opts: RenderOptions,
  ): number {
    const numVerts =
        _cartoonNumVerts([trace], opts.arcDetail * 4, opts.splineDetail);
    const positions = opts.float32Allocator.request(trace.length() * 3);
    const colors = opts.float32Allocator.request(trace.length() * 4);
    const normals = opts.float32Allocator.request(trace.length() * 3);

    const objIds: number[] = [];
    const idRange = opts.idPool.getContinuousRange(trace.length())!;
    meshGeom.addIdRange(idRange);
    _colorPosNormalsFromTrace(meshGeom, trace, colors, positions, normals, 
                              objIds, idRange, opts);
    let vertArray = meshGeom.vertArrayWithSpaceFor(numVerts);
    const sdiv = geom.catmullRomSpline(positions, trace.length(),
                                      opts.splineDetail, opts.strength,
                                      false, opts.float32Allocator);
    const normalSdiv = geom.catmullRomSpline(
        normals, trace.length(), opts.splineDetail, opts.strength, false,
        opts.float32Allocator);
    vertAssoc.setPerResidueColors(traceIndex, colors);
    const radius = 
      opts.radius * (trace.residueAt(0).isAminoacid() ? 1.0 : 1.8);
    const interpColors = interpolateColor(colors, opts.splineDetail);
    // handle start of trace. this could be moved inside the for-loop, but
    // at the expense of a conditional inside the loop. unrolling is
    // slightly faster.
    //
    // we repeat the following steps for the start, central section and end
    // of the profile: (a) assign position, normal, tangent and color, (b)
    // add tube (or rectangular profile for helices and strands).
    vec3.set(tangent, sdiv[3]! - sdiv[0]!, sdiv[4]! - sdiv[1]!, sdiv[5]! - sdiv[2]!);
    vec3.set(pos, sdiv[0]!, sdiv[1]!, sdiv[2]!);
    vec3.set(normal, normalSdiv[0]! - sdiv[0]!, normalSdiv[1]! - sdiv[1]!,
              normalSdiv[2]! - sdiv[2]!);
    vec3.normalize(tangent, tangent);
    vec3.normalize(normal, normal);
    vec4.set(color, interpColors[0]!, interpColors[1]!, interpColors[2]!,
             interpColors[3]! );

    let vertStart = vertArray.numVerts();
    vertArray.addVertex(pos, [-tangent[0], -tangent[1], -tangent[2]],
                        color, objIds[0]!);

    const currentSS = trace.residueAt(0).ss();
    _cartoonAddTube(vertArray, pos, normal, currentSS, tangent,
                    color, radius, true, opts, 0, objIds[0]!);
    capTubeStart(vertArray, vertStart, opts.arcDetail * 4);
    let vertEnd = vertArray.numVerts();
    let slice = 0;
    vertAssoc.addAssoc(traceIndex, vertArray as never, slice, vertStart, vertEnd);
    slice += 1;
    const halfSplineDetail = Math.floor(opts.splineDetail / 2);

    // handle the bulk of the trace
    const steps = geom.catmullRomSplineNumPoints(trace.length(),
                                                opts.splineDetail, false);

    const vertsPerSlice = opts.arcDetail * 4;
    for (let i = 1, e = steps; i < e; ++i) {
      // compute 3*i, 3*(i-1), 3*(i+1) once and reuse
      const ix3 = 3 * i, ix4 = 4 * i,  ipox3 = 3 * (i + 1), imox3 = 3 * (i - 1);

      vec3.set(pos, sdiv[ix3]!, sdiv[ix3 + 1]!, sdiv[ix3 + 2]!);

      if (i === e -1) {
        vec3.set(tangent, sdiv[ix3]! - sdiv[imox3]!,
                 sdiv[ix3 + 1]! - sdiv[imox3 + 1]!,
                 sdiv[ix3 + 2]! - sdiv[imox3 + 2]!);
      } else {
        vec3.set(tangent, sdiv[ipox3]! - sdiv[imox3]!,
                 sdiv[ipox3 + 1]! - sdiv[imox3 + 1]!,
                 sdiv[ipox3 + 2]! - sdiv[imox3 + 2]!);
      }
      vec3.normalize(tangent, tangent);
      vec4.set(color, interpColors[ix4]!, interpColors[ix4 + 1]!,
               interpColors[ix4 + 2]!, interpColors[ix4 + 3]!);

      let offset = 0; // <- set special handling of coil to helix,strand
                      //    transitions.
      const iCentered = i + opts.splineDetail / 2;
      const residueIndex = Math.floor(iCentered / opts.splineDetail);
      const prevResidueIndex = Math.floor((iCentered - 1) / opts.splineDetail);

      // used to determine whether we have to add an arrow profile. when the 
      // current residue is the last strand residue, the arrow tip has to land 
      // exactly on the first slice of the next residue. Because we would like 
      // to have larger arrows we use multiple slices for the arrow (set to 
      // 3/4 of splineDetail).
      const arrowEndIndex = 
        Math.floor((iCentered + opts.arrowSkip) / opts.splineDetail);
      let drawArrow = false;
      const thisSS = trace.residueAt(residueIndex).ss();
      if (!opts.forceTube) {
        if (residueIndex !== prevResidueIndex) {
          // for helix and strand regions, we can't base the left vector
          // of the current residue on the previous one, since it determines
          // the orientation of the strand and helix profiles.
          //
          // frequently, the transition regions from coil to strand and helix
          // contain strong twists which severely hamper visual quality. there
          // is not problem however when transitioning from helix or strand
          // to coil or inside a helix or strand.
          //
          // to avoid these visual artifacts, we calculate the best fit between
          // the current normal and the normal "after" which gives us an offset
          // for stitching the two parts together.
          const prevSS = trace.residueAt(prevResidueIndex).ss();
          if (prevSS === 'C' && (thisSS === 'H' || thisSS === 'E')) {
            // we don't want to generate holes, so we have to make sure
            // the vertices of the rotated profile align with the previous
            // profile.
            vec3.set(normal2, normalSdiv[imox3]! - sdiv[imox3]!,
                     normalSdiv[imox3 + 1]! - sdiv[imox3 + 1]!,
                     normalSdiv[imox3 + 2]! - sdiv[imox3 + 2]!);
            vec3.normalize(normal2, normal2);
            const argAngle = 2 * Math.PI / (opts.arcDetail * 4);
            const signedAngle = geom.signedAngle(normal, normal2, tangent);
            offset = Math.round(signedAngle / argAngle);
            offset = (offset + opts.arcDetail * 4) % (opts.arcDetail * 4);
          }
        }
        // figure out if we have to draw an arrow head
        if (arrowEndIndex !== residueIndex && arrowEndIndex < trace.length()) {
          const nextSS = trace.residueAt(arrowEndIndex).ss();
          if (nextSS === 'C' && thisSS === 'E') {
            drawArrow = true;
          }
        }
      }
      // only set normal *after* handling the coil -> helix,strand
      // transition, since we depend on the normal of the previous step.
      vec3.set(normal, normalSdiv[3 * i]! - sdiv[ix3]!,
               normalSdiv[ix3 + 1]! - sdiv[ix3 + 1]!,
               normalSdiv[ix3 + 2]! - sdiv[ix3 + 2]!);
      vec3.normalize(normal, normal);
      vertStart = vertArray.numVerts();
      const objIndex = Math.floor((i + halfSplineDetail) / opts.splineDetail);
      const objId = objIds[Math.min(objIds.length - 1, objIndex)]!;
      _cartoonAddTube(vertArray, pos, normal, thisSS,
                      tangent, color, radius, false, opts, offset, objId);
      // in case we are running out of indices, start new vertex array and 
      // duplicate last slice. If we are on the last slice, we only need one 
      // additional vertex for the capping, otherwise we need a full slice 
      // worth of vertices.
      const additionalVerts = (i === e - 1) ? 1 : vertsPerSlice;
      if (vertArray.numVerts() + additionalVerts > vertArray.maxVerts()) {
        vertEnd = vertArray.numVerts();
        vertAssoc.addAssoc(traceIndex, vertArray as never, slice, vertStart, vertEnd);
        vertArray = meshGeom.vertArrayWithSpaceFor(additionalVerts);
        vertStart = 0;
        _cartoonAddTube(vertArray, pos, normal, thisSS,
                        tangent, color, radius, true, opts, 0, objId);
      }
      if (drawArrow) {
        vertAssoc.addAssoc(traceIndex, vertArray as never, slice, vertStart, vertEnd);
        // FIXME: arrow has completely wrong normals. Profile normals are 
        // generate perpendicular to the direction of the tube. The arrow 
        // normals are anti-parallel to the direction of the tube.
        _cartoonAddTube(vertArray, pos, normal, 'A', 
                        tangent, color, radius, false, opts, 0, objId);
        // We skip a few profiles to get a larger arrow.
        i += opts.arrowSkip;
      }
      vertEnd = vertArray.numVerts();
      if (i === e -1) {
        vertEnd += 1;
      }
      vertAssoc.addAssoc(traceIndex, vertArray as never, slice, vertStart, vertEnd);
      slice += 1;
      if (drawArrow) {
        slice += opts.arrowSkip;
      }
    }
    vertArray.addVertex(pos, tangent, color, objIds[objIds.length -1]!);
    capTubeEnd(vertArray, vertStart, opts.arcDetail * 4);
    opts.float32Allocator.release(normals);
    opts.float32Allocator.release(positions);
    return traceIndex + 1;
  };
})();


// Referenced by traceForChain above, before this binding is assigned;
// using let/const would make that a TDZ reference error.
// eslint-disable-next-line no-var
var _renderSingleTrace = (function() {
  const rotation = mat3.create();
  const dir = vec3.create(), left = vec3.create(), up = vec3.create(),
      midPoint = vec3.create(), caPrevPos = vec3.create(),
      caThisPos = vec3.create();
  const colorOne = vec4.fromValues(0.0, 0.0, 0.0, 1.0);
  const colorTwo = vec4.fromValues(0.0, 0.0, 0.0, 1.0);

  return function(
    meshGeom: MeshGeom, vertAssoc: InstanceType<typeof TraceVertexAssoc>, trace: RenderTrace,
    traceIndex: number, opts: RenderOptions,
  ) {
    if (trace.length() === 0) {
      return;
    }
    const idRange = opts.idPool.getContinuousRange(trace.length())!;
    meshGeom.addIdRange(idRange);
    opts.color.colorFor(trace.centralAtomAt(0) as never, colorOne as Float32Array, 0);
    const numVerts = _traceNumVerts([trace], opts.protoSphere.numVerts(),
                                  opts.protoCyl.numVerts());
    let remainingVerts = numVerts;
    let va = meshGeom.vertArrayWithSpaceFor(numVerts);
    const maxVerts = va.maxVerts();
    let vertStart = va.numVerts();
    trace.posAt(caPrevPos, 0);
    let idStart = idRange.nextId({ geom : meshGeom,
                                   atom : trace.centralAtomAt(0),
                                   isTrace : true }),
        idEnd = 0;
    opts.protoSphere.addTransformed(va, caPrevPos, opts.radius,
                                   colorOne, idStart);
    let vertEnd: number | null = null;
    vertAssoc.addAssoc(traceIndex, va as never, 0, vertStart, vertEnd as unknown as number);
    const colors = opts.float32Allocator.request(trace.length() * 4);
    colors[0] = colorOne[0];
    colors[1] = colorOne[1];
    colors[2] = colorOne[2];
    colors[3] = colorOne[3];
    const vertsPerIteration = opts.protoCyl.numVerts() +
                            opts.protoSphere.numVerts();
    for (let i = 1; i < trace.length(); ++i) {
      idEnd = idRange.nextId({ geom : meshGeom, atom : trace.centralAtomAt(i),
                               isTrace : true });
      trace.posAt(caPrevPos, i - 1);
      trace.posAt(caThisPos, i);
      opts.color.colorFor(trace.centralAtomAt(i) as never, colorTwo as Float32Array, 0);
      colors[i * 4 + 0] = colorTwo[0];
      colors[i * 4 + 1] = colorTwo[1];
      colors[i * 4 + 2] = colorTwo[2];
      colors[i * 4 + 3] = colorTwo[3];

      vec3.sub(dir, caThisPos, caPrevPos);
      const length = vec3.length(dir);

      vec3.scale(dir, dir, 1.0 / length);

      geom.buildRotation(rotation, dir, left, up, false);

      vec3.copy(midPoint, caPrevPos);
      vec3.add(midPoint, midPoint, caThisPos);
      vec3.scale(midPoint, midPoint, 0.5);
      // make sure there is enough space in the vertex array, if not request a 
      // new one.
      if (vertsPerIteration > (maxVerts - va.numVerts())) {
        va = meshGeom.vertArrayWithSpaceFor(remainingVerts);
      }
      remainingVerts -= vertsPerIteration;
      const endSphere = va.numVerts();
      opts.protoCyl.addTransformed(va, midPoint, length,
                                   opts.radius, rotation, colorOne,
                                   colorTwo, idStart, idEnd);
      vertEnd = va.numVerts();
      vertEnd = vertEnd - (vertEnd - endSphere) / 2;

      opts.protoSphere.addTransformed(va, caThisPos, opts.radius, 
                                      colorTwo, idEnd);
      idStart = idEnd;
      vertAssoc.addAssoc(traceIndex, va as never, i, vertStart, vertEnd);
      vertStart = vertEnd;
      vec3.copy(colorOne, colorTwo);
    }
    vertAssoc.setPerResidueColors(traceIndex, colors);
    vertAssoc.addAssoc(traceIndex, va as never, trace.length() - 1, vertStart,
                        va.numVerts());
  };
})();


export default exports;
