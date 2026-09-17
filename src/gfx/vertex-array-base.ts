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
import { vec3 } from 'gl-matrix';
import geom from '../geom';

interface PoolAllocatorLike {
  request(length: number): Float32Array;
  release(buffer: Float32Array): void;
}

interface Sphere {
  center(): vec3;
  radius(): number;
}

interface Interval {
  update(value: number): void;
}

// NOTE: kept as a prototype-based constructor function, not a real ES class,
// for the same reason as gfx/scene-node.ts: gfx/vertex-array.js and
// gfx/indexed-vertex-array.js (which extend it via VertexArrayBase.call(this,
// ...) and VertexArrayBase.prototype.destroy.call(this) from within
// gfx/chain-data.js's own subclasses, not yet converted) rely on it being
// callable without `new`.
//
// _FLOATS_PER_VERT, _COLOR_OFFSET, _SELECT_OFFSET and numVerts() are used
// here but must be provided by whichever subclass sets up the vertex layout
// (gfx/vertex-array.ts, gfx/indexed-vertex-array.ts).
interface VertexArrayBase {
  _gl: WebGLRenderingContext;
  _vertBuffer: WebGLBuffer;
  _float32Allocator: PoolAllocatorLike;
  _ready: boolean;
  _boundingSphere: Sphere | null;
  _vertData: Float32Array;
  _FLOATS_PER_VERT: number;
  _COLOR_OFFSET: number;
  _SELECT_OFFSET: number;

  numVerts(): number;
  setColor(index: number, r: number, g: number, b: number, a: number): void;
  getColor(index: number, color: vec3 | number[]): vec3 | number[];
  setOpacity(index: number, a: number): void;
  setSelected(index: number, a: number): void;
  boundingSphere(): Sphere | null;
  _calculateBoundingSphere(): Sphere | null;
  destroy(): void;
  bindBuffers(): void;
  updateSquaredSphereRadius(
    sphereCenter: vec3, radius: number | null, transform?: import('gl-matrix').mat4
  ): number | null;
  updateProjectionIntervals(
    xAxis: vec3, yAxis: vec3, zAxis: vec3,
    xInterval: Interval, yInterval: Interval, zInterval: Interval,
    transform?: import('gl-matrix').mat4,
  ): void;
}

interface VertexArrayBaseConstructor {
  new (gl: WebGLRenderingContext, numVerts: number, float32Allocator: PoolAllocatorLike): VertexArrayBase;
  (
    this: VertexArrayBase, gl: WebGLRenderingContext, numVerts: number,
    float32Allocator: PoolAllocatorLike,
  ): void;
  prototype: VertexArrayBase;
}

const VertexArrayBase = function(
  this: VertexArrayBase, gl: WebGLRenderingContext, numVerts: number,
  float32Allocator: PoolAllocatorLike,
) {
  this._gl = gl;
  this._vertBuffer = gl.createBuffer()!;
  this._float32Allocator = float32Allocator || null;
  this._ready = false;
  this._boundingSphere = null;
  const numFloats = this._FLOATS_PER_VERT * numVerts;
  this._vertData = float32Allocator.request(numFloats);
} as unknown as VertexArrayBaseConstructor;

