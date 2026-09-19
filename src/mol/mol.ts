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
import chainModule from './chain';
import bondModule, { type Bond } from './bond';
import select from './select';
import type { Assembly } from './symmetry';

const Chain = chainModule.Chain;
const ChainView = chainModule.ChainView;
type Chain = InstanceType<typeof Chain>;
type ChainView = InstanceType<typeof ChainView>;
const BondCtor = bondModule.Bond;

// Structural typing threaded through MolBase<C>: Chain and ChainView both
// satisfy this (see mol/chain.ts) without needing to reference them
// directly, avoiding a second layer of generics for the residue/atom types
// nested inside.
interface MolChain {
  eachResidue(callback: (residue: unknown) => boolean | void): boolean | void;
  eachAtom(callback: (atom: unknown, index: number) => boolean | void, index?: number): number | false;
  residues(): { atoms(): { length: number }; isAminoacid(): boolean; isWater(): boolean }[];
  atomCount(): number;
  backboneTraces(): unknown[];
  name(): string;
  full(): unknown;
}

interface MolAtomLike {
  pos(): vec3;
}

// atom covalent radii by element derived from Cambrige Structural Database.
// Source: http://profmokeur.ca/chemistry/covalent_radii.htm
const ELEMENT_COVALENT_RADII: Record<string, number> = {
 H : 0.31, HE : 0.28, LI : 1.28, BE : 0.96,  B : 0.84,  C : 0.76,  N : 0.71,
 O : 0.66,  F : 0.57, NE : 0.58, NA : 1.66, MG : 1.41, AL : 1.21, SI : 1.11,
 P : 1.07,  S : 1.05, CL : 1.02, AR : 1.06,  K : 2.03, CA : 1.76, SC : 1.70,
TI : 1.60,  V : 1.53, CR : 1.39, MN : 1.39, FE : 1.32, CO : 1.26, NI : 1.24,
CU : 1.32, ZN : 1.22, GA : 1.22, GE : 1.20, AS : 1.19, SE : 1.20, BR : 1.20,
KR : 1.16, RB : 2.20, SR : 1.95,  Y : 1.90, ZR : 1.75, NB : 1.64, MO : 1.54,
TC : 1.47, RU : 1.46, RH : 1.42, PD : 1.39, AG : 1.45, CD : 1.44, IN : 1.42,
SN : 1.39, SB : 1.39, TE : 1.38,  I : 1.39, XE : 1.40, CS : 2.44, BA : 2.15,
LA : 2.07, CE : 2.04, PR : 2.03, ND : 2.01, PM : 1.99, SM : 1.98, EU : 1.98,
GD : 1.96, TB : 1.94, DY : 1.92, HO : 1.92, ER : 1.89, TM : 1.90, YB : 1.87,
LU : 1.87, HF : 1.75, TA : 1.70,  W : 1.62, RE : 1.51, OS : 1.44, IR : 1.41,
PT : 1.36, AU : 1.36, HG : 1.32, TL : 1.45, PB : 1.46, BI : 1.48, PO : 1.40,
AT : 1.50, RN : 1.50, FR : 2.60, RA : 2.21, AC : 2.15, TH : 2.06, PA : 2.00,
 U : 1.96, NP : 1.90, PU : 1.87, AM : 1.80, CM : 1.69
};

function covalentRadius(ele: string): number {
  const r = ELEMENT_COVALENT_RADII[ele.toUpperCase()];
  if (r !== undefined) {
    return r;
  }
  return 1.5;
}

interface ConnectableResidue {
  atom(name: string): (MolAtomLike & { isConnectedTo?(o: unknown): boolean }) | null;
  isAminoacid(): boolean;
  isNucleotide(): boolean;
}

interface ConnectableStructure {
  connect(a: unknown, b: unknown): unknown;
}

