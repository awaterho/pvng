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
import atom from './atom';

const Atom = atom.Atom;
const AtomView = atom.AtomView;
type Atom = InstanceType<typeof Atom>;
type AtomView = InstanceType<typeof AtomView>;

// Structural typing for Chain/ChainView (mol/chain.ts, not yet converted):
// only what Residue/ResidueView actually call on their owning chain.
interface ResidueChain {
  residues(): unknown[];
  structure(): unknown;
  name(): string;
}

interface ResidueAtom {
  name(): string;
  pos(): vec3;
  index(): number;
  full(): unknown;
}

abstract class ResidueBase<A extends ResidueAtom> {
  protected _atoms!: A[];

  abstract name(): string;
  abstract num(): number;
  abstract insCode(): string;
  abstract chain(): unknown;

  isWater(): boolean {
    return this.name() === 'HOH' || this.name() === 'DOD';
  }

  eachAtom(callback: (atom: A, index: number) => boolean | void, index?: number): number | false {
    index = index ? index | 0 : 0;
    for (let i = 0; i < this._atoms.length; i += 1) {
      if (callback(this._atoms[i]!, index) === false) {
        return false;
      }
      index += 1;
    }
    return index;
  }

  qualifiedName(): string {
    const name = (this.chain() as ResidueChain).name() + '.' + this.name() + this.num();
    if (this.insCode() === '\0') {
      return name;
    }
    return name + this.insCode();
  }

  atom(index_or_name: string | number): A | null {
    if (typeof index_or_name === 'string') {
      for (let i = 0; i < this._atoms.length; ++i) {
        if (this._atoms[i]!.name() === index_or_name) {
          return this._atoms[i]!;
        }
      }
      return null;
    }
    if (index_or_name >= this._atoms.length || index_or_name < 0) {
      return null;
    }
    return this._atoms[index_or_name]!;
  }

  // CA for amino acids, P for nucleotides, nucleosides
  centralAtom(): A | null {
    if (this.isAminoacid()) {
      return this.atom('CA');
    }
    if (this.isNucleotide()) {
      return this.atom('C3\'');
    }
    return null;
  }


  center(): vec3 {
    let count = 0;
    const c = vec3.create();
    this.eachAtom(function(atom) {
      vec3.add(c, c, atom.pos());
      count += 1;
    });
    if (count > 0) {
      vec3.scale(c, c, 1.0/count);
    }
    return c;
  }

  abstract isAminoacid(): boolean;
  abstract isNucleotide(): boolean;
}

class Residue extends ResidueBase<Atom> {
  _name: string;
  _num: number;
  _insCode: string;
  _ss: string;
  _chain: ResidueChain;
  _isAminoacid: boolean;
  _isNucleotide: boolean;
  _index: number;
  _properties: Record<string, unknown>;

  constructor(chain: ResidueChain, name: string, num: number, insCode: string) {
    super();
    this._name = name;
    this._num = num;
    this._insCode = insCode;
    this._atoms = [];
    this._ss = 'C';
    this._chain = chain;
    this._isAminoacid = false;
    this._isNucleotide = false;
    this._index = chain.residues().length;
    this._properties = {};
  }

  _deduceType(): void {
    this._isNucleotide = this.atom('P') !== null && this.atom('C3\'') !== null;
    this._isAminoacid = this.atom('N') !== null && this.atom('CA') !== null &&
                        this.atom('C') !== null && this.atom('O') !== null;
  }

  name(): string { return this._name; }
  insCode(): string { return this._insCode; }

  num(): number { return this._num; }

  full(): Residue { return this; }

  addAtom(
    name: string, pos: vec3, element: string, isHetatm?: boolean,
    occupancy?: number, tempFactor?: number, serial?: number,
  ): Atom {
    const atomIndex = (this.structure() as { nextAtomIndex(): number }).nextAtomIndex();
    const newAtom = new Atom(this, name, pos, element,
                        atomIndex,
                        isHetatm, occupancy, tempFactor, serial! | 0);
    this._atoms.push(newAtom);
    return newAtom;
  }

  ss(): string { return this._ss; }
  setSS(ss: string): void { this._ss = ss; }
  index(): number { return this._index; }

  atoms(): Atom[] { return this._atoms; }
  chain(): ResidueChain { return this._chain; }


  structure(): unknown {
    return this._chain.structure();
  }

  isAminoacid(): boolean { return this._isAminoacid; }
  isNucleotide(): boolean { return this._isNucleotide; }

  prop(propName: string): unknown {
    const fn = (this as unknown as Record<string, (() => unknown) | undefined>)[propName];
    if (fn !== undefined) {
      return fn.call(this);
    }
    const property = this._properties[propName];
    return property === undefined ? 0 : property;
  }

  setProp(propName: string, value: unknown): void {
    this._properties[propName] = value;
  }
}

class ResidueView extends ResidueBase<AtomView> {
  _chainView: unknown;
  _residue: Residue;

  constructor(chainView: unknown, residue: Residue) {
    super();
    this._chainView = chainView;
    this._atoms = [];
    this._residue = residue;
  }

  addAtom(atom: Atom | AtomView, checkDuplicates?: boolean): AtomView {
    if (checkDuplicates) {
      for (let i = 0; i < this._atoms.length; ++i) {
        const ai = this._atoms[i]!;
        if (ai.index() === atom.index()) {
          return ai;
        }
      }
    }
    const atomView = new AtomView(this, atom.full() as Atom);
    this._atoms.push(atomView);
    return atomView;
  }

  removeAtom(atom: ResidueAtom): boolean {
    const lengthBefore = this._atoms.length;
    this._atoms = this._atoms.filter(function(a) {
      return a.index() !== atom.index();
    });
    return lengthBefore !== this._atoms.length;
  }

  full(): Residue { return this._residue; }
  num(): number { return this._residue.num(); }

  insCode(): string {
    return this._residue.insCode();
  }
  ss(): string { return this._residue.ss(); }
  index(): number { return this._residue.index(); }
  chain(): unknown { return this._chainView; }
  name(): string { return this._residue.name(); }

  atoms(): AtomView[] { return this._atoms; }
  override qualifiedName(): string {
    return this._residue.qualifiedName();
  }

  containsResidue(residue: { full(): unknown }): boolean {
    return this._residue.full() === residue.full();
  }
  isAminoacid(): boolean {
    return this._residue.isAminoacid();
  }
  isNucleotide(): boolean {
    return this._residue.isNucleotide();
  }
  override isWater(): boolean {
    return this._residue.isWater();
  }
  prop(propName: string): unknown {
    return this._residue.prop(propName);
  }
  setProp(propName: string, value: unknown): void {
    this._residue.setProp(propName, value);
  }
}

export default {
  ResidueView : ResidueView,
  Residue : Residue
};
