import { test, strictEqual, deepEqual } from '../helpers';
import { resolveSelector } from '../../mvs/selector';

test('mvs selector: "all" shorthand resolves to an empty dict', function() {
  var resolved = resolveSelector('all');
  strictEqual(resolved.kind, 'dicts');
  deepEqual(resolved.value, [{}]);
});

test('mvs selector: polymer/protein/water/ligand shorthands map to pv select args', function() {
  strictEqual(resolveSelector('polymer').kind, 'select-arg');
  strictEqual(resolveSelector('polymer').value, 'polymer');
  strictEqual(resolveSelector('protein').value, 'protein');
  strictEqual(resolveSelector('water').value, 'water');
  strictEqual(resolveSelector('ligand').value, 'ligand');
});

test('mvs selector: unsupported shorthands are reported, not guessed at', function() {
  var resolved = resolveSelector('nucleic');
  strictEqual(resolved.kind, 'unsupported');
  strictEqual(typeof resolved.reason, 'string');
});

test('mvs selector: chain/residue selector object maps to a SelectDict', function() {
  var resolved = resolveSelector({ label_asym_id: 'A', beg_label_seq_id: 10, end_label_seq_id: 20 });
  strictEqual(resolved.kind, 'dicts');
  deepEqual(resolved.value, [{ cname: 'A', rnumRange: [10, 20] }]);
});

test('mvs selector: auth_* fields are used when label_* is absent', function() {
  var resolved = resolveSelector({ auth_asym_id: 'B', auth_seq_id: 42, auth_comp_id: 'ALA' });
  deepEqual(resolved.value, [{ cname: 'B', rnum: 42, rname: 'ALA' }]);
});

test('mvs selector: label_* takes precedence over auth_* when both are given', function() {
  var resolved = resolveSelector({ label_asym_id: 'A', auth_asym_id: 'X' });
  deepEqual(resolved.value, [{ cname: 'A' }]);
});

test('mvs selector: fields with no pv equivalent are dropped with a warning, not silently wrong', function() {
  var resolved = resolveSelector({ label_asym_id: 'A', type_symbol: 'C', atom_id: 7 });
  deepEqual(resolved.value, [{ cname: 'A' }]);
  strictEqual(resolved.warnings.length, 2);
});

test('mvs selector: an array selector resolves to one dict per entry (union via multiple geometries)', function() {
  var resolved = resolveSelector([{ label_asym_id: 'A' }, { label_asym_id: 'B' }]);
  strictEqual(resolved.kind, 'dicts');
  deepEqual(resolved.value, [{ cname: 'A' }, { cname: 'B' }]);
});
