import { test } from './helpers';
import { computeSurface } from '../surface/compute';

function atomData(atoms) {
  var data = new Float32Array(atoms.length * 4);
  atoms.forEach(function(atom, i) { data.set(atom, i * 4); });
  return data;
}

function params(type, extra) {
  return Object.assign({ type: type, probeRadius: 1.4, gridSpacing: 0.4 }, extra);
}

function eachVertex(mesh, callback) {
  mesh.chunks.forEach(function(chunk) {
    for (var i = 0; i < chunk.atoms.length; ++i) {
      callback(chunk.positions.subarray(i * 3, i * 3 + 3),
               chunk.normals.subarray(i * 3, i * 3 + 3), chunk.atoms[i]);
    }
  });
}

function radialError(mesh, center, radius) {
  var worst = 0;
  eachVertex(mesh, function(p) {
    var d = Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]);
    worst = Math.max(worst, Math.abs(d - radius));
  });
  return worst;
}

test("vdw surface of a single atom is its sphere", function(assert) {
  var mesh = computeSurface(atomData([[1, 2, 3, 1.7]]), params('vdw'));
  assert.strictEqual(mesh.chunks.length, 1);
  assert.ok(radialError(mesh, [1, 2, 3], 1.7) < 0.05);
});

test("sas surface of a single atom is inflated by the probe", function(assert) {
  var mesh = computeSurface(atomData([[0, 0, 0, 1.7]]), params('sas'));
  assert.ok(radialError(mesh, [0, 0, 0], 3.1) < 0.05);
});

test("ses surface of a single atom is its vdw sphere", function(assert) {
  var mesh = computeSurface(atomData([[0, 0, 0, 1.7]]), params('ses'));
  assert.ok(radialError(mesh, [0, 0, 0], 1.7) < 0.05);
});

test("ses fills the crevice between two atoms with a probe torus", function(assert) {
  // atoms 3A apart: a probe touching both has its centre on a circle of
  // radius sqrt(3.1^2 - 1.5^2) around the axis, and the SES between the
  // atoms is the inner side of the torus it sweeps.
  var mesh = computeSurface(atomData([[-1.5, 0, 0, 1.7], [1.5, 0, 0, 1.7]]),
                            params('ses', { gridSpacing: 0.25 }));
  var ring = Math.sqrt(3.1 * 3.1 - 1.5 * 1.5);
  var found = 0, worst = 0;
  eachVertex(mesh, function(p) {
    if (Math.abs(p[0]) > 0.5) return;
    found += 1;
    var expected = ring - Math.sqrt(1.4 * 1.4 - p[0] * p[0]);
    worst = Math.max(worst, Math.abs(Math.hypot(p[1], p[2]) - expected));
  });
  assert.ok(found > 10);
  assert.ok(worst < 0.075);
  // the vdw surface has a sharp crease of radius 0.8 there instead
  var vdw = computeSurface(atomData([[-1.5, 0, 0, 1.7], [1.5, 0, 0, 1.7]]),
                           params('vdw', { gridSpacing: 0.25 }));
  eachVertex(vdw, function(p) {
    if (Math.abs(p[0]) < 0.05) assert.ok(Math.hypot(p[1], p[2]) < 1.1);
  });
});

test("mesh is closed, consistently wound and clockwise seen from outside",
     function(assert) {
  var atoms = [[0, 0, 0, 1.7], [2.5, 0.5, 0, 1.55], [1, 2.2, 0.8, 1.52],
               [0.5, 0.8, 2.4, 1.8]];
  ['vdw', 'sas', 'ses'].forEach(function(type) {
    var mesh = computeSurface(atomData(atoms), params(type));
    assert.strictEqual(mesh.chunks.length, 1);
    var chunk = mesh.chunks[0];
    var directed = new Map();
    var p = chunk.positions, n = chunk.normals, idx = chunk.indices;
    var clockwise = 0;
    for (var t = 0; t < idx.length; t += 3) {
      var a = idx[t], b = idx[t + 1], c = idx[t + 2];
      [[a, b], [b, c], [c, a]].forEach(function(e) {
        var key = e[0] + ',' + e[1];
        directed.set(key, (directed.get(key) || 0) + 1);
      });
      var u = [0, 1, 2].map(function(k) { return p[b * 3 + k] - p[a * 3 + k]; });
      var v = [0, 1, 2].map(function(k) { return p[c * 3 + k] - p[a * 3 + k]; });
      var cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2],
                   u[0] * v[1] - u[1] * v[0]];
      var dot = 0;
      for (var k = 0; k < 3; ++k) dot += cross[k] * (n[a * 3 + k] + n[b * 3 + k] + n[c * 3 + k]);
      if (dot < 0) clockwise += 1;
    }
    // every directed edge is used once, and its reverse once
    directed.forEach(function(count, key) {
      var e = key.split(',');
      assert.strictEqual(count, 1);
      assert.strictEqual(directed.get(e[1] + ',' + e[0]), 1);
    });
    assert.ok(clockwise > 0.99 * idx.length / 3);
  });
});

test("large meshes are split into chunks with 16 bit indices", function(assert) {
  var atoms = [];
  for (var i = 0; i < 40; ++i) {
    atoms.push([Math.cos(i * 0.7) * 6, Math.sin(i * 0.7) * 6, i * 0.5, 1.7]);
  }
  var whole = computeSurface(atomData(atoms), params('ses'));
  var split = computeSurface(atomData(atoms), params('ses', { maxChunkVerts: 2000 }));
  var triangles = function(mesh) {
    return mesh.chunks.reduce(function(sum, c) { return sum + c.indices.length / 3; }, 0);
  };
  assert.strictEqual(whole.chunks.length, 1);
  assert.ok(split.chunks.length > 3);
  assert.strictEqual(triangles(split), triangles(whole));
  split.chunks.forEach(function(chunk) {
    var numVerts = chunk.atoms.length;
    assert.ok(numVerts <= 2000);
    for (var i = 0; i < chunk.indices.length; ++i) assert.ok(chunk.indices[i] < numVerts);
    // vertices are grouped by atom
    for (var v = 1; v < numVerts; ++v) assert.ok(chunk.atoms[v - 1] <= chunk.atoms[v]);
  });
});

test("vertices are assigned to the nearest atom", function(assert) {
  var mesh = computeSurface(atomData([[-2, 0, 0, 1.7], [2, 0, 0, 1.7]]), params('ses'));
  eachVertex(mesh, function(p, n, atom) {
    if (Math.abs(p[0]) > 0.2) assert.strictEqual(atom, p[0] < 0 ? 0 : 1);
  });
});
