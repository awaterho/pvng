import type { SelectDict } from '../mol/select';
import type { MVSSelector, MVSSelectorObject } from './types';

// pv's select() takes either a SelectDict (ANDed predicates, see
// mol/select.ts) or one of a handful of special-cased strings ('protein',
// 'water', 'ligand', 'polymer'). MVS selector shorthands that line up with
// one of those are translated directly; the rest ('nucleic', 'branched',
// 'ion', 'coarse') have no pv equivalent and are reported as unsupported.
const SHORTHAND_TO_PV_SELECT: Partial<Record<string, 'protein' | 'water' | 'ligand' | 'polymer'>> = {
  polymer: 'polymer',
  protein: 'protein',
  water: 'water',
  ligand: 'ligand',
};

export type ResolvedSelector =
  | { kind: 'select-arg'; value: 'protein' | 'water' | 'ligand' | 'polymer' }
  | { kind: 'dicts'; value: SelectDict[]; warnings: string[] }
  | { kind: 'unsupported'; reason: string };

// fields of MVSSelectorObject pv's SelectDict has no equivalent for.
const UNSUPPORTED_OBJECT_FIELDS: (keyof MVSSelectorObject)[] = [
  'label_entity_id', 'type_symbol', 'atom_id', 'atom_index', 'instance_id',
];

function selectorObjectToDict(obj: MVSSelectorObject): { dict: SelectDict; warnings: string[] } {
  const dict: SelectDict = {};
  const warnings: string[] = [];

  const cname = obj.label_asym_id ?? obj.auth_asym_id;
  if (cname !== undefined) {
    dict.cname = cname;
  }
  const rname = obj.label_comp_id ?? obj.auth_comp_id;
  if (rname !== undefined) {
    dict.rname = rname;
  }
  const aname = obj.label_atom_id ?? obj.auth_atom_id;
  if (aname !== undefined) {
    dict.aname = aname;
  }
  const rnum = obj.label_seq_id ?? obj.auth_seq_id;
  if (rnum !== undefined) {
    dict.rnum = rnum;
  }
  const begRnum = obj.beg_label_seq_id ?? obj.beg_auth_seq_id;
  const endRnum = obj.end_label_seq_id ?? obj.end_auth_seq_id;
  if (begRnum !== undefined && endRnum !== undefined) {
    dict.rnumRange = [begRnum, endRnum];
  }
  if (obj.residue_index !== undefined) {
    // pv's rindex is 0-based and relative to the chain, whereas MVS's
    // residue_index is defined relative to the whole model -- only correct
    // for single-chain selections/structures. Documented v1 limitation.
    dict.rindex = obj.residue_index;
  }

  for (const field of UNSUPPORTED_OBJECT_FIELDS) {
    if (obj[field] !== undefined) {
      warnings.push(`selector field "${field}" has no pv equivalent and was ignored`);
    }
  }

  return { dict, warnings };
}

export function resolveSelector(selector: MVSSelector): ResolvedSelector {
  if (typeof selector === 'string') {
    if (selector === 'all') {
      return { kind: 'dicts', value: [{}], warnings: [] };
    }
    const pvSelect = SHORTHAND_TO_PV_SELECT[selector];
    if (pvSelect !== undefined) {
      return { kind: 'select-arg', value: pvSelect };
    }
    return { kind: 'unsupported', reason: `selector shorthand "${selector}" has no pv equivalent` };
  }

  const objects = Array.isArray(selector) ? selector : [selector];
  if (objects.length === 0) {
    return { kind: 'unsupported', reason: 'empty selector list' };
  }
  const dicts: SelectDict[] = [];
  const warnings: string[] = [];
  for (const obj of objects) {
    const resolved = selectorObjectToDict(obj);
    dicts.push(resolved.dict);
    warnings.push(...resolved.warnings);
  }
  return { kind: 'dicts', value: dicts, warnings };
}
