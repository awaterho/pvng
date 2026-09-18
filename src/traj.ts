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
import { vec3 } from 'gl-matrix';

// Structural typing for Mol/MolView (mol/mol.ts): only eachAtom is used.
interface TrajStructure {
  eachAtom(callback: (atom: { pos(): vec3 }, index: number) => void): void;
}

class CoordGroup {
  private _structure: TrajStructure;
  private _frames: Float32Array[];

  constructor(structure: TrajStructure) {
    this._structure = structure;
    this._frames = [];
  }

  addFrame(frame: Float32Array): void {
    this._frames.push(frame);
  }

  useFrame(frameIndex: number): void {
    const frame = this._frames[frameIndex]!;
    this._structure.eachAtom(function(atom, index) {
      const offset = index * 3;
      vec3.set(atom.pos(),
               frame[offset + 0]!, frame[offset + 1]!, frame[offset + 2]!);
    });
  }
}

function dcd(structure: TrajStructure, data: DataView): CoordGroup {
  const cg = new CoordGroup(structure);
  const endianness = String.fromCharCode(data.getUint8(4)) +
                   String.fromCharCode(data.getUint8(5)) +
                   String.fromCharCode(data.getUint8(6)) +
                   String.fromCharCode(data.getUint8(7));
  // FIXME: error handling and different dcd variants.
  // At the moment, this only works for a very small subset of files, I
  // can't even tell you which ones.
  const swapBytes = endianness === 'DROC';
  let current = 92;
  const titleLength = data.getUint32(current, swapBytes);
  current += 4 + titleLength;
  let i;
  //var fAtomCount = data.getUint32(4 * 10, swapBytes);
  const numFrames = data.getUint32(4 * 2, swapBytes);
  const format = data.getUint32(4 * 21, swapBytes);
  let perFrameHeader = false;
  if (format !== 0) {
    perFrameHeader = data.getUint32(4 * 12, swapBytes) !== 0;
  }
  current += 8;
  const tAtomCount = data.getUint32(current, swapBytes);
  current += 8;

  // read individual frames
  for (i = 0; i < numFrames; ++i) {
    const frame = new Float32Array(3 * tAtomCount);
    if (perFrameHeader) {
      current += 56;
    }
    for (let k = 0; k < 3; ++k) {
      current += 4;
      for (let j = 0; j < tAtomCount ; ++j) {
        const value = data.getFloat32(current, swapBytes);
        frame[j * 3 + k] = value ;
        current += 4;
      }
      current += 4;
    }
    cg.addFrame(frame);
  }
  return cg;
}

function fetch(url: string, callback: (data: DataView) => void): void {
  const oReq = new XMLHttpRequest();
  oReq.open("GET", url, true);
  oReq.responseType = 'arraybuffer';
  oReq.onload = function() {
    if (oReq.response) {
      callback(new DataView(oReq.response));
    }
  };
  oReq.send(null);
}

function fetchDcd(url: string, structure: TrajStructure, callback: (cg: CoordGroup) => void): void {
  fetch(url, function(data) {
    const coordGroup = dcd(structure, data);
    callback(coordGroup);
  });
}

export default {
  CoordGroup : CoordGroup,
  fetchDcd : fetchDcd,

};