VertexArrayBase.prototype = {
  setColor: function(this: VertexArrayBase, index: number, r: number, g: number, b: number, a: number): void {
    const colorStart = index * this._FLOATS_PER_VERT + this._COLOR_OFFSET;
    this._vertData[colorStart + 0] = r;
    this._vertData[colorStart + 1] = g;
    this._vertData[colorStart + 2] = b;
    this._vertData[colorStart + 3] = a;
    this._ready = false;
  },

  getColor: function(this: VertexArrayBase, index: number, color: vec3 | number[]) {
    const colorStart = index * this._FLOATS_PER_VERT + this._COLOR_OFFSET;
    color[0] = this._vertData[colorStart + 0]!;
    color[1] = this._vertData[colorStart + 1]!;
    color[2] = this._vertData[colorStart + 2]!;
    (color as number[])[3] = this._vertData[colorStart + 3]!;
    return color;
  },

  setOpacity: function(this: VertexArrayBase, index: number, a: number): void {
    const colorStart = index * this._FLOATS_PER_VERT + this._COLOR_OFFSET;
    this._vertData[colorStart + 3] = a;
    this._ready = false;
  },

  setSelected: function(this: VertexArrayBase, index: number, a: number): void {
    const selected = index * this._FLOATS_PER_VERT + this._SELECT_OFFSET;
    this._vertData[selected] = a;
    this._ready = false;
  },


  boundingSphere: function(this: VertexArrayBase): Sphere | null {
    if (!this._boundingSphere) {
      this._boundingSphere = this._calculateBoundingSphere();
    }
    return this._boundingSphere;
  },


  _calculateBoundingSphere: function(this: VertexArrayBase): Sphere | null {
    const numVerts = this.numVerts();
    if (numVerts === 0) {
      return null;
    }
    const center = vec3.create();
    let index, i;
    for (i = 0; i < numVerts; ++i) {
      index = i * this._FLOATS_PER_VERT;
      center[0] += this._vertData[index + 0]!;
      center[1] += this._vertData[index + 1]!;
      center[2] += this._vertData[index + 2]!;
    }
    vec3.scale(center, center, 1.0/numVerts);
    let radiusSquare = 0.0;
    for (i = 0; i < numVerts; ++i) {
      index = i * this._FLOATS_PER_VERT;
      const dx  = center[0] - this._vertData[index + 0]!;
      const dy  = center[1] - this._vertData[index + 1]!;
      const dz  = center[2] - this._vertData[index + 2]!;
      radiusSquare = Math.max(radiusSquare, dx*dx + dy*dy + dz*dz);
    }
    return new geom.Sphere(center, Math.sqrt(radiusSquare));
  },

  destroy: function(this: VertexArrayBase): void {
    this._gl.deleteBuffer(this._vertBuffer);
    this._float32Allocator.release(this._vertData);
  },

  bindBuffers: function(this: VertexArrayBase): void {
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._vertBuffer);
    if (this._ready) {
      return;
    }
    this._gl.bufferData(this._gl.ARRAY_BUFFER, this._vertData,
                        this._gl.STATIC_DRAW);
    this._ready = true;
  },

  // Helper method to calculate the squared bounding sphere radius of the
  // sphere centered on "sphereCenter" over multiple vertex arrays.
  updateSquaredSphereRadius: (function() {

    const transformedCenter = vec3.create();
    return function(
      this: VertexArrayBase, sphereCenter: vec3, radius: number | null,
      transform?: import('gl-matrix').mat4,
    ): number | null {
      const bounds = this.boundingSphere();
      if (!bounds) {
        return radius;
      }
      // Note: Math.max(radius, null) returns the radius for positive values
      // of radius, which is exactly what we want.
      if (transform) {
        vec3.transformMat4(transformedCenter, bounds.center(), transform);
        return Math.max(vec3.sqrDist(transformedCenter, sphereCenter), radius as number);
      }

      const sphereRadSquare = bounds.radius() * bounds.radius();
      return Math.max(vec3.sqrDist(bounds.center(),
                                   sphereCenter) + sphereRadSquare,
                      radius as number);
    };
  })(),

  updateProjectionIntervals: (function() {

    const transformedCenter = vec3.create();
    return function(
      this: VertexArrayBase, xAxis: vec3, yAxis: vec3, zAxis: vec3,
      xInterval: Interval, yInterval: Interval, zInterval: Interval,
      transform?: import('gl-matrix').mat4,
    ): void {
      const bounds = this.boundingSphere();
      if (!bounds) {
        return;
      }
      if (transform) {
        vec3.transformMat4(transformedCenter, bounds.center(), transform);
      } else {
        vec3.copy(transformedCenter, bounds.center());
      }
      const xProjected = vec3.dot(xAxis, transformedCenter);
      const yProjected = vec3.dot(yAxis, transformedCenter);
      const zProjected = vec3.dot(zAxis, transformedCenter);
      xInterval.update(xProjected - bounds.radius());
      xInterval.update(xProjected + bounds.radius());
      yInterval.update(yProjected - bounds.radius());
      yInterval.update(yProjected + bounds.radius());
      zInterval.update(zProjected - bounds.radius());
      zInterval.update(zProjected + bounds.radius());
    };
  })(),
} as VertexArrayBase;

export default VertexArrayBase;
