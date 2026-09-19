type Predicate<T> = (obj: T) => boolean;

// Structural (not yet real class-backed) typing for the mol data model:
// mol/atom.ts, mol/residue.ts, mol/chain.ts and mol/mol.ts are later tiers
// of the TS conversion, so these interfaces capture just what this module
// touches. Once those tiers land as real classes, Atom/Residue/Chain/Mol
// will satisfy these structurally without any changes needed here.
interface SelectAtom {
  name(): string;
  isHetatm(): boolean;
}

interface SelectResidue {
  name(): string;
  num(): number;
  ss(): string;
  atoms(): SelectAtom[];
}

interface BackboneTrace {
  residues(): SelectResidue[];
}

interface SelectChain {
  name(): string;
  residues(): SelectResidue[];
  residuesInRnumRange(start: number, end: number): SelectResidue[];
  backboneTraces(): BackboneTrace[];
}

interface SelectStructure {
  _chains: SelectChain[];
}

interface ResidueView {
  addAtom(atom: SelectAtom): void;
}

interface ChainView {
  addResidue(residue: SelectResidue, withAtoms?: boolean): ResidueView;
}

interface StructureView {
  addChain(chain: SelectChain, withResidues?: boolean): ChainView;
}

export interface SelectDict {
  aname?: string;
  anames?: string[];
  hetatm?: boolean;
  rname?: string;
  rnames?: string[];
  rnums?: number[];
  rnum?: number;
  rtype?: string;
  cname?: string;
  cnames?: string[];
  chain?: string;
  chains?: string[];
  rnumRange?: [number, number];
  rindexRange?: [number, number];
  rindices?: number[];
  rindex?: number;
}

function fulfillsPredicates<T>(obj: T, predicates: Predicate<T>[]): boolean {
  for (let i = 0; i < predicates.length; ++i) {
    if (!predicates[i]!(obj)) {
      return false;
    }
  }
  return true;
}

function _atomPredicates(dict: SelectDict): Predicate<SelectAtom>[] {
  const predicates: Predicate<SelectAtom>[] = [];
  if (dict.aname !== undefined) {
    predicates.push(function(a) { return a.name() === dict.aname; });
  }
  if (dict.hetatm !== undefined) {
    predicates.push(function(a) { return a.isHetatm() === dict.hetatm; });
  }
  if (dict.anames !== undefined) {
    predicates.push(function(a) {
      const n = a.name();
      for (let k = 0; k < dict.anames!.length; ++k) {
        if (n === dict.anames![k]) {
          return true;
        }
      }
      return false;
    });
  }
  return predicates;
}

// extracts the residue predicates from the dictionary.
// ignores rindices, rindexRange because they are handled separately.
function _residuePredicates(dict: SelectDict): Predicate<SelectResidue>[] {
  const predicates: Predicate<SelectResidue>[] = [];
  if (dict.rname !== undefined) {
    predicates.push(function(r) { return r.name() === dict.rname; });
  }
  if (dict.rnames !== undefined) {
    predicates.push(function(r) {
    const n = r.name();
    for (let k = 0; k < dict.rnames!.length; ++k) {
      if (n === dict.rnames![k]) {
          return true;
        }
      }
      return false;
    });
  }
  if (dict.rnums !== undefined) {
    const num_set: Record<number, boolean> = {};
    for (let i = 0; i < dict.rnums.length; ++i) {
      num_set[dict.rnums[i]!] = true;
    }
    predicates.push(function(r) {
      const n = r.num();
      return num_set[n] === true;
    });
  }
  if (dict.rnum !== undefined) {
    predicates.push(function(r) {
      return r.num() === dict.rnum;
    });
  }
  if (dict.rtype !== undefined) {
    predicates.push(function(r) {
      return r.ss() === dict.rtype;
    });
  }
  return predicates;
}

function _chainPredicates(dict: SelectDict): Predicate<SelectChain>[] {
  const predicates: Predicate<SelectChain>[] = [];
  if (dict.cname !== undefined) {
    dict.chain = dict.cname;
  }
  if (dict.cnames !== undefined) {
    dict.chains = dict.cnames;
  }
  if (dict.chain !== undefined) {
    predicates.push(function(c) { return c.name() === dict.chain; });
  }
  if (dict.chains !== undefined) {
    predicates.push(function(c) {
      const n = c.name();
      for (let k = 0; k < dict.chains!.length; ++k) {
        if (n === dict.chains![k]) {
          return true;
        }
      }
      return false;
    });
  }
  return predicates;
}


// handles all residue predicates that can be done through either index-
// based lookups, or optimized searches of some sorts.
function _filterResidues(chain: SelectChain, dict: SelectDict): SelectResidue[] {
  let residues = chain.residues();
  if (dict.rnumRange) {
    residues =
        chain.residuesInRnumRange(dict.rnumRange[0], dict.rnumRange[1]);
  }
  let selResidues: SelectResidue[] = [], i, e;
  if (dict.rindexRange !== undefined) {
    for (i = dict.rindexRange[0],
        e = Math.min(residues.length - 1, dict.rindexRange[1]);
        i <= e; ++i) {
      selResidues.push(residues[i]!);
    }
    return selResidues;
  }
  if (dict.rindices) {
    if (dict.rindices.length !== undefined) {
      selResidues = [];
      for (i = 0; i < dict.rindices.length; ++i) {
        selResidues.push(residues[dict.rindices[i]!]!);
      }
      return selResidues;
    }
  }
  return residues;
}

// helper function to perform selection by predicates
function dictSelect<V extends StructureView>(
  structure: SelectStructure, view: V, dict: SelectDict
): V {
  const residuePredicates = _residuePredicates(dict);
  const atomPredicates = _atomPredicates(dict);
  const chainPredicates = _chainPredicates(dict);

  if (dict.rindex) {
    dict.rindices = [dict.rindex];
  }
  for (let ci = 0; ci < structure._chains.length; ++ci) {
    const chain = structure._chains[ci]!;
    if (!fulfillsPredicates(chain, chainPredicates)) {
      continue;
    }
    const residues = _filterResidues(chain, dict);
    let chainView: ChainView | null = null;
    for (let ri = 0; ri < residues.length; ++ri) {
      if (!fulfillsPredicates(residues[ri]!, residuePredicates)) {
        continue;
      }
      if (!chainView) {
        chainView = view.addChain(chain, false);
      }
      let residueView: ResidueView | null = null;
      const atoms = residues[ri]!.atoms();
      for (let ai = 0; ai < atoms.length; ++ai) {
        if (!fulfillsPredicates(atoms[ai]!, atomPredicates)) {
          continue;
        }
        if (!residueView) {
          residueView = chainView.addResidue(residues[ri]!, false);
        }
        residueView.addAtom(atoms[ai]!);
      }
    }
  }
  return view;
}


function polymerSelect<V extends StructureView>(
  structure: SelectStructure, view: V
): V {
  for (let ci = 0; ci < structure._chains.length; ++ci) {
    const chain = structure._chains[ci]!;
    const traces = chain.backboneTraces();
    if (traces.length === 0) {
      continue;
    }
    const chainView = view.addChain(chain);
    for (let bi = 0; bi < traces.length; ++bi) {
      const residues = traces[bi]!.residues();
      for (let ri = 0; ri < residues.length; ++ri) {
        chainView.addResidue(residues[ri]!, true);
      }
    }
  }
  return view;
}

export default {
  dict : dictSelect,
  polymer : polymerSelect
};
