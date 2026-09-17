// Copyright (c) 2013-2015 Marco Biasini
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
// DEALINGS IN THE SOFTWARE.
import colorModule, { type ColorAtom, type ColorObj } from '../color';
import geom from '../geom';

type ColorOp = InstanceType<typeof colorModule.ColorOp>;

// Structural typing for the VertexArray/IndexedVertexArray family
// (gfx/vertex-array-base.ts): only what recoloring/opacity/selection touch.
interface AssocVertexArray {
  setColor(index: number, r: number, g: number, b: number, a: number): void;
  getColor(index: number, color: number[]): number[];
  setSelected(index: number, a: number): void;
  setOpacity(index: number, a: number): void;
}

interface AssocAtom extends ColorAtom {
  index(): number;
  full(): AssocAtom;
}

interface AssocView {
  atomCount(): number;
  eachAtom(callback: (atom: AssocAtom, index: number) => void): void;
  containsResidue(residue: unknown): boolean;
}

export interface AssocStructure extends ColorObj {
  backboneTraces(): AssocTrace[];
}

interface AssocTrace {
  length(): number;
  residueAt(index: number): unknown;
  centralAtomAt(index: number): AssocAtom;
}

// During recoloring of a render style, most of the vertex attributes, e.g.
// normals and positions do not change. Only the color information for each
// vertex needs to be adjusted.
//
// To do that efficiently, we need store an association between ranges of
// vertices and atoms in the original structure. Worse, we also need to
// support render styles for which colors need to be interpolated, e.g.
// the smooth line trace, tube and cartoon render modes.
//
// The vertex association data for the atom-based render styles is managed
// by AtomVertexAssoc, whereas the trace-based render styles are managed
// by the TraceVertexAssoc class.
interface AtomAssocEntry {
  atom: AssocAtom;
  vertexArray: AssocVertexArray;
  vertStart: number;
  vertEnd: number;
}

export class AtomVertexAssoc {
  _structure: AssocStructure;
  private _assocs: AtomAssocEntry[];
  private _callBeginEnd: boolean;

  constructor(structure: AssocStructure, callColoringBeginEnd: boolean) {
    this._structure = structure;
    this._assocs = [];
    this._callBeginEnd = callColoringBeginEnd;
  }

  addAssoc(atom: AssocAtom, va: AssocVertexArray, vertStart: number, vertEnd: number): void {
    this._assocs.push({
      atom: atom, vertexArray : va, vertStart : vertStart, vertEnd : vertEnd
    });
  }

  recolor(colorOp: ColorOp, view: AssocView): void {
    // allocate buffer to hold all colors of the view.
    const colorData = new Float32Array(view.atomCount()*4);
    if (this._callBeginEnd) {
      // FIXME: does this need to be called on the complete structure or the
      // view?
      colorOp.begin(this._structure);
    }

    const atomMap: Record<number, number> = {};
    view.eachAtom(function(atom, index) {
      atomMap[atom.index()] = index;
      colorOp.colorFor(atom, colorData, index*4);
    });
    if (this._callBeginEnd) {
      colorOp.end();
    }
    // apply the color to the actual interleaved vertex array.
    for (let i = 0; i < this._assocs.length; ++i) {
      const assoc = this._assocs[i]!;
      const ai = atomMap[assoc.atom.index()];
      if (ai === undefined) {
        continue;
      }
      const r = colorData[ai*4+0]!, g = colorData[ai*4+1]!,
          b = colorData[ai*4+2]!, a = colorData[ai*4+3]!;
      const va = assoc.vertexArray;
      for (let j = assoc.vertStart ; j < assoc.vertEnd; ++j) {
        va.setColor(j, r, g, b, a);
      }
    }
  }