function connectPeptides(structure: ConnectableStructure, left: ConnectableResidue, right: ConnectableResidue): void {
  const cAtom = left.atom('C');
  const nAtom = right.atom('N');
  if (cAtom && nAtom) {
    const sqrDist = vec3.sqrDist(cAtom.pos(), nAtom.pos());
    if (sqrDist < 1.6*1.6) {
      structure.connect(nAtom, cAtom);
    }
  }
}

function connectNucleotides(structure: ConnectableStructure, left: ConnectableResidue, right: ConnectableResidue): void {
  const o3Prime = left.atom('O3\'');
  const pAtom = right.atom('P');
  if (o3Prime && pAtom) {
    const sqrDist = vec3.sqrDist(o3Prime.pos(), pAtom.pos());
    // FIXME: make sure 1.7 is a good threshold here...
    if (sqrDist < 1.7*1.7) {
      structure.connect(o3Prime, pAtom);
    }
  }
}

abstract class MolBase<C extends MolChain> {
  protected _chains!: C[];

  abstract chains(): C[];
  abstract full(): unknown;

  eachResidue(callback: (residue: unknown) => boolean | void): boolean | void {
    for (let i = 0; i < this._chains.length; i+=1) {
      if (this._chains[i]!.eachResidue(callback) === false) {
        return false;
      }
    }
  }

  eachAtom(callback: (atom: unknown, index: number) => boolean | void, index?: number): boolean | void {
    index = index ? index | 0 : 0;
    for (let i = 0; i < this._chains.length; i+=1) {
      const result = this._chains[i]!.eachAtom(callback, index);
      if (result === false) {
        return false;
      }
      index = result;
    }
  }

  residueCount(): number {
    const chains = this.chains();
    let count = 0;
    for (let ci = 0; ci < chains.length; ++ci) {
      count += chains[ci]!.residues().length;
    }
    return count;
  }

  eachChain(callback: (chain: C) => boolean | void): void {
    const chains = this.chains();
    for (let i = 0; i < chains.length; ++i) {
      if (callback(chains[i]!) === false) {
        return;
      }
    }
  }

  atomCount(): number {
    const chains = this.chains();
    let count = 0;
    for (let ci = 0; ci < chains.length; ++ci) {
      count += chains[ci]!.atomCount();
    }
    return count;
  }

  atoms(): unknown[] {
    const atoms: unknown[] = [];
    this.eachAtom(function(atom) { atoms.push(atom); });
    return atoms;
  }

  atom(name: string): unknown {
    const parts = name.split('.');
    const chain = (this as unknown as { chain(n: string): { residueByRnum(n: number): { atom(n: string): unknown } | null } | null }).chain(parts[0]!);
    if (chain === null) {
      return null;
    }
    const residue = chain.residueByRnum(parseInt(parts[1]!, 10));
    if (residue === null) {
      return null;
    }
    return residue.atom(parts[2]!);
  }

  center(): vec3 {
    const sum = vec3.create();
    let count = 0;
    this.eachAtom(function(atom) {
      vec3.add(sum, sum, (atom as MolAtomLike).pos());
      count+=1;
    });
    if (count) {
      vec3.scale(sum, sum, 1/count);
    }
    return sum;
  }

  // returns a sphere containing all atoms part of this structure. This will
  // not calculate the minimal bounding sphere, just a good-enough
  // approximation.
  boundingSphere(): InstanceType<typeof geom.Sphere> {
    const center = this.center();
    let radiusSquare = 0.0;
    this.eachAtom(function(atom) {
      radiusSquare = Math.max(radiusSquare, vec3.sqrDist(center, (atom as MolAtomLike).pos()));
    });
    return new geom.Sphere(center, Math.sqrt(radiusSquare));
  }

  // returns all backbone traces of all chains of this structure
  backboneTraces(): unknown[] {
    const chains = this.chains();
    const traces: unknown[] = [];
    for (let i = 0; i < chains.length; ++i) {
      Array.prototype.push.apply(traces, chains[i]!.backboneTraces());
    }
    return traces;
  }


