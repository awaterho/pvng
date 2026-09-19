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
import { vec3, mat3 } from 'gl-matrix';
import svd from '../svd';

// Structural typing for the mol data model (Mol/MolView/Chain/Residue/Atom):
// superpose() and the matchResidues* helpers work polymorphically over
// either a full structure or a view, so these describe just what's used
// rather than importing the concrete classes.
interface SPAtom {
  name(): string;
  pos(): vec3;
  setPos(pos: vec3): void;
}
interface SPResidue {
  num(): number;
  atoms(): SPAtom[];
}
interface SPChain {
  name(): string;
  residues(): SPResidue[];
  residueByRnum(num: number): SPResidue | null;
}
interface SPStructureView {
  addChain(chain: SPChain): SPChainView;
}
interface SPChainView {
  addResidue(residue: SPResidue): SPResidueView;
}
interface SPResidueView {
  addAtom(atom: SPAtom): void;
}
interface SPStructure {
  atoms(): SPAtom[];
  chains(): SPChain[];
  full(): { atoms(): SPAtom[]; createEmptyView(): SPStructureView };
}

const calculateCenter = function(atoms: SPAtom[], center: vec3): void {
  vec3.set(center, 0, 0, 0);
  if (atoms.length === 0) {
    return;
  }
  for (let i = 0; i < atoms.length; ++i) {
    const atom = atoms[i]!;
    vec3.add(center, center, atom.pos());
  }
  vec3.scale(center, center, 1.0/atoms.length);
};


// calculate a covariance matrix from the deviations of the atoms of the subject
// and reference structure.
const calculateCov = (function() {
  const shiftedSubject = vec3.create();
  const shiftedReference = vec3.create();
  return function(
    subjectAtoms: SPAtom[], referenceAtoms: SPAtom[], subjectCenter: vec3,
    referenceCenter: vec3, covariance: mat3,
  ): void {
    covariance[0] = 0; covariance[1] = 0; covariance[2] = 0;
    covariance[3] = 0; covariance[4] = 0; covariance[5] = 0;
    covariance[6] = 0; covariance[7] = 0; covariance[8] = 0;
    for (let i = 0; i < referenceAtoms.length; ++i) {
      vec3.sub(shiftedSubject, subjectAtoms[i]!.pos(), subjectCenter);
      vec3.sub(shiftedReference, referenceAtoms[i]!.pos(), referenceCenter);

      const ss = shiftedSubject;
      const sr = shiftedReference;
      covariance[0] += ss[0] * sr[0];
      covariance[1] += ss[0] * sr[1];
      covariance[2] += ss[0] * sr[2];

      covariance[3] += ss[1] * sr[0];
      covariance[4] += ss[1] * sr[1];
      covariance[5] += ss[1] * sr[2];

      covariance[6] += ss[2] * sr[0];
      covariance[7] += ss[2] * sr[1];
      covariance[8] += ss[2] * sr[2];
    }
  };
})();

const superpose = (function() {
  const referenceCenter = vec3.create();
  const subjectCenter = vec3.create();
  const shiftedPos = vec3.create();
  const rotation = mat3.create();
  const cov = mat3.create();
  const tmp = mat3.create();
  const uMat = mat3.create();
  const vMat = mat3.create();
  return function(structure: SPStructure, reference: SPStructure): boolean {
    const subjectAtoms = structure.atoms();
    const referenceAtoms = reference.atoms();
    calculateCenter(referenceAtoms, referenceCenter);
    calculateCenter(subjectAtoms, subjectCenter);
    if (subjectAtoms.length !== referenceAtoms.length) {
      console.error('atom counts do not match (' +
                    subjectAtoms.length + 'in structure vs ' +
                    referenceAtoms.length + ' in reference)');
      return false;
    }
    if (subjectAtoms.length < 3) {
      console.error('at least 3 atoms are required for superposition') ;
      return false;
    }
    calculateCov(subjectAtoms, referenceAtoms, subjectCenter,
                 referenceCenter, cov);
    // the SVD implementation assumes nested arrays as inputs instead of linear
    // arrays of length 9, so we need to convert between the two formats.
    const input = [
      [ cov[0], cov[1], cov[2] ],
      [ cov[3], cov[4], cov[5] ],
      [ cov[6], cov[7], cov[8] ]
    ];
    const decomp = svd(input);
    uMat[0] = decomp.U[0]![0]!;
    uMat[1] = decomp.U[0]![1]!;
    uMat[2] = decomp.U[0]![2]!;
    uMat[3] = decomp.U[1]![0]!;
    uMat[4] = decomp.U[1]![1]!;
    uMat[5] = decomp.U[1]![2]!;
    uMat[6] = decomp.U[2]![0]!;
    uMat[7] = decomp.U[2]![1]!;
    uMat[8] = decomp.U[2]![2]!;
    const detU = mat3.determinant(uMat);
    vMat[0] = decomp.V[0]![0]!;
    vMat[1] = decomp.V[0]![1]!;
    vMat[2] = decomp.V[0]![2]!;
    vMat[3] = decomp.V[1]![0]!;
    vMat[4] = decomp.V[1]![1]!;
    vMat[5] = decomp.V[1]![2]!;
    vMat[6] = decomp.V[2]![0]!;
    vMat[7] = decomp.V[2]![1]!;
    vMat[8] = decomp.V[2]![2]!;
    const detV = mat3.determinant(vMat);
    mat3.identity(tmp);
    // in case the products of the determinant are smaller than zero, flip
    // one of the axis. If we don't do this, the resulting matrix is not a
    // rotation but a mirroring.
    if (detU * detV < 0.0) {
      tmp[8] = -1;
      mat3.mul(uMat, uMat, tmp);
    }
    mat3.mul(rotation, mat3.transpose(vMat, vMat), uMat);
    //mat3.transpose(rotation, rotation);
    // apply transformation to all atoms
    const allAtoms = structure.full().atoms();
    for (let i = 0; i < allAtoms.length; ++i) {
      const atom = allAtoms[i]!;
      vec3.sub(shiftedPos, atom.pos(), subjectCenter);
      vec3.transformMat3(shiftedPos, shiftedPos, rotation);
      vec3.add(shiftedPos, referenceCenter, shiftedPos);
      atom.setPos(shiftedPos);
    }
    return true;
  };
})();


