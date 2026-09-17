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
import type { Bond } from './bond';

// Structural typing for Residue (mol/residue.ts, not yet converted): only
// what Atom/AtomView actually call on their owning residue.
interface AtomResidue {
  qualifiedName(): string;
  structure(): unknown;
}

abstract class AtomBase {
  abstract bonds(): Bond<AtomBase>[];
  abstract full(): AtomBase;
  abstract pos(): vec3;

  bondCount(): number { return this.bonds().length; }

  eachBond(callback: (bond: Bond<AtomBase>) => void): void {
    const bonds = this.bonds();
    for (let i = 0, e = bonds.length; i < e; ++i) {
      callback(bonds[i]!);
    }
  }

  isConnectedTo(otherAtom: AtomBase | null): boolean {
    if (otherAtom === null) {
      return false;
    }
    const other = otherAtom.full();
    const me = this.full();
    const bonds = this.bonds();
    for (let i = 0, e = bonds.length; i < e; ++i) {
      const bond = bonds[i]!;
      if ((bond.atom_one() === me && bond.atom_two() === other) ||
          (bond.atom_one() === other && bond.atom_two() === me)) {
        return true;
      }
    }
    return false;
  }
}

class Atom extends AtomBase {
  _properties: Record<string, unknown>;
  _residue: AtomResidue;
  _bonds: Bond<AtomBase>[];
  _isHetatm: boolean;
  _name: string;
  _pos: vec3;
  _index: number;
  _element: string;
  _occupancy: number | null;
  _tempFactor: number | null;
  _serial: number;

  constructor(
    residue: AtomResidue, name: string, pos: vec3, element: string,
    index: number, isHetatm?: boolean, occupancy?: number, tempFactor?: number,
    serial?: number,
  ) {
    super();
    this._properties = {};
    this._residue = residue;
    this._bonds = [];
    this._isHetatm = !!isHetatm;
    this._name = name;
    this._pos = pos;
    this._index = index;
    this._element = element;
    this._occupancy = occupancy !== undefined ? occupancy : null;
    this._tempFactor = tempFactor !== undefined ? tempFactor : null;
    this._serial = serial! | 0;
  }

  addBond(bond: Bond<AtomBase>): void {
    this._bonds.push(bond);
  }
  name(): string { return this._name; }
  bonds(): Bond<AtomBase>[] { return this._bonds; }
  residue(): AtomResidue { return this._residue; }
  structure(): unknown { return this._residue.structure(); }
  full(): Atom { return this; }
  qualifiedName(): string {
    return this.residue().qualifiedName() + '.' + this.name();
  }
  pos(): vec3 { return this._pos; }

  setPos(pos: vec3): void {
    vec3.copy(this._pos, pos);
  }

  element(): string { return this._element; }
  index(): number { return this._index; }

  occupancy(): number | null { return this._occupancy; }

  tempFactor(): number | null { return this._tempFactor; }

  serial(): number { return this._serial; }

  isHetatm(): boolean {
    return this._isHetatm;
  }

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

class AtomView extends AtomBase {
  _resView: unknown;
  _atom: Atom;
  _bonds: Bond<AtomBase>[];

  constructor(resView: unknown, atom: Atom) {
    super();
    this._resView = resView;
    this._atom = atom;
    this._bonds = [];
  }

  full(): Atom { return this._atom; }
  name(): string { return this._atom.name(); }
  pos(): vec3 { return this._atom.pos(); }
  element(): string { return this._atom.element(); }
  residue(): unknown { return this._resView; }
  bonds(): Bond<AtomBase>[] { return this._atom.bonds(); }
  index(): number { return this._atom.index(); }
  occupancy(): number | null { return this._atom.occupancy(); }
  tempFactor(): number | null { return this._atom.tempFactor(); }
  serial(): number { return this._atom.serial(); }
  qualifiedName(): string {
    return this._atom.qualifiedName();
  }
  isHetatm(): boolean {
    return this._atom.isHetatm();
  }
  prop(propName: string): unknown {
    return this._atom.prop(propName);
  }
  setProp(propName: string, value: unknown): void {
    this._atom.setProp(propName, value);
  }
}

export default {
  Atom: Atom,
  AtomView: AtomView
};
