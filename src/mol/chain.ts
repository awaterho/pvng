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
import utils from '../utils';
import residueModule from './residue';
import traceModule, { type TraceResidue } from './trace';

const Residue = residueModule.Residue;
const ResidueView = residueModule.ResidueView;
type Residue = InstanceType<typeof Residue>;
type ResidueView = InstanceType<typeof ResidueView>;
const BackboneTrace = traceModule.BackboneTrace;
type BackboneTrace<R extends TraceResidue> = InstanceType<typeof BackboneTrace<R>>;
type TraceSubset<R extends TraceResidue> = ReturnType<BackboneTrace<R>['subsets']>[number];

interface HasNum {
  num(): number;
}

// Structural typing for what ChainBase needs from whichever residue type
// (Residue or ResidueView) it was instantiated with.
interface ChainResidue extends HasNum {
  insCode(): string;
  eachAtom(callback: (atom: unknown, index: number) => boolean | void, index: number): number | false;
  atoms(): { length: number };
  isAminoacid(): boolean;
  isNucleotide(): boolean;
  atom(name: string): { isConnectedTo(other: unknown): boolean; pos(): vec3 } | null;
  index(): number;
}

// Structural typing for Mol/MolView (mol/mol.ts, not yet converted).
interface ChainStructure {
  createEmptyView(): unknown;
}

// combines the numeric part of the residue number with the insertion
// code and returns a single number. Note that this is completely safe
// and we do not have to worry about overflows, as for PDB files the
// range of permitted residue numbers is quite limited anyway.
function rnumInsCodeHash(num: number, insCode: string): number {
  return num << 8 | insCode.charCodeAt(0);
}

function rnumComp(lhs: HasNum, rhs: HasNum): boolean {
  return lhs.num() < rhs.num();
}

function numify(val: number): HasNum {
  return { num : function() { return val; }};
}

abstract class ChainBase<R extends ChainResidue> {
  protected _residues!: R[];
  protected _rnumsOrdered!: boolean;

  abstract structure(): unknown;
  abstract full(): unknown;

  eachAtom(callback: (atom: unknown, index: number) => boolean | void, index?: number): number | false {
    index = index ? index | 0 : 0;
    for (let i = 0; i < this._residues.length; i += 1) {
      const result = this._residues[i]!.eachAtom(callback, index);
      if (result === false) {
        return false;
      }
      index = result;
    }
    return index;
  }


  atomCount(): number {
    let count = 0;
    const residues = this.residues();
    for (let ri = 0; ri < residues.length; ++ri) {
      count += residues[ri]!.atoms().length;
    }
    return count;
  }

  eachResidue(callback: (residue: R) => boolean | void): boolean | void {
    for (let i = 0; i < this._residues.length; i += 1) {
      if (callback(this._residues[i]!) === false) {
        return false;
      }
    }
  }

  residues(): R[] { return this._residues; }

  asView(): unknown {
    const view = (this.structure() as ChainStructure).createEmptyView() as {
      addChain(chain: unknown, recurse: boolean): unknown;
    };
    view.addChain(this, true);
    return view;
  }

  residueByRnum(rnum: number): R | null {
    const residues = this.residues();
    if (this._rnumsOrdered) {
      const index = utils.binarySearch(residues, numify(rnum), rnumComp);
      if (index === -1) {
        return null;
      }
      return residues[index]!;
    } else {
      for (let i = 0; i < residues.length; ++i) {
        if (residues[i]!.num() === rnum) {
          return residues[i]!;
        }
      }
      return null;
    }
  }

  residuesInRnumRange(start: number, end: number): R[] {
    // FIXME: this currently only works with the numeric part, insertion
    // codes are not honoured.
    const matching: R[] = [];
    let i, e;
    const residues = this.residues();
    if (this._rnumsOrdered === true) {
      // binary search our way to heaven
      const startIdx =
        utils.indexFirstLargerEqualThan(residues, numify(start), rnumComp);
      if (startIdx === -1) {
        return matching;
      }
      const endIdx =
        utils.indexLastSmallerEqualThan(residues, numify(end), rnumComp);
      if (endIdx === -1) {
        return matching;
      }
      for (i = startIdx; i <= endIdx; ++i) {
        matching.push(this._residues[i]!);
      }
    } else {
      for (i = 0, e = residues.length; i !== e; ++i) {
        const res = residues[i]!;
        if (res.num() >= start && res.num() <= end) {
          matching.push(res);
        }
      }
    }
    return matching;
  }


  prop(propName: string): unknown {
    return (this as unknown as Record<string, () => unknown>)[propName]!();
  }

  abstract name(): string;
  abstract backboneTraces(): unknown[];
}

