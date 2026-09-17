// Copyright (c) 2013-2015 Marco Biasini
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
// DEALINGS IN THE SOFTWARE.
import type { vec3 } from 'gl-matrix';

// Minimal structural types for the scene objects and camera AutoSlab reads;
// their real classes (SceneNode-derived geometry, Cam) aren't converted to
// TypeScript yet.
interface SlabObject {
  visible(): boolean;
  updateSquaredSphereRadius(center: vec3, radius: number | null): number;
}
interface SlabCamera {
  center(): vec3;
  zoom(): number;
}

class Slab {
  near: number;
  far: number;

  constructor(near: number, far: number) {
    this.near = near;
    this.far = far;
  }
}

interface FixedSlabOptions {
  near?: number;
  far?: number;
}

class FixedSlab {
  private _near: number;
  private _far: number;

  constructor(options?: FixedSlabOptions) {
    options = options || {};
    this._near = options.near || 0.1;
    this._far = options.far || 400.0;
  }

  update(): Slab {
    return new Slab(this._near, this._far);
  }
}

class AutoSlab {
  private _far: number;

  constructor() {
    this._far = 100.0;
  }

  update(objects: readonly SlabObject[], cam: SlabCamera): Slab | null {
    const center = cam.center();
    let radius: number | null = null;
    for (let i = 0; i < objects.length; ++i) {
      const obj = objects[i]!;
      if (!obj.visible()) {
        continue;
      }
      radius = obj.updateSquaredSphereRadius(center, radius);
    }
    if (radius === null) {
      return null;
    }
    radius = Math.sqrt(radius);
    const zoom = cam.zoom();
    const newFar = (radius + zoom) * 1.05;
    const newNear = 0.1;//Math.max(0.1, zoom - radius);
    return new Slab(newNear, newFar);
  }
}

export default {
  FixedSlab : FixedSlab,
  AutoSlab : AutoSlab,
  Slab : Slab
};
