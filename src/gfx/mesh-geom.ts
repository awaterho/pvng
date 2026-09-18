// Copyright (c) 2013-2015 Marco Biasini
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
import type { mat4 } from 'gl-matrix';
import utils from '../utils';
import BaseGeom, { type BaseGeom as IBaseGeom } from './base-geom';
import cd, { type Shader as ChainDataShader } from './chain-data';
import IndexedVertexArray, { type Uint16AllocatorLike } from './indexed-vertex-array';

const MeshChainData = cd.MeshChainData;
type MeshChainData = InstanceType<typeof MeshChainData>;
type IndexedVertexArrayInstance = InstanceType<typeof IndexedVertexArray>;
type IndexedVA = MeshChainData | IndexedVertexArrayInstance;

interface Shader extends ChainDataShader {
  normalAttrib: number;
}

interface ShaderCatalog {
  hemilight: Shader;
  phong: Shader;
  select: Shader;
  outline: Shader;
  hemilightTransparent?: Shader;
  phongTransparent?: Shader;
  [pass: string]: Shader | undefined;
}

interface MGChain {
  name(): string;
}

// an (indexed) mesh geometry container
// ------------------------------------------------------------------------
//
// stores the vertex data in interleaved format. not doing so has severe
// performance penalties in WebGL, and severe means orders of magnitude
// slower than using an interleaved array.
//
// the vertex data is stored in the following format;
//
// Px Py Pz Nx Ny Nz Cr Cg Cb Ca Id
//
// , where P is the position, N the normal and C the color information
// of the vertex.
//
// Uint16 index buffer limit
// -----------------------------------------------------------------------
//
// In WebGL, index arrays are restricted to uint16. The largest possible
// index value is smaller than the number of vertices required to display
// larger molecules. To work around this, MeshGeom allows to split the
// render geometry across multiple indexed vertex arrays.
//
// NOTE: kept as a prototype-based constructor function -- see
// gfx/vertex-array-base.ts/gfx/base-geom.ts for why (this chain-invokes
// BaseGeom via `.call()`, and gfx/billboard-geom.js, not yet converted,
// chain-invokes this the same way).
export interface MeshGeom extends IBaseGeom {
  _indexedVAs: IndexedVA[];
  _float32Allocator: unknown;
  _uint16Allocator: Uint16AllocatorLike;
  _remainingVerts: number | null;
  _remainingIndices: number | null;

  _boundedVertArraySize(size: number): number;
  addChainVertArray(chain: MGChain, numVerts: number, numIndices: number): MeshChainData;
  addVertArray(numVerts: number, numIndices: number): IndexedVertexArrayInstance;
  vertArrayWithSpaceFor(numVerts: number): IndexedVA;
  vertArray(index: number): IndexedVA;
  numVerts(): number;
  addVertex(pos: ArrayLike<number>, normal: ArrayLike<number>, color: ArrayLike<number>, objId: number): void;
  addTriangle(idx1: number, idx2: number, idx3: number): void;
}

interface MeshGeomConstructor {
  new (gl: WebGL2RenderingContext, float32Allocator: unknown, uint16Allocator: Uint16AllocatorLike): MeshGeom;
  (this: MeshGeom, gl: WebGL2RenderingContext, float32Allocator: unknown, uint16Allocator: Uint16AllocatorLike): void;
  prototype: MeshGeom;
}

const MeshGeom = function(
  this: MeshGeom, gl: WebGL2RenderingContext, float32Allocator: unknown, uint16Allocator: Uint16AllocatorLike,
) {
  (BaseGeom as unknown as (this: MeshGeom, gl: WebGL2RenderingContext) => void).call(this, gl);
  this._indexedVAs = [ ];
  this._float32Allocator = float32Allocator;
  this._uint16Allocator = uint16Allocator;
  this._remainingVerts = null;
  this._remainingIndices = null;
} as unknown as MeshGeomConstructor;