// helper function to determine whether a trace break should be introduced
// between two residues of the same type (amino acid, or nucleotides).
//
// aaStretch: indicates whether the residues are to be treated as amino
//   acids
function shouldIntroduceTraceBreak(
  aaStretch: boolean, prevResidue: ChainResidue, thisResidue: ChainResidue
): boolean {
  // these checks are on purpose more relaxed than the checks we use in
  // deriveConnectivity(). We don't really care about correctness of bond
  // lengths here. The only thing that matters is that the residues are
  // more or less close so that they could potentially be connected.
  let prevAtom, thisAtom;
  if (aaStretch) {
    prevAtom = prevResidue.atom('C');
    thisAtom = thisResidue.atom('N');
  } else {
    prevAtom = prevResidue.atom('O3\'');
    thisAtom = thisResidue.atom('P');
  }

  // in case there is a bond, we don't introduce a chain break
  if (prevAtom!.isConnectedTo(thisAtom)) {
    return false;
  }
  const sqrDist = vec3.sqrDist(prevAtom!.pos(), thisAtom!.pos());
  return (Math.abs(sqrDist - 1.5*1.5) > 1);
}

function addNonEmptyTrace(
  traces: BackboneTrace<Residue>[], trace: BackboneTrace<Residue>
): void {
  if (trace.length() < 2) {
    return;
  }
  traces.push(trace);
}



function checkRnumsOrdered(residues: HasNum[], orderedFlag: boolean, newResidue: {
  num(): number; insCode(): string;
}): boolean {
  if (residues.length === 0) {
    return true;
  }
  if (!orderedFlag) {
    return false;
  }
  const combinedRNum = rnumInsCodeHash(newResidue.num(), newResidue.insCode());
  const last = residues[residues.length-1] as { num(): number; insCode(): string };
  const lastCombinedRNum = rnumInsCodeHash(last.num(), last.insCode());
  return lastCombinedRNum < combinedRNum;
}

class Chain extends ChainBase<Residue> {
  _structure: ChainStructure;
  _name: string;
  _cachedTraces: BackboneTrace<Residue>[];

  constructor(structure: ChainStructure, name: string) {
    super();
    this._structure = structure;
    this._name = name;
    this._cachedTraces = [];
    this._residues = [];
    this._rnumsOrdered = true;
  }

  override structure(): ChainStructure { return this._structure; }

  name(): string { return this._name; }

  full(): Chain { return this; }

  addResidue(name: string, num: number, insCode?: string): Residue {
    insCode = insCode || '\0';
    const residue = new Residue(this, name, num, insCode);
    this._rnumsOrdered = checkRnumsOrdered(this._residues,
                                           this._rnumsOrdered,
                                           residue);
    this._residues.push(residue);
    return residue;
  }

  // assigns secondary structure to residues in range from_num to to_num.
  assignSS(fromNumAndIns: [number, string], toNumAndIns: [number, string], ss: string): void {
    // FIXME: when the chain numbers are completely ordered, perform binary
    // search to identify range of residues to assign secondary structure to.
    const from = rnumInsCodeHash(fromNumAndIns[0], fromNumAndIns[1]);
    const to = rnumInsCodeHash(toNumAndIns[0], toNumAndIns[1]);
    for (let i = 1; i < this._residues.length-1; ++i) {
      const res = this._residues[i]!;
      // FIXME: we currently don't set the secondary structure of the last
      // residue of helices and sheets. that takes care of better transitions
      // between coils and helices. ideally, this should be done in the
      // cartoon renderer, NOT in this function.
      const combined = rnumInsCodeHash(res.num(), res.insCode());
      if (combined <  from || combined >= to) {
        continue;
      }
      res.setSS(ss);
    }
  }

  // invokes a callback for each connected stretch of amino acids. these
  // stretches are used for all trace-based rendering styles, e.g. sline,
  // line_trace, tube, cartoon etc.
  eachBackboneTrace(callback: (trace: BackboneTrace<Residue>) => void): void {
    this._cacheBackboneTraces();
    for (let i=0; i < this._cachedTraces.length; ++i) {
      callback(this._cachedTraces[i]!);
    }
  }