  getColorForAtom(atom: AssocAtom, color: number[]): number[] | null {
    // FIXME: this can potentially get slow when called for many atoms
    for (let i = 0; i < this._assocs.length; ++i) {
      const assoc = this._assocs[i]!;
      if (assoc.atom.full() === atom.full()) {
        // for atom-based color, the color for each atom is constant, so just
        // use any vertex to the determine color.
        return assoc.vertexArray.getColor(assoc.vertStart, color);
      }
    }
    return null;
  }

  setSelection(view: AssocView): void {
    const atomMap: Record<number, boolean> = {};
    view.eachAtom(function(atom) {
      atomMap[atom.index()] = true;
    });
    for (let i = 0; i < this._assocs.length; ++i) {
      const assoc = this._assocs[i]!;
      const ai = atomMap[assoc.atom.index()];
      const selected = ai !== true ? 0.0 : 1.0;
      const va = assoc.vertexArray;
      for (let j = assoc.vertStart ; j < assoc.vertEnd; ++j) {
        va.setSelected(j, selected);
      }
    }
  }

  setOpacity(val: number, view: AssocView): void {
    const atomMap: Record<number, boolean> = {};
    view.eachAtom(function(atom) {
      atomMap[atom.index()] = true;
    });
    // apply the color to the actual interleaved vertex array.
    for (let i = 0; i < this._assocs.length; ++i) {
      const assoc = this._assocs[i]!;
      const ai = atomMap[assoc.atom.index()];
      if (ai !== true) {
        continue;
      }
      const va = assoc.vertexArray;
      for (let j = assoc.vertStart ; j < assoc.vertEnd; ++j) {
        va.setOpacity(j, val);
      }
    }
  }
}

interface TraceAssocEntry {
  traceIndex: number;
  slice: number;
  vertStart: number;
  vertEnd: number;
  vertexArray: AssocVertexArray;
}

// handles the association between a trace element, and sets of vertices.
export class TraceVertexAssoc {
  _structure: AssocStructure;
  private _assocs: TraceAssocEntry[];
  private _callBeginEnd: boolean;
  private _interpolation: number;
  private _perResidueColors: Record<number, Float32Array>;

  constructor(structure: AssocStructure, interpolation: number, callColoringBeginEnd: boolean) {
    this._structure = structure;
    this._assocs = [];
    this._callBeginEnd = callColoringBeginEnd;
    this._interpolation = interpolation || 1;
    this._perResidueColors = {};
  }

  setPerResidueColors(traceIndex: number, colors: Float32Array): void {
    this._perResidueColors[traceIndex] = colors;
  }

  addAssoc(
    traceIndex: number, vertexArray: AssocVertexArray, slice: number, vertStart: number, vertEnd: number
  ): void {
    this._assocs.push({ traceIndex: traceIndex, slice : slice,
                        vertStart : vertStart, vertEnd : vertEnd,
                        vertexArray : vertexArray});
  }

  recolor(colorOp: ColorOp, view: AssocView): void {
    // FIXME: this function might create quite a few temporary buffers.
    // use buffer pool to avoid hitting the GC and having to go through
    // the slow creation of typed arrays.
    if (this._callBeginEnd) {
      // FIXME: does this need to be called on the complete structure?
      colorOp.begin(this._structure);
    }
    const colorData: Float32Array[] = [];
    let i, j;
    const traces = this._structure.backboneTraces();
    console.assert(!!this._perResidueColors,
                  "per-residue colors must be set for recoloring to work");
    for (i = 0; i < traces.length; ++i) {
      // get current residue colors
      const data = this._perResidueColors[i]!;
      console.assert(!!data, "no per-residue colors. Seriously, man?");
      let index = 0;
      const trace = traces[i]!;
      for (j = 0; j < trace.length(); ++j) {
        if (!view.containsResidue(trace.residueAt(j))) {
          index+=4;
          continue;
        }
        colorOp.colorFor(trace.centralAtomAt(j), data, index);
        index+=4;
      }
      if (this._interpolation > 1) {
        colorData.push(colorModule.interpolateColor(data, this._interpolation));
      } else {
        colorData.push(data);
      }
    }

    // store the color in the actual interleaved vertex array.
    for (i = 0; i < this._assocs.length; ++i) {
      const assoc = this._assocs[i]!;
      const ai = assoc.slice;
      const newColors = colorData[assoc.traceIndex]!;
      const r = newColors[ai*4]!,   g = newColors[ai*4+1]!,
          b = newColors[ai*4+2]!, a = newColors[ai*4+3]!;
      const va = assoc.vertexArray;
      for (j = assoc.vertStart ; j < assoc.vertEnd; ++j) {
        va.setColor(j, r, g, b, a);
      }
    }
    if (this._callBeginEnd) {
      colorOp.end();
    }
  }