  select(what?: string | Record<string, unknown>): unknown {

    if (what === 'protein') {
      return this.residueSelect(function(r) { return (r as { isAminoacid(): boolean }).isAminoacid(); });
    }
    if (what === 'water') {
      return this.residueSelect(function(r) { return (r as { isWater(): boolean }).isWater(); });
    }
    if (what === 'ligand') {
      return this.residueSelect(function(r) {
        const res = r as { isAminoacid(): boolean; isWater(): boolean };
        return !res.isAminoacid() && !res.isWater();
      });
    }
    if (what === 'polymer') {
      return select.polymer(this as never, new MolView(this as never) as never);
    }
    // when what is not one of the simple strings above, we assume what
    // is a dictionary containing predicates which have to be fulfilled.
    return select.dict(this as never, new MolView(this as never) as never, (what || {}) as never);
  }


  residueSelect(predicate: (residue: unknown) => boolean): MolView {
    const view = new MolView(this.full() as Mol);
    for (let ci = 0; ci < this._chains.length; ++ci) {
      const chain = this._chains[ci]!;
      let chainView: ReturnType<ChainView['addResidue']> extends never ? never : ReturnType<MolView['addChain']> | null = null;
      const residues = chain.residues();
      for (let ri = 0; ri < residues.length; ++ri) {
        if (predicate(residues[ri])) {
          if (!chainView) {
            chainView = view.addChain(chain as never, false);
          }
          chainView.addResidue(residues[ri] as never, true);
        }
      }
    }
    return view;
  }

  atomSelect(predicate: (atom: unknown) => boolean): MolView {
    const view = new MolView(this.full() as Mol);
    for (let ci = 0; ci < this._chains.length; ++ci) {
      const chain = this._chains[ci]!;
      let chainView: ReturnType<MolView['addChain']> | null = null;
      const residues = chain.residues();
      for (let ri = 0; ri < residues.length; ++ri) {
        let residueView: ReturnType<ReturnType<MolView['addChain']>['addResidue']> | null = null;
        const residue = residues[ri]! as unknown as { atoms(): unknown[] };
        const atoms = residue.atoms();
        for (let ai = 0; ai < atoms.length; ++ai) {
          if (!predicate(atoms[ai])) {
            continue;
          }
          if (!chainView) {
            chainView = view.addChain(chain as never, false);
          }
          if (!residueView) {
            residueView = chainView.addResidue(residue as never, false);
          }
          residueView.addAtom(atoms[ai] as never);
        }
      }
    }
    return view;
  }



  assembly(id: string): Assembly | null {
    const assemblies = (this as unknown as { assemblies(): Assembly[] }).assemblies();
    for (let i = 0; i < assemblies.length; ++i) {
      if (assemblies[i]!.name() === id) {
        return assemblies[i]!;
      }
    }
    return null;
  }

  chainsByName(chainNames: string[]): C[] {
    // build a map to avoid O(n^2) behavior. That's overkill when the list
    // of names is short but should give better performance when requesting
    // multiple chains.
    const chainMap: Record<string, C> = { };
    const chains = this.chains();
    for (let i = 0; i < chains.length; ++i) {
      chainMap[chains[i]!.name()] = chains[i]!;
    }
    const filteredChains: C[] = [];
    for (let j = 0; j < chainNames.length; ++j) {
      const filteredChain = chainMap[chainNames[j]!];
      if (filteredChain !== undefined) {
        filteredChains.push(filteredChain);
      }
    }
    return filteredChains;
  }

