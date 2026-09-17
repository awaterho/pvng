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


import { vec3 } from 'gl-matrix';
import geom from '../geom';

// Structural typing for Residue/ResidueView (mol/residue.ts): only what a
// backbone trace needs from whichever residue type it was built from.
export interface TraceResidue {
  centralAtom(): { pos(): vec3 } | null;
  isAminoacid(): boolean;
  atom(name: string): { pos(): vec3 } | null;
  index(): number;
  full(): { index(): number };
}

class BackboneTrace<R extends TraceResidue> {
  _trace: R[];

  constructor() { this._trace = []; }

  push(residue: R): void {
    this._trace.push(residue);
  }

  length(): number {
    return this._trace.length;
  }

  residueAt(index: number): R {
    return this._trace[index]!;
  }

  posAt(out: vec3, index: number): vec3 {
    vec3.copy(out, this._trace[index]!.centralAtom()!.pos());
    return out;
  }

  normalAt(out: vec3, index: number): vec3 {
    const residue = this._trace[index]!;
    if (residue.isAminoacid()) {
      vec3.sub(out, residue.atom('O')!.pos(), residue.atom('C')!.pos());
    }
    vec3.normalize(out, out);
    return out;
  }

  centralAtomAt(index: number): { pos(): vec3 } | null {
    return this._trace[index]!.centralAtom();
  }

  tangentAt = (function() {
    const posBefore = vec3.create();
    const posAfter = vec3.create();
    return function(this: BackboneTrace<R>, out: vec3, index: number): void {
      if (index > 0) {
        this.posAt(posBefore, index - 1);
      } else {
        this.posAt(posBefore, index);
      }
      if (index < this._trace.length-1) {
        this.posAt(posAfter, index + 1);
      } else {
        this.posAt(posAfter, index);
      }
      vec3.sub(out, posAfter, posBefore);
    };
  })();

  fullTraceIndex(index: number): number {
    return index;
  }

  residues(): R[] { return this._trace; }

  // Note: intentionally a separate generic parameter from R, not R itself --
  // this is called with a view's residue list (e.g. ChainView's ResidueView[]
  // matched against Chain's own BackboneTrace<Residue>) and only ever
  // compares via full().index(), never touches the passed-in residues
  // otherwise.
  subsets<V extends { full(): { index(): number } }>(residues: V[]): TraceSubset<R>[] {
    // we assume that the residue list is ordered from N- to C-
    // terminus and we can traverse it in one go.
    let fullTraceIdx = 0, listIdx = 0;
    const subsets: TraceSubset<R>[] = [];
    while (listIdx < residues.length && fullTraceIdx < this._trace.length) {
      // increase pointer until the residue indices match.
      const residueIndex = residues[listIdx]!.full().index();
      while (this._trace.length > fullTraceIdx &&
             this._trace[fullTraceIdx]!.index() < residueIndex) {
        ++fullTraceIdx;
      }
      if (fullTraceIdx >= this._trace.length) {
        break;
      }
      const traceIndex = this._trace[fullTraceIdx]!.index();
      while (residues.length > listIdx &&
            residues[listIdx]!.full().index() < traceIndex) {
        ++listIdx;
      }
      if (listIdx >= residues.length) {
        break;
      }
      const fullTraceBegin = fullTraceIdx;
      while (residues.length > listIdx && this._trace.length > fullTraceIdx &&
             residues[listIdx]!.full().index() ===
                this._trace[fullTraceIdx]!.index()) {
        ++listIdx;
        ++fullTraceIdx;
      }
      const fullTraceEnd = fullTraceIdx;
      subsets.push(new TraceSubset(this, fullTraceBegin, fullTraceEnd));
    }
    return subsets;
  }

  // nothing needs to be done for the backbone trace.
  smoothPosAt(out: vec3, index: number): vec3 {
    return this.posAt(out, index);
  }
  smoothNormalAt(out: vec3, index: number): vec3 {
    return this.normalAt(out, index);
  }
}

