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
import utils from '../utils';
import { vec3, mat4 } from 'gl-matrix';
import SceneNode, { type SceneNode as ISceneNode } from './scene-node';
import type { AtomVertexAssoc, TraceVertexAssoc, AssocStructure } from './vert-assoc';
import type Cam from './cam';
import type { ShaderProgram } from './cam';

type VertAssoc = AtomVertexAssoc | TraceVertexAssoc;

interface SymGeneratorLike {
  chains(): string[];
  matrices(): mat4[];
  matrix(index: number): mat4 | undefined;
}
interface AssemblyLike {
  generators(): SymGeneratorLike[];
}

// Structural typing extending vert-assoc.ts's AssocStructure with the
// additional members BaseGeom itself needs (Mol/MolView satisfy this).
interface GeomStructure extends AssocStructure {
  assembly(id: string | null): AssemblyLike | null;
  select(what: unknown): unknown;
  createEmptyView(): unknown;
  chainsByName(names: string[]): GeomChain[];
}
interface GeomResidue {
  centralAtom(): { pos(): vec3 } | null;
}
interface GeomChain {
  residues(): GeomResidue[];
}
interface HasEachResidue {
  eachResidue(callback: (residue: GeomResidue) => void): void;
}

interface VertArray {
  chain(): unknown;
  updateProjectionIntervals(
    xAxis: vec3, yAxis: vec3, zAxis: vec3,
    xInterval: { update(v: number): void }, yInterval: { update(v: number): void },
    zInterval: { update(v: number): void }, transform?: mat4,
  ): void;
  updateSquaredSphereRadius(center: vec3, radius: number | null, transform?: mat4): number | null;
}

type CentralAtomCallback = (atom: unknown, pos: vec3) => void;

function eachCentralAtomAsym(structure: HasEachResidue, callback: CentralAtomCallback): void {
  structure.eachResidue(function(residue) {
    const centralAtom = residue.centralAtom();
    if (centralAtom === null) {
      return;
    }
    callback(centralAtom, centralAtom.pos());
  });
}

const eachCentralAtomSym = (function() {
  const transformedPos = vec3.create();
  return function(structure: GeomStructure, gens: SymGeneratorLike[], callback: CentralAtomCallback): void {
    for (let i = 0; i < gens.length; ++i) {
      const gen = gens[i]!;
      const chains = structure.chainsByName(gen.chains());
      for (let j = 0; j < gen.matrices().length; ++j) {
        const matrix = gen.matrix(j)!;
        for (let k = 0; k < chains.length; ++k) {
          const chain = chains[k]!;
          for (let l = 0; l < chain.residues().length; ++l) {
            const centralAtom = chain.residues()[l]!.centralAtom();
            if (centralAtom === null) {
              continue;
            }
            vec3.transformMat4(transformedPos, centralAtom.pos(), matrix);
            callback(centralAtom, transformedPos);
          }
        }
      }
    }
  };
})();

// NOTE: kept as a prototype-based constructor function, not a real ES class
// -- see gfx/vertex-array-base.ts for why (gfx/line-geom.js and
// gfx/mesh-geom.js, not yet converted, chain-invoke this via
// `BaseGeom.call(this, gl)`).
//
// vertArrays()/shaderForStyleAndPass()/_drawVertArrays() are used here but
// must be provided by whichever subclass sets up the actual vertex buffers
// (gfx/line-geom.ts, gfx/mesh-geom.ts).
export interface BaseGeom extends ISceneNode {
  _idRanges: { recycle(): void }[];
  _vertAssocs: VertAssoc[];
  _showRelated: string | null;
  _selection: unknown;
  _ready: boolean;

  vertArrays(): VertArray[];
  shaderForStyleAndPass(shaderCatalog: unknown, style: unknown, pass: unknown): ShaderProgram | null;
  _drawVertArrays(cam: Cam, shader: ShaderProgram, vertArrays: VertArray[], matrices: mat4[] | null): void;

  setShowRelated(rel: string | null): string | null | undefined;
  symWithIndex(index: number): mat4 | null;
  showRelated(): string | null;
  select(what: unknown): unknown;
  structure(): GeomStructure;
  getColorForAtom(atom: unknown, color: number[]): number[] | null;
  addIdRange(range: { recycle(): void }): void;
  eachCentralAtom(callback: CentralAtomCallback): void;
  addVertAssoc(assoc: VertAssoc): void;
  _vertArraysInvolving(chains: string[]): VertArray[];
  _drawSymmetryRelated(cam: Cam, shader: ShaderProgram, assembly: AssemblyLike): void;
  _updateProjectionIntervalsAsym(
    xAxis: vec3, yAxis: vec3, zAxis: vec3,
    xInterval: { update(v: number): void }, yInterval: { update(v: number): void },
    zInterval: { update(v: number): void },
  ): void;
  updateProjectionIntervals(
    xAxis: vec3, yAxis: vec3, zAxis: vec3,
    xInterval: { update(v: number): void }, yInterval: { update(v: number): void },
    zInterval: { update(v: number): void },
  ): void | undefined;
  _updateSquaredSphereRadiusAsym(center: vec3, radius: number | null): number | null;
  updateSquaredSphereRadius(center: vec3, radius: number | null): number | null;
  colorBy(colorFunc: never, view?: unknown): void;
  setOpacity(val: number, view?: unknown): void;
  setSelection(view: unknown): void;
  selection(): unknown;
}