utils.derive(MeshGeom, BaseGeom, {
  _boundedVertArraySize: function(this: MeshGeom, size: number) {
    return Math.min(65536, size);
  },

  addChainVertArray: function(this: MeshGeom, chain: MGChain, numVerts: number, numIndices: number) {
    this._remainingVerts = numVerts;
    this._remainingIndices = numIndices;
    const newVa = new MeshChainData(chain.name(), this._gl,
                                  this._boundedVertArraySize(numVerts),
                                  numIndices,
                                  this._float32Allocator,
                                  this._uint16Allocator);
    this._indexedVAs.push(newVa);
    return newVa;
  },

  addVertArray: function(this: MeshGeom, numVerts: number, numIndices: number) {
    this._remainingVerts = numVerts;
    this._remainingIndices = numIndices;
    const newVa = new IndexedVertexArray(
      this._gl, this._boundedVertArraySize(numVerts), numIndices,
      this._float32Allocator, this._uint16Allocator);

    this._indexedVAs.push(newVa);
    return newVa;
  },

  // makes sure the current vertex array has at least space for numVerts more
  // vertices. If so, the current vertex array is returned. If not, a new
  // vertex array is created with as much space as possible:
  // - if there are still more than 2^16 vertices required for this mesh geom,
  //   a new vertex array with 2^16 vertices is returned
  // - if there are less than 2^16 vertices are required, a new vertex array
  //   with the number of remaining vertices is returned.
  //
  // Note: this depends on the total number of vertices provided to
  // addVertArray/addChainVertArray. In case there are too few vertices passed
  // to addVertArray/addChainVertArray, bad stuff will happen!
  vertArrayWithSpaceFor: function(this: MeshGeom, numVerts: number) {
    const currentVa = this._indexedVAs[this._indexedVAs.length - 1]!;
    const remaining = currentVa.maxVerts() - currentVa.numVerts();
    if (remaining >= numVerts) {
      return currentVa;
    }
    this._remainingVerts! -= currentVa.numVerts();
    this._remainingIndices! -= currentVa.numIndices();
    const boundedVerts = this._boundedVertArraySize(this._remainingVerts!);
    let newVa: IndexedVA;
    if (currentVa instanceof MeshChainData) {
      newVa = new MeshChainData(currentVa.chain(), this._gl, boundedVerts,
                                this._remainingIndices!,
                                this._float32Allocator,
                                this._uint16Allocator);
    } else {
      newVa = new IndexedVertexArray(this._gl, boundedVerts, this._remainingIndices!,
        this._float32Allocator, this._uint16Allocator);
    }
    this._indexedVAs.push(newVa);
    return newVa;
  },



  vertArray: function(this: MeshGeom, index: number) {
    return this._indexedVAs[index]!;
  },

  destroy: function(this: MeshGeom) {
    (BaseGeom.prototype.destroy as (this: MeshGeom) => void).call(this);
    for (let i = 0; i < this._indexedVAs.length; ++i) {
      this._indexedVAs[i]!.destroy();
    }
    this._indexedVAs = [];
  },

  numVerts: function(this: MeshGeom) {
    return this._indexedVAs[0]!.numVerts();
  },

  shaderForStyleAndPass: function(this: MeshGeom, shaderCatalog: ShaderCatalog, style: unknown, pass: unknown) {
    if (pass === 'normal') {
      if (style === 'hemilight') {
        return shaderCatalog.hemilight;
      } else {
        return shaderCatalog.phong;
      }
    }
    if (pass === 'transparent') {
      if (style === 'hemilight') {
        return shaderCatalog.hemilightTransparent ?? null;
      } else {
        return shaderCatalog.phongTransparent ?? null;
      }
    }
    if (pass === 'select') {
      return shaderCatalog.select;
    }
    if (pass === 'outline') {
      return shaderCatalog.outline;
    }
    const shader = shaderCatalog[pass as string];
    return shader !== undefined ? shader : null;
  },

  _drawVertArrays: function(
    this: MeshGeom, cam: unknown, shader: Shader, indexedVAs: IndexedVA[], additionalTransforms: mat4[] | null,
  ) {
    let i;
    if (additionalTransforms) {
      for (i = 0; i < indexedVAs.length; ++i) {
        (indexedVAs[i] as MeshChainData).drawSymmetryRelated(cam as never, shader,
                                                 additionalTransforms);
      }
    } else {
      (cam as { bind(s: Shader): void }).bind(shader);
      this._gl.uniform1i(shader.symId, 255);
      for (i = 0; i < indexedVAs.length; ++i) {
        indexedVAs[i]!.bind(shader);
        indexedVAs[i]!.draw();
        indexedVAs[i]!.releaseAttribs(shader);
      }
    }
  },

  vertArrays: function(this: MeshGeom) {
    return this._indexedVAs;
  },

  addVertex: function(
    this: MeshGeom, pos: ArrayLike<number>, normal: ArrayLike<number>, color: ArrayLike<number>, objId: number
  ) {
    const va = this._indexedVAs[0]!;
    va.addVertex(pos, normal, color, objId);
  },

  addTriangle: function(this: MeshGeom, idx1: number, idx2: number, idx3: number) {
    const va = this._indexedVAs[0]!;
    va.addTriangle(idx1, idx2, idx3);
  },

} as Partial<MeshGeom>);

export default MeshGeom;