  selectWithin = (function() {
    const dist = vec3.create();
    return function(
      this: MolBase<C>,
      mol: { eachAtom(cb: (a: MolAtomLike) => void): void },
      options?: { radius?: number; matchResidues?: boolean },
    ): MolView {
      options = options || {};
      const radius = options.radius || 4.0;
      const radiusSqr = radius * radius;
      const matchResidues = !!options.matchResidues;
      const targetAtoms: MolAtomLike[] = [];
      mol.eachAtom(function(a) { targetAtoms.push(a); });

      const view = new MolView(this.full() as Mol);
      let addedRes: ReturnType<ReturnType<MolView['addChain']>['addResidue']> | null = null;
      let addedChain: ReturnType<MolView['addChain']> | null = null;
      const chains = this.chains();
      let skipResidue = false;
      for (let ci = 0; ci < chains.length; ++ci) {
        const residues = chains[ci]!.residues() as unknown as {
          atoms(): (MolAtomLike & { full(): unknown })[]; full(): unknown;
        }[];
        addedChain = null;
        for (let ri = 0; ri < residues.length; ++ri) {
          addedRes = null;
          skipResidue = false;
          const atoms = residues[ri]!.atoms();
          for (let ai = 0; ai < atoms.length; ++ai) {
            if (skipResidue) {
              break;
            }
            for (let wi = 0; wi < targetAtoms.length; ++wi) {
              vec3.sub(dist, atoms[ai]!.pos(), targetAtoms[wi]!.pos());
              if (vec3.sqrLen(dist) > radiusSqr) {
                continue;
              }
              if (!addedChain) {
                addedChain = view.addChain(chains[ci]!.full() as never, false);
              }
              if (!addedRes) {
                addedRes =
                    addedChain.addResidue(residues[ri]!.full() as never, matchResidues);
              }
              if (matchResidues) {
                skipResidue = true;
                break;
              }
              addedRes.addAtom(atoms[ai]!.full() as never);
              break;
            }
          }
        }
      }
      return view;
    };
  })();

  createEmptyView(): MolView {
    return new MolView(this.full() as Mol);
  }
}

class Mol extends MolBase<Chain> {
  _assemblies: Assembly[];
  _nextAtomIndex: number;

  constructor() {
    super();
    this._chains = [];
    this._assemblies = [];
    this._nextAtomIndex = 0;
  }

  addAssembly(assembly: Assembly): void {
    this._assemblies.push(assembly);
  }

  setAssemblies(assemblies: Assembly[]): void {
    this._assemblies = assemblies;
  }

  assemblies(): Assembly[] { return this._assemblies; }

  chains(): Chain[] { return this._chains; }

  full(): Mol { return this; }

  containsResidue(residue: { full(): { structure(): unknown } }): boolean {
    return residue.full().structure() === this;
  }

  chainByName(name: string): Chain | null {
    for (let i = 0; i < this._chains.length; ++i) {
      if (this._chains[i]!.name() === name) {
        return this._chains[i]!;
      }
    }
    return null;
  }

  // for backwards compatibility
  chain(name: string): Chain | null {
    return this.chainByName(name);
  }

  nextAtomIndex(): number {
    const nextIndex = this._nextAtomIndex;
    this._nextAtomIndex+=1;
    return nextIndex;
  }

  addChain(name: string): Chain {
    const chain = new Chain(this, name);
    this._chains.push(chain);
    return chain;
  }


  connect(atom_a: never, atom_b: never): Bond {
    const bond = BondCtor(atom_a, atom_b);
    (atom_a as unknown as { addBond(b: unknown): void }).addBond(bond);
    (atom_b as unknown as { addBond(b: unknown): void }).addBond(bond);
    return bond as unknown as Bond;
  }



