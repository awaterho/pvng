// Web worker that computes one slab of a molecular surface off the main
// thread (see planSurface). Receives the atoms (x, y, z, van der Waals
// radius), surface parameters, the grid and the slab's cell layers, and
// replies with the slab's mesh chunks, transferring their buffers.

import { computeSurfaceSlab, type GridShape, type SurfaceParams } from './compute';

export interface SurfaceSlabRequest {
  atoms: Float32Array;
  params: SurfaceParams;
  grid: GridShape;
  z0: number;
  z1: number;
}

self.onmessage = (event: MessageEvent<SurfaceSlabRequest>) => {
  const { atoms, params, grid, z0, z1 } = event.data;
  const chunks = computeSurfaceSlab(atoms, params, grid, z0, z1);
  const transfer: Transferable[] = [];
  for (const chunk of chunks) {
    transfer.push(chunk.positions.buffer, chunk.normals.buffer, chunk.atoms.buffer,
                  chunk.indices.buffer);
  }
  (self as unknown as Worker).postMessage(chunks, transfer);
};
