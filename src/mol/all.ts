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
import mol from './mol';
import sp from './superpose';

interface SSTrace {
  length(): number;
  posAt(out: vec3, index: number): vec3;
  residueAt(index: number): { setSS(ss: string): void };
}

interface SSChain {
  eachBackboneTrace(callback: (trace: SSTrace) => void): void;
}

interface SSStructure {
  chains(): SSChain[];
}

const zhangSkolnickSS = (function() {
  const posOne = vec3.create();
  const posTwo = vec3.create();
  return function(trace: SSTrace, i: number, distances: number[], delta: number): boolean {
    for (let j = Math.max(0, i-2); j <= i; ++j) {
      for (let k = 2;  k < 5; ++k) {
        if (j+k >= trace.length()) {
          continue;
        }
        const d = vec3.dist(trace.posAt(posOne, j),
                          trace.posAt(posTwo, j+k));
        if (Math.abs(d - distances[k-2]!) > delta) {
          return false;
        }
      }
    }
    return true;
  };
})();

const isHelical = function(trace: SSTrace, i: number): boolean {
  const helixDistances = [5.45, 5.18, 6.37];
  const helixDelta = 2.1;
  return zhangSkolnickSS(trace, i, helixDistances, helixDelta);
};

const isSheet = function(trace: SSTrace, i: number): boolean {
  const sheetDistances = [6.1, 10.4, 13.0];
  const sheetDelta = 1.42;
  return zhangSkolnickSS(trace, i, sheetDistances, sheetDelta);
};

function traceAssignHelixSheet(trace: SSTrace): void {
  for (let i = 0; i < trace.length(); ++i) {
    if (isHelical(trace, i)) {
      trace.residueAt(i).setSS('H');
      continue;
    }
    if (isSheet(trace, i)) {
      trace.residueAt(i).setSS('E');
      continue;
    }
    trace.residueAt(i).setSS('C');
  }
}


// assigns secondary structure information based on a simple and very fast
// algorithm published by Zhang and Skolnick in their TM-align paper.
// Reference:
//
// TM-align: a protein structure alignment algorithm based on the Tm-sutils
// (2005) NAR, 33(7) 2302-2309
function assignHelixSheet(structure: SSStructure): void {
  const chains = structure.chains();
  for (let ci = 0; ci < chains.length; ++ci) {
    const chain = chains[ci]!;
    chain.eachBackboneTrace(traceAssignHelixSheet);
  }
}

export default {
  Mol: mol.Mol,
  MolView: mol.MolView,
  assignHelixSheet : assignHelixSheet,
  superpose: sp.superpose,
  matchResiduesByIndex: sp.matchResiduesByIndex,
  matchResiduesByNum: sp.matchResiduesByNum,

};