type AtomNameSet = Record<string, boolean> | null;

// Parses different representations of a list of atom names and returns a
// set (a dictionary actually with elements contained in the set set to
// true) that describes the list.
//
//  * undefined/null to null. This translates to match any atom
//  * 'all' to null
//  * 'backbone' to { 'N', 'CA', 'C', 'O' }
//  * 'aname1, aname2' to { 'aname1', 'aname2' }
//  * ['aname1', 'aname2']  to  { 'aname1', 'aname2' }
function parseAtomNames(atoms?: string | string[] | null): AtomNameSet {
  if (atoms === undefined || atoms === null || atoms === 'all') {
    return null;
  }
  if (atoms === 'backbone') {
    return { 'CA' : true, 'C' : true, 'O' : true, 'N' : true };
  }
  if (typeof atoms === 'string') {
    const results: Record<string, boolean> = {};
    const atomNames = atoms.split(',');
    for (let i = 0; i < atomNames.length; ++i) {
      results[atomNames[i]!.trim()] = true;
    }
    return results;
  } else {
    const results: Record<string, boolean> = {};
    for (let i = 0; i < atoms.length; ++i) {
      results[atoms[i]!] = true;
    }
    return results;
  }
}

function addAtomsPresentInBoth(
  inA: SPResidue, inB: SPResidue, outA: SPAtom[], outB: SPAtom[], atomSet: AtomNameSet
): void {
  const atomsA = inA.atoms();
  const atomsB = inB.atoms();
  for (let i = 0; i < atomsA.length; ++i) {
    const atomA = atomsA[i]!;
    if (atomSet !== null && atomSet[atomA.name()] !== true) {
      continue;
    }
    for (let j = 0; j < atomsB.length; ++j) {
      const atomB = atomsB[j]!;
      if (atomB.name() === atomA.name()) {
        outA.push(atomA);
        outB.push(atomB);
        break;
      }
    }
  }
}

function matchResidues(
  inA: SPStructure, inB: SPStructure, atoms: string | string[] | undefined,
  matchFn: (chainA: SPChain, chainB: SPChain) => [SPResidue[], SPResidue[]],
): [SPStructureView, SPStructureView] | null {
  const outA = inA.full().createEmptyView();
  const outB = inB.full().createEmptyView();
  const numChains = Math.min(inA.chains().length, inB.chains().length);
  const atomSet = parseAtomNames(atoms);

  for (let i = 0; i < numChains; ++i) {
    const chainA = inA.chains()[i]!;
    const chainB = inB.chains()[i]!;
    const matchedResidues = matchFn(chainA, chainB);
    const residuesA = matchedResidues[0];
    const residuesB = matchedResidues[1];
    if (residuesA.length !== residuesB.length) {
      console.error('chains', chainA.name(), ' and', chainB.name(),
                    ' do not contain the same number of residues.');
      return null;
    }

    const outChainA = outA.addChain(chainA);
    const outChainB = outB.addChain(chainB);
    for (let j = 0; j < residuesA.length; ++j) {
      const residueA = residuesA[j]!;
      const residueB = residuesB[j]!;
      const outAtomsA: SPAtom[] = [], outAtomsB: SPAtom[] = [];
      addAtomsPresentInBoth(residueA, residueB, outAtomsA, outAtomsB, atomSet);
      if (outAtomsA.length === 0) {
        continue;
      }
      const outResidueA = outChainA.addResidue(residueA);
      const outResidueB = outChainB.addResidue(residueB);
      for (let k = 0; k < outAtomsA.length; ++k) {
        outResidueA.addAtom(outAtomsA[k]!);
        outResidueB.addAtom(outAtomsB[k]!);
      }
    }
  }
  return [outA, outB];
}

function matchResiduesByIndex(
  inA: SPStructure, inB: SPStructure, atoms?: string | string[]
): [SPStructureView, SPStructureView] | null {
  return matchResidues(inA, inB, atoms, function(chainA, chainB) {
    return [chainA.residues(), chainB.residues()];
  });
}

function matchResiduesByNum(
  inA: SPStructure, inB: SPStructure, atoms?: string | string[]
): [SPStructureView, SPStructureView] | null {
  return matchResidues(inA, inB, atoms, function(chainA, chainB) {
    const outA: SPResidue[] = [], outB: SPResidue[] = [];
    const residuesA = chainA.residues();
    for (let i = 0; i < residuesA.length; ++i) {
      const resB = chainB.residueByRnum(residuesA[i]!.num());
      if (resB !== null) {
        outA.push(residuesA[i]!);
        outB.push(resB);
      }
    }
    return [outA, outB];
  });
}

export default {
  superpose : superpose,
  matchResiduesByNum : matchResiduesByNum,
  matchResiduesByIndex : matchResiduesByIndex,
  parseAtomNames : parseAtomNames,
  addAtomsPresentInBoth : addAtomsPresentInBoth
};
