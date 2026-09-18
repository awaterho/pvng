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
import { vec3, mat3 } from 'gl-matrix';
import utils from '../utils';
import color from '../color';
import geom from '../geom';
import gb from './geom-builders';
import IndexedVertexArray, { type Shader as IVAShader } from './indexed-vertex-array';
import SceneNode, { type SceneNode as ISceneNode } from './scene-node';
import type Cam from './cam';
import type { ShaderProgram } from './cam';
import { ContinuousIdRange } from '../unique-object-id-pool';
import type UniqueObjectIdPool from '../unique-object-id-pool';

const forceRGB = color.forceRGB;


// number of ids to be allocated whenever we run out of objects. This would
// ideally depend on number of objects the user is going to create.
const ID_CHUNK_SIZE = 100;

interface ObjectIdData {
  center: vec3;
  userData: unknown;
  geom: CustomMesh;
}

interface Shader extends IVAShader, ShaderProgram {
  symId: WebGLUniformLocation;
}

interface ShaderCatalog {
  hemilight: Shader;
  select: Shader;
  outline: Shader;
  hemilightTransparent?: Shader;
  [pass: string]: Shader | undefined;
}

interface TubeOptions {
  color?: string | number[];
  cap?: boolean;
  userData?: unknown;
}

interface SphereOptions {
  color?: string | number[];
  userData?: unknown;
}

// small helper with the same interface as IndexedVertexArray that can be used
// as a drop-in when the number of vertices/indices is not known in advance.
class DynamicIndexedVertexArray {
  private _vertData: number[];
  private _indexData: number[];
  private _numVerts: number;

  constructor() {
    this._vertData = [];
    this._indexData = [];
    this._numVerts = 0;
  }

  numVerts(): number {
    return this._numVerts;
  }
  addVertex(pos: ArrayLike<number>, normal: ArrayLike<number>, color: ArrayLike<number>, objId: number): void {
    this._numVerts += 1;
    this._vertData.push(pos[0]!, pos[1]!, pos[2]!,
                        normal[0]!, normal[1]!, normal[2]!,
                        color[0]!, color[1]!, color[2]!, color[3]!,
                        objId, 0.0);
  }
  addTriangle(indexOne: number, indexTwo: number, indexThree: number): void {
    this._indexData.push(indexOne, indexTwo, indexThree);
  }
  numIndices(): number {
    return this._indexData.length;
  }
  indexData(): number[] {
    return this._indexData;
  }
  vertData(): number[] {
    return this._vertData;
  }
}

// FIXME: these are duplicated from render.js and should be moved to a
// common module
function capTubeStart(va: DynamicIndexedVertexArray, baseIndex: number, numTubeVerts: number): void {
  for (let i = 0; i < numTubeVerts - 1; ++i) {
    va.addTriangle(baseIndex, baseIndex + 1 + i, baseIndex + 2 + i);
  }
  va.addTriangle(baseIndex, baseIndex + numTubeVerts, baseIndex + 1);
}

function capTubeEnd(va: DynamicIndexedVertexArray, baseIndex: number, numTubeVerts: number): void {
  const center = baseIndex + numTubeVerts;
  for (let i = 0; i < numTubeVerts - 1; ++i) {
    va.addTriangle(center, baseIndex + i + 1, baseIndex + i);
  }
  va.addTriangle(center, baseIndex, baseIndex + numTubeVerts - 1);
}

// NOTE: kept as a prototype-based constructor function -- see
// gfx/vertex-array-base.ts/gfx/base-geom.ts for why (this chain-invokes
// SceneNode via `.call()`).
export interface CustomMesh extends ISceneNode {
  _float32Allocator: unknown;
  _uint16Allocator: unknown;
  _data: DynamicIndexedVertexArray;
  _protoSphere: InstanceType<typeof gb.ProtoSphere>;
  _protoCyl: InstanceType<typeof gb.ProtoCylinder>;
  _va: InstanceType<typeof IndexedVertexArray> | null;
  _idRanges: ContinuousIdRange<ObjectIdData>[];
  _idPool: UniqueObjectIdPool<ObjectIdData>;
  _ready: boolean;
  _currentRange: ContinuousIdRange<ObjectIdData> | null;

  updateProjectionIntervals(): void;
  updateSquaredSphereRadius(center: vec3, radius: number | null): number | null;
  addTube(start: vec3, end: vec3, radius: number, options?: TubeOptions): void;
  _nextObjectId(data: ObjectIdData): number;
  addSphere(center: vec3, radius: number, options?: SphereOptions): void;
  _prepareVertexArray(): void;
  shaderForStyleAndPass(shaderCatalog: ShaderCatalog, style: unknown, pass: unknown): Shader | null;
}

interface CustomMeshConstructor {
  new (
    name: string, gl: WebGL2RenderingContext, float32Allocator: unknown, uint16Allocator: unknown,
    idPool: UniqueObjectIdPool<ObjectIdData>,
  ): CustomMesh;
  (
    this: CustomMesh, name: string, gl: WebGL2RenderingContext, float32Allocator: unknown,
    uint16Allocator: unknown, idPool: UniqueObjectIdPool<ObjectIdData>,
  ): void;
  prototype: CustomMesh;
}

