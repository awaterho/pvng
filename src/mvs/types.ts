// Minimal subset of the MolViewSpec (MVS) JSON tree schema that pv's MVS
// adapter understands. See https://molstar.org/mol-view-spec-docs/ for the
// full schema -- node kinds and params not listed here (label, focus,
// camera, canvas, *_from_uri, *_from_source, multi-state/animation) are not
// yet supported; loadMVS() reports them as warnings rather than silently
// ignoring them.

export interface MVSSelectorObject {
  label_entity_id?: string;
  label_asym_id?: string;
  auth_asym_id?: string;
  label_seq_id?: number;
  auth_seq_id?: number;
  beg_label_seq_id?: number;
  end_label_seq_id?: number;
  beg_auth_seq_id?: number;
  end_auth_seq_id?: number;
  label_comp_id?: string;
  auth_comp_id?: string;
  residue_index?: number;
  label_atom_id?: string;
  auth_atom_id?: string;
  type_symbol?: string;
  atom_id?: number;
  atom_index?: number;
  instance_id?: string;
}

export type MVSSelectorShorthand =
  | 'all' | 'polymer' | 'protein' | 'nucleic' | 'branched'
  | 'ligand' | 'ion' | 'water' | 'coarse';

export type MVSSelector =
  | MVSSelectorShorthand
  | MVSSelectorObject
  | MVSSelectorObject[];

export interface MVSDownloadParams {
  url: string;
}

export interface MVSParseParams {
  format: string;
}

export interface MVSStructureParams {
  type: 'model' | 'assembly' | 'symmetry' | 'symmetry_mates';
  assembly_id?: string | null;
  model_index?: number;
}

export interface MVSComponentParams {
  selector: MVSSelector;
}

export interface MVSRepresentationParams {
  type: string;
  [extra: string]: unknown;
}

export interface MVSColorParams {
  color: string;
  selector?: MVSSelector;
}

export type MVSNode =
  | { kind: 'root'; children?: MVSNode[] }
  | { kind: 'download'; params: MVSDownloadParams; children?: MVSNode[] }
  | { kind: 'parse'; params: MVSParseParams; children?: MVSNode[] }
  | { kind: 'structure'; params: MVSStructureParams; children?: MVSNode[] }
  | { kind: 'component'; params: MVSComponentParams; children?: MVSNode[] }
  | { kind: 'representation'; params: MVSRepresentationParams; children?: MVSNode[] }
  | { kind: 'color'; params: MVSColorParams; children?: MVSNode[] }
  // any node kind pv's adapter doesn't implement (label, focus, camera,
  // canvas, *_from_uri, *_from_source, ...) is still parsed structurally so
  // the walker can report it by name and skip its subtree.
  | { kind: string; params?: Record<string, unknown>; children?: MVSNode[] };

export interface MVSState {
  root: MVSNode;
  metadata?: { title?: string; version?: string; timestamp?: string };
}