  getColorForAtom(atom: { full(): { residue(): unknown } }, color: number[]): number[] | null {
    // FIXME: this can potentially get slow when called for many atoms
    let i, j;
    const traces = this._structure.backboneTraces();
    const residue = atom.full().residue();
    for (i = 0; i < traces.length; ++i) {
      const data = this._perResidueColors[i]!;
      let index = 0;
      const trace = traces[i]!;
      for (j = 0; j < trace.length(); ++j) {
        if (residue === (trace.residueAt(j) as { full(): unknown }).full()) {
          color[0] = data[index + 0]!;
          color[1] = data[index + 1]!;
          color[2] = data[index + 2]!;
          color[3] = data[index + 3]!;
          return color;
        }
        index+=4;
      }
    }
    return null;
  }

  setSelection(view: AssocView): void {
    const selData: Float32Array[] = [];
    let i, j;
    const traces = this._structure.backboneTraces();
    for (i = 0; i < traces.length; ++i) {
      // get current residue colors
      const data = new Float32Array(this._perResidueColors[i]!.length);
      let index = 0;
      const trace = traces[i]!;
      for (j = 0; j < trace.length(); ++j) {
        const selected = view.containsResidue(trace.residueAt(j)) ? 1.0 : 0.0;
        data[index] = selected;
        index+=1;
      }
      if (this._interpolation > 1) {
        selData.push(geom.interpolateScalars(data, this._interpolation));
      } else {
        selData.push(data);
      }
    }

    // store the color in the actual interleaved vertex array.
    for (i = 0; i < this._assocs.length; ++i) {
      const assoc = this._assocs[i]!;
      const ai = assoc.slice;
      const sel = selData[assoc.traceIndex]!;
      const a = sel[ai]!;
      const va = assoc.vertexArray;
      for (j = assoc.vertStart ; j < assoc.vertEnd; ++j) {
        va.setSelected(j, a);
      }
    }
  }

  setOpacity(val: number, view: AssocView): void {
    const colorData: Float32Array[] = [];
    let i, j;
    const traces = this._structure.backboneTraces();
    for (i = 0; i < traces.length; ++i) {
      // get current residue colors
      const data = this._perResidueColors[i]!;
      let index = 0;
      const trace = traces[i]!;
      for (j = 0; j < trace.length(); ++j) {
        if (!view.containsResidue(trace.residueAt(j))) {
          index+=4;
          continue;
        }
        data[index + 3] = val;
        index+=4;
      }
      if (this._interpolation > 1) {
        colorData.push(colorModule.interpolateColor(data, this._interpolation));
      } else {
        colorData.push(data);
      }
    }

    // store the color in the actual interleaved vertex array.
    for (i = 0; i < this._assocs.length; ++i) {
      const assoc = this._assocs[i]!;
      const ai = assoc.slice;
      const newColors = colorData[assoc.traceIndex]!;
      const a = newColors[ai*4+3]!;
      const va = assoc.vertexArray;
      for (j = assoc.vertStart ; j < assoc.vertEnd; ++j) {
        va.setOpacity(j, a);
      }
    }
  }
}

export default {
  TraceVertexAssoc : TraceVertexAssoc,
  AtomVertexAssoc : AtomVertexAssoc
};