const CustomMesh = function(
  this: CustomMesh, name: string, gl: WebGL2RenderingContext, float32Allocator: unknown,
  uint16Allocator: unknown, idPool: UniqueObjectIdPool<ObjectIdData>,
) {
  (SceneNode as unknown as (this: CustomMesh, gl: WebGL2RenderingContext) => void).call(this, gl);
  this._float32Allocator = float32Allocator;
  this._uint16Allocator = uint16Allocator;
  this._data = new DynamicIndexedVertexArray();
  this._protoSphere = new gb.ProtoSphere(8, 8);
  this._protoCyl = new gb.ProtoCylinder(8);
  this._va = null;
  this._idRanges = [];
  this._idPool = idPool;
  this._ready = false;
  this._currentRange = null;
} as unknown as CustomMeshConstructor;

utils.derive(CustomMesh, SceneNode, {
  updateProjectionIntervals: function(this: CustomMesh) {},
  updateSquaredSphereRadius: function(this: CustomMesh, center: vec3, radius: number | null) {
    return radius;
  },

  addTube: (function() {
    const midPoint = vec3.create();
    const left = vec3.create();
    const up = vec3.create();
    const dir = vec3.create();
    const rotation = mat3.create();
    return function(
      this: CustomMesh, start: vec3, end: vec3, radius: number, options?: TubeOptions
    ): void {
      options = options || {};
      const color = forceRGB(options.color || 'white');
      let cap = true;
      if (options.cap !== undefined) {
        cap = options.cap;
      }
      vec3.sub(dir, end, start);
      const length = vec3.length(dir);
      vec3.normalize(dir, dir);
      vec3.add(midPoint, start, end);
      vec3.scale(midPoint, midPoint, 0.5);
      geom.buildRotation(rotation, dir, left, up, false);
      if (cap) {
        const startIndex = this._data.numVerts();
        this._data.addVertex(start, [-dir[0], -dir[1], -dir[2]], color, 0);
        capTubeStart(this._data, startIndex, 8);
      }
      const userData = options.userData !== undefined ? options.userData : null;
      console.log(userData);
      const objectId = this._nextObjectId({
        center : midPoint,
        userData : userData,
        geom : this
      });
      this._protoCyl.addTransformed(this._data, midPoint, length, radius,
                                    rotation, color, color, objectId, objectId);
      if (cap) {
        const baseIndex = this._data.numVerts();
        this._data.addVertex(end, dir, color, 0);
        capTubeEnd(this._data, baseIndex - 8, 8);
      }
      this._ready = false;
    };
  })(),
  _nextObjectId: function(this: CustomMesh, data: ObjectIdData) {
    // because we have no idea how many different objects the user will
    // create we will just allocate the object ids in chunks of
    // ID_CHUNK_SIZE
    if (!this._currentRange || !this._currentRange.hasLeft()) {
      this._currentRange = this._idPool.getContinuousRange(ID_CHUNK_SIZE);
      this._idRanges.push(this._currentRange!);
    }
    return this._currentRange!.nextId(data);
  },
  destroy: function(this: CustomMesh) {
    (SceneNode.prototype.destroy as (this: CustomMesh) => void).call(this);
    for (let i = 0; i < this._idRanges.length; ++i) {
      this._idRanges[i]!.recycle();
    }
  },

  addSphere: function(this: CustomMesh, center: vec3, radius: number, options?: SphereOptions) {
    options = options || {};
    const color = forceRGB(options.color || 'white');
    const userData = options.userData !== undefined ? options.userData : null;
    const objectId = this._nextObjectId({
      center : center,
      userData : userData,
      geom : this
    });
    this._protoSphere.addTransformed(this._data, center, radius,
                                     color, objectId);
    this._ready = false;
  },
  _prepareVertexArray: function(this: CustomMesh) {
    this._ready = true;
    if (this._va !== null) {
      this._va.destroy();
    }
    this._va = new IndexedVertexArray(this._gl, this._data.numVerts(),
                                      this._data.numIndices(),
                                      this._float32Allocator,
                                      this._uint16Allocator as never);
    // FIXME: find a better way to do this
    this._va.setIndexData(this._data.indexData());
    this._va.setVertData(this._data.vertData());
  },

  draw: function(this: CustomMesh, cam: Cam, shaderCatalog: ShaderCatalog, style: unknown, pass: unknown) {
    if (!this._visible) {
      return;
    }
    if (!this._ready) {
      this._prepareVertexArray();
    }
    const shader = this.shaderForStyleAndPass(shaderCatalog, style, pass);
    if (!shader) {
      return;
    }
    cam.bind(shader);
    this._gl.uniform1i(shader.symId, 255);
    const va = this._va!;
    va.bind(shader);
    va.draw();
    va.releaseAttribs(shader);
  },
  // 'style' is currently always 'hemilight' (the only shading style pv
  // supports), so this always resolves to the hemilight shader -- kept as a
  // dispatcher (rather than inlined at call sites) since 'pass' still
  // selects between several distinct shaders.
  shaderForStyleAndPass: function(this: CustomMesh, shaderCatalog: ShaderCatalog, style: unknown, pass: unknown) {
    if (pass === 'normal') {
      return shaderCatalog.hemilight;
    }
    if (pass === 'transparent') {
      return shaderCatalog.hemilightTransparent ?? null;
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
} as Partial<CustomMesh>);

export default CustomMesh;
