// Web worker that computes molecular surfaces off the main thread. Receives
// the atoms (x, y, z, van der Waals radius) and surface parameters, replies
// with the mesh chunks, transferring their buffers.

import { computeSurface, type SurfaceParams } from './compute';

export interface SurfaceRequest {
  atoms: Float32Array;
  params: SurfaceParams;
}

self.onmessage = (event: MessageEvent<SurfaceRequest>) => {
  const mesh = computeSurface(event.data.atoms, event.data.params);
  const transfer: Transferable[] = [];
  for (const chunk of mesh.chunks) {
    transfer.push(chunk.positions.buffer, chunk.normals.buffer, chunk.atoms.buffer,
                  chunk.indices.buffer);
  }
  (self as unknown as Worker).postMessage(mesh, transfer);
};
