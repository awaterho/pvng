import io from '../io';
import type { RenderStructure } from '../gfx/render';
import { resolveSelector, type ResolvedSelector } from './selector';
import { resolveMVSColor } from './color';
import type { MVSNode, MVSState } from './types';

// Structural typing for whatever pv object we're currently positioned on
// while walking the tree: a parsed Mol, or a MolView produced by an earlier
// .select() call -- both support further .select() calls, which is what
// lets a color node's own selector narrow a component's selection without
// pv needing any new selection primitive (see mol/select.ts). Also the type
// of an already-parsed structure passed into applyMVSToStructure().
export interface MVSStructure {
  select(what?: string | Record<string, unknown>): unknown;
}
type Selectable = MVSStructure;

export interface MVSViewer {
  cartoon(name: string, structure: RenderStructure, opts?: Record<string, unknown>): unknown;
  ballsAndSticks(name: string, structure: RenderStructure, opts?: Record<string, unknown>): unknown;
  lines(name: string, structure: RenderStructure, opts?: Record<string, unknown>): unknown;
  spheres(name: string, structure: RenderStructure, opts?: Record<string, unknown>): unknown;
  trace(name: string, structure: RenderStructure, opts?: Record<string, unknown>): unknown;
}

export interface MVSLoadOptions {
  // overridable for tests / non-browser environments; defaults to the
  // global fetch().
  fetch?(url: string): Promise<string>;
  onWarning?(message: string): void;
  namePrefix?: string;
}

const REPR_TYPE_TO_METHOD: Record<string, keyof MVSViewer> = {
  cartoon: 'cartoon',
  backbone: 'trace',
  ball_and_stick: 'ballsAndSticks',
  line: 'lines',
  spacefill: 'spheres',
};

interface WalkContext {
  text: string | null;
  structure: Selectable | null;
  showRelated: string | null;
  component: ResolvedSelector | null;
}

const EMPTY_CONTEXT: WalkContext = { text: null, structure: null, showRelated: null, component: null };

function resolveViews(structure: Selectable, resolved: ResolvedSelector): unknown[] | null {
  if (resolved.kind === 'unsupported') {
    return null;
  }
  if (resolved.kind === 'select-arg') {
    return [structure.select(resolved.value)];
  }
  return resolved.value.map((dict) => structure.select(dict as Record<string, unknown>));
}

class MVSWalker {
  private _viewer: MVSViewer;
  private _warn: (message: string) => void;
  private _fetch: (url: string) => Promise<string>;
  private _namePrefix: string;
  private _counter = 0;

  constructor(viewer: MVSViewer, opts: MVSLoadOptions) {
    this._viewer = viewer;
    this._warn = opts.onWarning || function() {};
    this._fetch = opts.fetch || ((url) => fetch(url).then((r) => r.text()));
    this._namePrefix = opts.namePrefix || 'mvs';
  }

  private _nextName(): string {
    this._counter += 1;
    return `${this._namePrefix}-${this._counter}`;
  }

  async run(state: MVSState, ctx: WalkContext = EMPTY_CONTEXT): Promise<void> {
    await this._visitChildren(state.root.children || [], ctx);
  }

  private async _visitChildren(children: MVSNode[], ctx: WalkContext): Promise<void> {
    for (const child of children) {
      await this._visit(child, ctx);
    }
  }

  private async _visit(node: MVSNode, ctx: WalkContext): Promise<void> {
    switch (node.kind) {
      case 'download':
        return this._visitDownload(node, ctx);
      case 'parse':
        return this._visitParse(node, ctx);
      case 'structure':
        return this._visitStructure(node, ctx);
      case 'component':
        return this._visitComponent(node, ctx);
      case 'representation':
        return this._visitRepresentation(node, ctx);
      case 'color':
        // color nodes are consumed directly by _visitRepresentation; one
        // reached standalone (no representation ancestor) is meaningless.
        this._warn('"color" node found outside of a "representation" node; ignored');
        return;
      default:
        this._warn(`unsupported MVS node kind "${node.kind}"; skipping this node but continuing with its children`);
        return this._visitChildren(node.children || [], ctx);
    }
  }

  private async _visitDownload(node: MVSNode, ctx: WalkContext): Promise<void> {
    const params = (node as { params?: { url?: string } }).params;
    if (!params || !params.url) {
      this._warn('"download" node is missing a url; skipping');
      return;
    }
    let text: string;
    try {
      text = await this._fetch(params.url);
    } catch (err) {
      this._warn(`failed to download "${params.url}": ${(err as Error).message || err}`);
      return;
    }
    await this._visitChildren(node.children || [], { ...ctx, text });
  }