  // determine connectivity structure. for simplicity only connects atoms of the
  // same residue, peptide bonds and nucleotides
  deriveConnectivity(): void {
    let prevResidue: (ConnectableResidue & { _deduceType(): void; isAminoacid(): boolean; isNucleotide(): boolean }) | null = null;
    this.eachResidue((res) => {
      const residue = res as ConnectableResidue & {
        _deduceType(): void; atoms(): (MolAtomLike & { element(): string })[];
      };
      let sqrDist;
      const atoms = residue.atoms();
      const numAtoms = atoms.length;
      for (let i = 0; i < numAtoms; i+=1) {
        const atomI = atoms[i]!;
        const posI = atomI.pos();
        const covalentI = covalentRadius(atomI.element());
        for (let j = 0; j < i; j+=1) {
          const atomJ = atoms[j]!;
          const covalentJ = covalentRadius(atomJ.element());
          sqrDist = vec3.sqrDist(posI, atomJ.pos());
          const lower = covalentI+covalentJ-0.30;
          const upper = covalentI+covalentJ+0.30;
          if (sqrDist < upper*upper && sqrDist > lower*lower) {
            this.connect(atomI as never, atomJ as never);
          }
        }
      }
      residue._deduceType();
      if (prevResidue !== null) {
        if (residue.isAminoacid() && prevResidue.isAminoacid()) {
          connectPeptides(this, prevResidue, residue);
        }
        if (residue.isNucleotide() && prevResidue.isNucleotide()) {
          connectNucleotides(this, prevResidue, residue);
        }
      }
      prevResidue = residue;
    });
  }
}

class MolView extends MolBase<ChainView> {
  _mol: Mol;

  constructor(mol: Mol) {
    super();
    this._mol = mol;
    this._chains = [];
  }

  full(): Mol { return this._mol; }

  assemblies(): Assembly[] { return this._mol.assemblies(); }

  // add chain to view
  addChain(chain: { full(): Chain; residues(): unknown[] }, recurse?: boolean): ChainView {
    const chainView = new ChainView(this as never, chain.full());
    this._chains.push(chainView);
    if (recurse) {
      const residues = chain.residues();
      for (let i = 0; i< residues.length; ++i) {
        chainView.addResidue(residues[i] as never, true);
      }
    }
    return chainView;
  }

  addAtom(atom: { residue(): { chain(): { name(): string; full(): Chain; residues(): unknown[] } } }): unknown {
    let chain = this.chain(atom.residue().chain().name());
    if (chain === null) {
      chain = this.addChain(atom.residue().chain());
    }
    return (chain as unknown as { addAtom(a: unknown): unknown }).addAtom(atom);
  }

  removeAtom(
    atom: { residue(): { chain(): { name(): string } } } | null,
    removeEmptyResiduesAndChains?: boolean,
  ): boolean {
    if (atom === null) {
      return false;
    }
    const chain = this.chain(atom.residue().chain().name());
    if (chain === null) {
      return false;
    }
    const removed = (chain as unknown as { removeAtom(a: unknown, b?: boolean): boolean }).removeAtom(
      atom, removeEmptyResiduesAndChains
    );
    if (removed && chain.residues().length === 0) {
      this._chains = this._chains.filter(function(c) {
        return c !== chain;
      });
    }
    return removed;
  }

  containsResidue(residue: { chain(): { name(): string } } | null): boolean {
    if (!residue) {
      return false;
    }
    const chain = this.chain(residue.chain().name());
    if (!chain) {
      return false;
    }
    return (chain as unknown as { containsResidue(r: unknown): boolean }).containsResidue(residue);
  }

  addResidues(
    residues: { chain(): { name(): string; full(): Chain; residues(): unknown[] } }[], recurse?: boolean
  ): Record<string, ChainView> {
    const chainsViews: Record<string, ChainView> = {};
    residues.forEach((residue) => {
      const chainName = residue.chain().name();
      if (typeof chainsViews[chainName] === 'undefined') {
        chainsViews[chainName] = this.addChain(residue.chain(), false);
      }
      chainsViews[chainName]!.addResidue(residue as never, recurse);
    });
    return chainsViews;
  }


  chains(): ChainView[] { return this._chains; }

  chain(name: string): ChainView | null {
    for (let i = 0; i < this._chains.length; ++i) {
      if (this._chains[i]!.name() === name) {
        return this._chains[i]!;
      }
    }
    return null;
  }
}

export default {
  MolView : MolView,
  Mol : Mol
};