  _cacheBackboneTraces(): void {
    if (this._cachedTraces.length > 0) {
      return;
    }
    let stretch = new BackboneTrace<Residue>();
    // true when the stretch consists of amino acid residues, false
    // if the stretch consists of nucleotides, null otherwise.
    let aaStretch: boolean | null = null;
    for (let i = 0; i < this._residues.length; i+=1) {
      const residue = this._residues[i]!;
      const isAminoacid = residue.isAminoacid();
      const isNucleotide = residue.isNucleotide();
      if ((aaStretch  === true && !isAminoacid) ||
          (aaStretch === false && !isNucleotide) ||
          (aaStretch === null && !isNucleotide && !isAminoacid)) {
        // a break in the trace: push stretch if there were enough residues
        // in it and create new backbone trace.
        addNonEmptyTrace(this._cachedTraces, stretch);
        aaStretch = null;
        stretch = new BackboneTrace<Residue>();
        continue;
      }
      if (stretch.length() === 0) {
        stretch.push(residue);
        aaStretch = residue.isAminoacid();
        continue;
      }
      const prevResidue = this._residues[i-1]!;
      if (shouldIntroduceTraceBreak(aaStretch as boolean, prevResidue, residue)) {
        addNonEmptyTrace(this._cachedTraces, stretch);
        stretch = new BackboneTrace<Residue>();
      }
      stretch.push(residue);
    }
    addNonEmptyTrace(this._cachedTraces, stretch);
  }


  // returns all connected stretches of amino acids found in this chain as
  // a list.
  backboneTraces(): BackboneTrace<Residue>[] {
    const traces: BackboneTrace<Residue>[] = [];
    this.eachBackboneTrace(function(trace) { traces.push(trace); });
    return traces;
  }
}

interface AddableResidue {
  full(): Residue;
  atoms(): { full(): unknown }[];
  num(): number;
  insCode(): string;
}

interface AddableAtom {
  residue(): AddableResidue;
  full(): unknown;
}

class ChainView extends ChainBase<ResidueView> {
  _chain: Chain;
  _molView: unknown;
  _residueMap: Record<number, ResidueView>;

  constructor(molView: unknown, chain: Chain) {
    super();
    this._chain = chain;
    this._residues = [];
    this._molView = molView;
    this._residueMap = {};
    this._rnumsOrdered = true;
  }

  addResidue(residue: AddableResidue, recurse?: boolean): ResidueView {
    const resView = new ResidueView(this, residue.full());
    this._rnumsOrdered = checkRnumsOrdered(this._residues,
                                           this._rnumsOrdered,
                                           residue);
    this._residues.push(resView);
    this._residueMap[residue.full().index()] = resView;
    if (recurse) {
      const atoms = residue.atoms();
      for (let i = 0; i < atoms.length; ++i) {
        resView.addAtom(atoms[i]!.full() as never, false);
      }
    }
    return resView;
  }


  addAtom(atom: AddableAtom): ResidueView {
    let resView = this._residueMap[atom.residue().full().index()];
    if (resView === undefined) {
      resView = this.addResidue(atom.residue());
    }
    return resView.addAtom(atom.full() as never, true) as unknown as ResidueView;
  }

  removeAtom(atom: AddableAtom, removeEmptyResidues?: boolean): boolean {
    const resView = this._residueMap[atom.residue().full().index()];
    if (resView === undefined) {
      return false;
    }
    const removed = resView.removeAtom(atom as never);
    if (removed && resView.atoms().length === 0 && removeEmptyResidues) {
      delete this._residueMap[atom.residue().full().index()];
      // FIXME: this is terribly slow.
      this._residues = this._residues.filter(function(r) {
        return r !== resView;
      });
    }
    return removed;
  }

  containsResidue(residue: { full(): { index(): number } }): boolean {
    const resView = this._residueMap[residue.full().index()];
    if (resView === undefined) {
      return false;
    }
    return resView.full() === residue.full();
  }


  eachBackboneTrace(callback: (trace: TraceSubset<Residue>) => void): void {
    // backbone traces for the view must be based on the the full
    // traces for the following reasons:
    //  - we must be able to display subsets with one residue in length,
    //    when they are part of a larger trace.
    //  - when a trace residue is not at the end, e.g. the C-terminal or
    //    N-terminal end of the full trace, the trace residue starts
    //    midway between the residue and the previous, and ends midway
    //    between the residue and the next.
    //  - the tangents for the Catmull-Rom spline depend on the residues
    //    before and after. Thus, to get the same curvature for a
    //    trace subset, the residues before and after must be taken
    //    into account.
    const fullTraces = this._chain.backboneTraces();
    for (let i = 0; i < fullTraces.length; ++i) {
      const subsets = fullTraces[i]!.subsets(this._residues);
      for (let j = 0; j < subsets.length; ++j) {
        callback(subsets[j]!);
      }
    }
  }

  override backboneTraces(): TraceSubset<Residue>[] {
    const traces: TraceSubset<Residue>[] = [];
    this.eachBackboneTrace(function(trace) { traces.push(trace); });
    return traces;
  }

  full(): Chain { return this._chain; }

  name(): string { return this._chain.name(); }

  override structure(): unknown { return this._molView; }
}

export default {
  Chain : Chain,
  ChainView : ChainView
};