// a trace subset, e.g. the part of a trace contained in a view. End regions
// are handled automatically depending on whether the beginning/end of the
// trace subset coincides with the C- and N-terminus of the full trace.
class TraceSubset<R extends TraceResidue> {
  _fullTrace: BackboneTrace<R>;
  _fullTraceBegin: number;
  _fullTraceEnd: number;
  _isNTerminal: boolean;
  _isCTerminal: boolean;
  _length: number;

  constructor(fullTrace: BackboneTrace<R>, fullTraceBegin: number, fullTraceEnd: number) {
    this._fullTrace = fullTrace;
    this._fullTraceBegin = fullTraceBegin;
    this._fullTraceEnd = fullTraceEnd;
    this._isNTerminal = this._fullTraceBegin === 0;
    this._isCTerminal = this._fullTrace.length() === this._fullTraceEnd;
    let length = this._fullTraceEnd - this._fullTraceBegin;
    if (!this._isCTerminal) {
      ++length;
    }
    if (!this._isNTerminal) {
      ++length;
      this._fullTraceBegin -= 1;
    }
    this._length = length;
  }

  length(): number {
    return this._length;
  }
  residueAt(index: number): R {
    return this._fullTrace.residueAt(this._fullTraceBegin + index);
  }

  residues(): R[] {
    const residues: R[] = [];
    for (let i = 0; i < this._length; ++i) {
      residues.push(this.residueAt(i));
    }
    return residues;
  }

  private _interpolate = (function() {
    const tangentOne = vec3.create();
    const tangentTwo = vec3.create();
    return function(
      this: TraceSubset<R>, out: vec3, indexOne: number, indexTwo: number, strength: number
    ): vec3 {
      this.tangentAt(tangentOne, indexOne);
      this.tangentAt(tangentTwo, indexTwo);
      vec3.scale(tangentOne, tangentOne, strength);
      vec3.scale(tangentTwo, tangentTwo, strength);
      geom.cubicHermiteInterpolate(out, this.centralAtomAt(indexOne)!.pos(),
                                  tangentOne, this.centralAtomAt(indexTwo)!.pos(),
                                  tangentTwo, 0.5, 0);
      return out;
    };
  })();

  // like posAt, but interpolates the position for the ends with a Catmull-Rom
  // spline.
  smoothPosAt(out: vec3, index: number, strength: number): vec3 {
    if (index === 0 && !this._isNTerminal) {
      return this._interpolate(out, index, index + 1, strength);
    }
    if (index === this._length-1 && !this._isCTerminal) {
      return this._interpolate(out, index - 1, index, strength);
    }
    const atom = this.centralAtomAt(index)!;
    vec3.copy(out, atom.pos());
    return out;
  }


  smoothNormalAt(out: vec3, index: number): vec3 {
    this._fullTrace.normalAt(out, index + this._fullTraceBegin);
    return out;
  }

  posAt(out: vec3, index: number): vec3 {
    const atom = this.centralAtomAt(index)!;
    let atom2;
    vec3.copy(out, atom.pos());
    if (index === 0 && !this._isNTerminal) {
      atom2 = this.centralAtomAt(index + 1)!;
      vec3.add(out, out, atom2.pos());
      vec3.scale(out, out, 0.5);
    }
    if (index === this._length - 1 && !this._isCTerminal) {
      atom2 = this.centralAtomAt(index - 1)!;
      vec3.add(out, out, atom2.pos());
      vec3.scale(out, out, 0.5);
    }
    return out;
  }

  centralAtomAt(index: number): { pos(): vec3 } | null {
    return this.residueAt(index).centralAtom();
  }

  fullTraceIndex(index: number): number {
    return this._fullTraceBegin + index;
  }
  tangentAt(out: vec3, index: number): void {
    return this._fullTrace.tangentAt(out, index + this._fullTraceBegin);
  }
}

export default {
  TraceSubset : TraceSubset,
  BackboneTrace : BackboneTrace
};
