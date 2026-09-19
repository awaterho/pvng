import { applyMVS, applyMVSToStructure, type MVSViewer, type MVSLoadOptions, type MVSStructure } from './apply';
import type { MVSState } from './types';

// Loads a MolViewSpec (https://molstar.org/mol-view-spec-docs/) state into a
// pv Viewer. This is a read-only, best-effort import: only a subset of the
// MVS tree is understood (single-model/assembly structures, component
// selectors backed by chain/residue/atom names or numeric ranges, and
// cartoon/backbone/ball_and_stick/line/spacefill representations with
// uniform coloring). Anything else is reported via opts.onWarning and
// skipped rather than silently misrendered -- see src/mvs/apply.ts for the
// exact node-by-node behavior.
export function load(state: MVSState, viewer: MVSViewer, opts?: MVSLoadOptions): Promise<void> {
  return applyMVS(state, viewer, opts);
}

// Same as load(), but against a structure you've already parsed (e.g. via
// io.fetchPdb()/io.cif()) instead of one described by download/parse nodes
// -- state.root's children should start directly at "structure" (or
// "component"/"representation") nodes.
export function loadStructure(
  structure: MVSStructure, state: MVSState, viewer: MVSViewer, opts?: MVSLoadOptions
): Promise<void> {
  return applyMVSToStructure(structure, state, viewer, opts);
}

export type { MVSState, MVSNode, MVSSelector, MVSSelectorObject } from './types';
export type { MVSViewer, MVSLoadOptions, MVSStructure } from './apply';

export default { load, loadStructure };
