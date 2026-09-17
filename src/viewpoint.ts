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
import { vec3, mat3 } from 'gl-matrix';
import geom from './geom';

// Structural typing for BaseGeom (gfx/base-geom.ts): only eachCentralAtom is
// used here.
interface Viewpointable {
  eachCentralAtom(callback: (atom: unknown, pos: vec3) => void): void;
}

const calculateCovariance = (function() {
  const center = vec3.create();
  const shiftedPos = vec3.create();
  return function(go: Viewpointable, covariance: mat3): void {
    vec3.set(center, 0, 0, 0);
    let atomCount = 0;
    go.eachCentralAtom(function(atom, transformedPos) {
      vec3.add(center, center, transformedPos);
      atomCount += 1;
    });
    if (atomCount === 0) {
      return;
    }
    vec3.scale(center, center, 1.0/atomCount);
    covariance[0] = 0; covariance[1] = 0; covariance[2] = 0;
    covariance[3] = 0; covariance[4] = 0; covariance[5] = 0;
    covariance[6] = 0; covariance[7] = 0; covariance[8] = 0;
    go.eachCentralAtom(function(atom, transformedPos) {
      vec3.sub(shiftedPos, transformedPos, center);
      const x = shiftedPos[0], y = shiftedPos[1], z = shiftedPos[2];
      // No need to fill in covariance[3]/covariance[6]/covariance[7], the
      // matrix is symmetric.
      covariance[0] += y * y + z * z;
      covariance[1] -= x * y;
      covariance[2] -= x * z;
      covariance[5] -= y * z;
      covariance[4] += x * x + z * z;
      covariance[8] += x * x + y * y;
    });
    covariance[3] = covariance[1];
    covariance[6] = covariance[2];
    covariance[7] = covariance[5];
  };
})();

const principalAxes = (function() {
  const covariance =  mat3.create();
  const diag = mat3.create();
  const min = vec3.create();
  const max = vec3.create();
  const projected = vec3.create();
  const range = vec3.create();
  const x = vec3.create();
  const y = vec3.create();
  const z = vec3.create();
  return function(go: Viewpointable): mat3 {
    calculateCovariance(go, covariance);
    const q = geom.diagonalizer(covariance);
    mat3.fromQuat(diag, q);
    let first = true;
    go.eachCentralAtom(function(atom, transformedPos) {
      vec3.transformMat3(projected, transformedPos, diag);
      if (first) {
        vec3.copy(min, projected);
        vec3.copy(max, projected);
        first = false;
      } else {
        vec3.min(min, min, projected);
        vec3.max(max, max, projected);
      }
    });
    vec3.sub(range, max, min);
    const axes: [number, number][] = [ [range[0], 0], [range[1], 1], [range[2], 2] ];
    axes.sort(function(a, b) {
      return b[0] - a[0];
    });
    const xIndex = axes[0]![1];
    const yIndex = axes[1]![1];
    vec3.set(x, diag[xIndex + 0]!, diag[xIndex + 3]!, diag[xIndex + 6]!);
    vec3.set(y, diag[yIndex + 0]!, diag[yIndex + 3]!, diag[yIndex + 6]!);
    vec3.cross(z, x, y);
    const rotation = mat3.create();
    rotation[0] = x[0]; rotation[1] = y[0]; rotation[2] = z[0];
    rotation[3] = x[1]; rotation[4] = y[1]; rotation[5] = z[1];
    rotation[6] = x[2]; rotation[7] = y[2]; rotation[8] = z[2];
    return rotation;
  };
})();

export default {
  principalAxes :principalAxes
};