  private async _visitParse(node: MVSNode, ctx: WalkContext): Promise<void> {
    const params = (node as { params?: { format?: string } }).params;
    const format = params && params.format;
    if (ctx.text === null) {
      this._warn('"parse" node has no downloaded data to parse; skipping');
      return;
    }
    let structure: unknown;
    if (format === 'mmcif') {
      structure = io.cif(ctx.text);
    } else if (format === 'pdb') {
      structure = io.pdb(ctx.text);
    } else {
      this._warn(`unsupported parse format "${format}" (pv's MVS adapter only understands "mmcif" and "pdb")`);
      return;
    }
    if (!structure) {
      this._warn('failed to parse structure data; skipping');
      return;
    }
    await this._visitChildren(node.children || [], { ...ctx, structure: structure as Selectable, showRelated: null, component: null });
  }

  private async _visitStructure(node: MVSNode, ctx: WalkContext): Promise<void> {
    const params = (node as { params?: { type?: string; assembly_id?: string | null } }).params;
    if (!ctx.structure) {
      this._warn('"structure" node has no parsed structure to work with; skipping');
      return;
    }
    const type = params && params.type;
    let showRelated: string | null = null;
    if (type === 'model') {
      showRelated = null;
    } else if (type === 'assembly') {
      showRelated = (params && params.assembly_id) || null;
    } else {
      this._warn(`unsupported structure type "${type}" (pv's MVS adapter only understands "model" and "assembly")`);
      return;
    }
    await this._visitChildren(node.children || [], { ...ctx, showRelated, component: null });
  }

  private async _visitComponent(node: MVSNode, ctx: WalkContext): Promise<void> {
    const params = (node as { params?: { selector?: unknown } }).params;
    if (!ctx.structure || !params || params.selector === undefined) {
      this._warn('"component" node is missing a structure or selector; skipping');
      return;
    }
    const resolved = resolveSelector(params.selector as never);
    if (resolved.kind === 'unsupported') {
      this._warn(`component selector unsupported: ${resolved.reason}`);
      return;
    }
    if (resolved.kind === 'dicts') {
      for (const w of resolved.warnings) {
        this._warn(w);
      }
    }
    await this._visitChildren(node.children || [], { ...ctx, component: resolved });
  }

  private async _visitRepresentation(node: MVSNode, ctx: WalkContext): Promise<void> {
    const params = (node as { params?: { type?: string } }).params;
    const type = params && params.type;
    const method = type && REPR_TYPE_TO_METHOD[type];
    if (!ctx.structure) {
      this._warn('"representation" node has no structure to render; skipping');
      return;
    }
    if (!method) {
      this._warn(`unsupported representation type "${type}"; skipping`);
      return;
    }
    const baseResolved: ResolvedSelector = ctx.component || { kind: 'dicts', value: [{}], warnings: [] };
    const baseViews = resolveViews(ctx.structure, baseResolved);
    if (!baseViews) {
      return;
    }

    const colorChildren = (node.children || []).filter((c) => c.kind === 'color');
    const renderOpts = { showRelated: ctx.showRelated };

    if (colorChildren.length === 0) {
      for (const view of baseViews) {
        this._viewer[method](this._nextName(), view as RenderStructure, renderOpts);
      }
    } else {
      for (const colorNode of colorChildren) {
        const colorParams = (colorNode as { params?: { color?: string; selector?: unknown } }).params;
        if (!colorParams || !colorParams.color) {
          this._warn('"color" node is missing a color value; skipping');
          continue;
        }
        const colorResolution = resolveMVSColor(colorParams.color);
        if (!colorResolution.supported) {
          this._warn(colorResolution.reason);
          continue;
        }
        const targets = colorParams.selector === undefined
          ? baseViews
          : baseViews.flatMap((view) => {
            const narrowed = resolveViews(view as Selectable, resolveSelector(colorParams.selector as never));
            if (!narrowed) {
              this._warn(`color node's own selector unsupported; colored nothing for this rule`);
              return [];
            }
            return narrowed;
          });
        for (const target of targets) {
          this._viewer[method](this._nextName(), target as RenderStructure,
            { ...renderOpts, color: colorResolution.colorOp });
        }
      }
    }

    // color nodes are handled above; any other (currently unsupported)
    // children of a representation are still reported.
    for (const child of node.children || []) {
      if (child.kind !== 'color') {
        this._warn(`unsupported MVS node kind "${child.kind}" under "representation"; skipping`);
      }
    }
  }
}

export async function applyMVS(state: MVSState, viewer: MVSViewer, opts: MVSLoadOptions = {}): Promise<void> {
  const walker = new MVSWalker(viewer, opts);
  await walker.run(state);
}

// Same as applyMVS(), but for a structure you've already parsed (e.g. from
// io.fetchPdb()/io.cif()) rather than one described by download/parse nodes
// in the tree -- state.root's children are expected to start directly at
// "structure" (or "component"/"representation") nodes. Handy when a
// structure is already loaded in the viewer and you just want to try out an
// MVS component/representation/color subtree against it.
export async function applyMVSToStructure(
  structure: MVSStructure, state: MVSState, viewer: MVSViewer, opts: MVSLoadOptions = {}
): Promise<void> {
  const walker = new MVSWalker(viewer, opts);
  await walker.run(state, { ...EMPTY_CONTEXT, structure });
}