interface BaseGeomConstructor {
  new (gl: WebGL2RenderingContext): BaseGeom;
  (this: BaseGeom, gl: WebGL2RenderingContext): void;
  prototype: BaseGeom;
}

const BaseGeom = function(this: BaseGeom, gl: WebGL2RenderingContext) {
  (SceneNode as unknown as (this: BaseGeom, gl: WebGL2RenderingContext) => void).call(this, gl);
  this._idRanges = [];
  this._vertAssocs = [];
  this._showRelated = null;
  this._selection = null;
} as unknown as BaseGeomConstructor;

utils.derive(BaseGeom, SceneNode, {
  setShowRelated: function(this: BaseGeom, rel: string | null) {
    if (rel && rel !== 'asym') {
      if (this.structure().assembly(rel) === null) {
        console.error('no assembly with name', rel,
                      '. Falling back to asymmetric unit');
        return;
      }
    }
    this._showRelated = rel;
    return rel;
  },

  symWithIndex: function(this: BaseGeom, index: number): mat4 | null {
    if (this.showRelated() === 'asym') {
      return null;
    }
    const assembly = this.structure().assembly(this.showRelated());
    if (!assembly) {
      return null;
    }
    const gen = assembly.generators();
    for (let i = 0 ; i < gen.length; ++i) {
      if (gen[i]!.matrices().length > index) {
        return gen[i]!.matrix(index) ?? null;
      }
      index -= gen[i]!.matrices().length;
    }
    return null;
  },

  showRelated: function(this: BaseGeom) {
    return this._showRelated;
  },

  select: function(this: BaseGeom, what: unknown) {
    return this.structure().select(what);
  },

  structure: function(this: BaseGeom) {
    return this._vertAssocs[0]!._structure as GeomStructure;
  },


  getColorForAtom: function(this: BaseGeom, atom: unknown, color: number[]) {
    // FIXME: what to do in case there are multiple assocs?
    return (this._vertAssocs[0] as AtomVertexAssoc).getColorForAtom(atom as never, color);
  },

  addIdRange: function(this: BaseGeom, range: { recycle(): void }) {
    this._idRanges.push(range);
  },

  destroy: function(this: BaseGeom) {
    (SceneNode.prototype.destroy as (this: BaseGeom) => void).call(this);
    for (let i = 0; i < this._idRanges.length; ++i) {
      this._idRanges[i]!.recycle();
    }
  },

  eachCentralAtom: function(this: BaseGeom, callback: CentralAtomCallback) {
    const go = this;
    const structure = go.structure();
    const assembly = structure.assembly(go.showRelated());
    // in case there is no assembly, just loop over all the atoms contained
    // in the structure and invoke the callback as is
    if (assembly === null) {
      return eachCentralAtomAsym(structure as unknown as HasEachResidue, callback);
    }
    return eachCentralAtomSym(structure, assembly.generators(), callback);
  },

  addVertAssoc: function(this: BaseGeom, assoc: VertAssoc) {
    this._vertAssocs.push(assoc);
  },

  // returns all vertex arrays that contain geometry for one of the specified
  // chain names. Typically, there will only be one array for a given chain,
  // but for larger chains with mesh geometries a single chain may be split
  // across multiple vertex arrays.
  _vertArraysInvolving: function(this: BaseGeom, chains: string[]) {
    const vertArrays = this.vertArrays();
    const selectedArrays: VertArray[] = [];
    const set: Record<string, boolean> = {};
    for (let ci = 0; ci < chains.length; ++ci) {
      set[chains[ci]!] = true;
    }
    for (let i = 0; i < vertArrays.length; ++i) {
      if (set[vertArrays[i]!.chain() as string] === true) {
        selectedArrays.push(vertArrays[i]!);
      }
    }
    return selectedArrays;
  },


  // draws vertex arrays by using the symmetry generators contained in assembly
  _drawSymmetryRelated: function(this: BaseGeom, cam: Cam, shader: ShaderProgram, assembly: AssemblyLike) {
    const gens = assembly.generators();
    for (let i = 0; i < gens.length; ++i) {
      const gen = gens[i]!;
      const affectedVAs = this._vertArraysInvolving(gen.chains());
      this._drawVertArrays(cam, shader, affectedVAs, gen.matrices());
    }
  },

  _updateProjectionIntervalsAsym: function(
    this: BaseGeom, xAxis: vec3, yAxis: vec3, zAxis: vec3,
    xInterval: { update(v: number): void }, yInterval: { update(v: number): void },
    zInterval: { update(v: number): void },
  ) {
    const vertArrays = this.vertArrays();
    for (let i = 0; i < vertArrays.length; ++i) {
      vertArrays[i]!.updateProjectionIntervals(xAxis, yAxis, zAxis, xInterval,
                                              yInterval, zInterval);
    }
  },

  updateProjectionIntervals: function(
    this: BaseGeom, xAxis: vec3, yAxis: vec3, zAxis: vec3,
    xInterval: { update(v: number): void }, yInterval: { update(v: number): void },
    zInterval: { update(v: number): void },
  ) {
    if (!this._visible) {
      return;
    }
    const showRelated = this.showRelated();
    if (showRelated === 'asym') {
      return this._updateProjectionIntervalsAsym(xAxis, yAxis, zAxis,
                                                 xInterval, yInterval,
                                                 zInterval);
    }
    const assembly = this.structure().assembly(showRelated);
    // in case there is no assembly, fallback to asymmetric unit and bail out.
    const gens = assembly!.generators();
    for (let i = 0; i < gens.length; ++i) {
      const gen = gens[i]!;
      const affectedVAs = this._vertArraysInvolving(gen.chains());
      for (let j = 0; j < gen.matrices().length; ++j) {
        for (let k = 0; k < affectedVAs.length; ++k) {
          const transform = gen.matrix(j);
          affectedVAs[k]!.updateProjectionIntervals(xAxis, yAxis, zAxis,
                                                   xInterval, yInterval,
                                                   zInterval, transform);
        }
      }
    }
  },

  // FIXME: investigate the performance cost of sharing code between
  // updateSquaredSphereRadius and updateProjectionIntervals
  _updateSquaredSphereRadiusAsym: function(this: BaseGeom, center: vec3, radius: number | null) {
    const vertArrays = this.vertArrays();
    for (let i = 0; i < vertArrays.length; ++i) {
      radius = vertArrays[i]!.updateSquaredSphereRadius(center, radius);
    }
    return radius;
  },

  updateSquaredSphereRadius: function(this: BaseGeom, center: vec3, radius: number | null) {
    if (!this._visible) {
      return radius;
    }
    const showRelated = this.showRelated();
    if (showRelated === 'asym') {
      return this._updateSquaredSphereRadiusAsym(center, radius);
    }
    const assembly = this.structure().assembly(showRelated);
    const gens = assembly!.generators();
    for (let i = 0; i < gens.length; ++i) {
      const gen = gens[i]!;
      const affectedVAs = this._vertArraysInvolving(gen.chains());
      for (let j = 0; j < gen.matrices().length; ++j) {
        for (let k = 0; k < affectedVAs.length; ++k) {
          // FIXME: is this correct?
          // var transform = gen.matrix(j);
          radius = affectedVAs[k]!.updateSquaredSphereRadius(center, radius);
        }
      }
    }
    return radius;
  },

  draw: function(this: BaseGeom, cam: Cam, shaderCatalog: unknown, style: unknown, pass: unknown) {

    if (!this._visible) {
      return;
    }

    const shader = this.shaderForStyleAndPass(shaderCatalog, style, pass);

    if (!shader) {
      return;
    }
    const showRelated = this.showRelated();
    if (showRelated === 'asym') {
      return this._drawVertArrays(cam, shader, this.vertArrays(), null);
    }

    const assembly = this.structure().assembly(showRelated);
    return this._drawSymmetryRelated(cam, shader, assembly!);
  },

  colorBy: function(this: BaseGeom, colorFunc: never, view?: unknown) {
    console.time('BaseGeom.colorBy');
    this._ready = false;
    view = view || this.structure();
    for (let i = 0; i < this._vertAssocs.length; ++i) {
      (this._vertAssocs[i] as AtomVertexAssoc).recolor(colorFunc, view as never);
    }
    console.timeEnd('BaseGeom.colorBy');
  },

  setOpacity: function(this: BaseGeom, val: number, view?: unknown) {
    console.time('BaseGeom.setOpacity');
    this._ready = false;
    view = view || this.structure();
    for (let i = 0; i < this._vertAssocs.length; ++i) {
      (this._vertAssocs[i] as AtomVertexAssoc).setOpacity(val, view as never);
    }
    console.timeEnd('BaseGeom.setOpacity');
  },
  setSelection: function(this: BaseGeom, view: unknown) {
    console.time('BaseGeom.setSelection');
    this._selection = view;
    this._ready = false;
    for (let i = 0; i < this._vertAssocs.length; ++i) {
      (this._vertAssocs[i] as AtomVertexAssoc).setSelection(view as never);
    }
    console.timeEnd('BaseGeom.setSelection');
  },
  selection: function(this: BaseGeom) {
    if (this._selection === null) {
      this._selection = this.structure().createEmptyView();
    }
    return this._selection;
  }
} as Partial<BaseGeom>);


export default BaseGeom;
