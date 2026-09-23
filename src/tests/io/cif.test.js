import { test, strictEqual, deepEqual } from '../helpers';
import * as glMatrix from 'gl-matrix';
import io from '../../io';

var mat4 = glMatrix.mat4;

// polymer coordinates below are taken from pdbs/1crn.pdb (THR 1, THR 2,
// CYS 3, CYS 4 of chain A), rewritten as an mmCIF _atom_site loop using
// label_* identifiers.
var BASIC_CIF = [
  'data_TEST',
  'loop_',
  '_atom_site.group_PDB',
  '_atom_site.id',
  '_atom_site.type_symbol',
  '_atom_site.label_atom_id',
  '_atom_site.label_alt_id',
  '_atom_site.label_comp_id',
  '_atom_site.label_asym_id',
  '_atom_site.label_seq_id',
  '_atom_site.Cartn_x',
  '_atom_site.Cartn_y',
  '_atom_site.Cartn_z',
  '_atom_site.occupancy',
  '_atom_site.B_iso_or_equiv',
  'ATOM   1 N  N   . THR A 1 17.047 14.099 3.625 1.00 13.79',
  'ATOM   2 C  CA  . THR A 1 16.967 12.784 4.338 1.00 10.80',
  'ATOM   3 C  C   . THR A 1 15.685 12.755 5.133 1.00  9.19',
  'ATOM   4 O  O   . THR A 1 15.268 13.825 5.594 1.00  9.85',
  'ATOM   5 N  N   . THR A 2 15.115 11.555 5.265 1.00  7.81',
  'ATOM   6 C  CA  . THR A 2 13.856 11.469 6.066 1.00  8.31',
  'ATOM   7 N  N   A CYS A 3 13.488 11.241 8.417 0.60  5.24',
  'ATOM   8 N  N   B CYS A 3 13.500 11.300 8.400 0.40  5.30',
  'ATOM   9 C  CA  . CYS A 3 13.660 10.707 9.787 1.00  5.39',
  'ATOM  10 C  CA  . CYS A 4 12.000 10.000 11.00 1.00  6.00',
  'HETATM 11 O O1  . GOL D . 20.000 20.000 20.00 1.00 30.00',
  'HETATM 12 O O2  . GOL D . 20.500 20.500 20.50 1.00 31.00',
].join('\n');

test('parses atoms using label_* identifiers', function(assert) {
  var structure = io.cif(BASIC_CIF);
  assert.ok(!!structure);
  strictEqual(structure.chains().length, 2);
  var chainA = structure.chain('A');
  assert.ok(!!chainA);
  strictEqual(chainA.residues().length, 4);
  strictEqual(chainA.residueByRnum(1).atoms().length, 4);
  var ca = chainA.residueByRnum(1).atom('CA');
  assert.ok(!!ca);
  assert.vec3Equal(ca.pos(), [16.967, 12.784, 4.338], 1e-4);
  strictEqual(ca.element(), 'C');
});

test('filters alternate conformers to "." and "A"', function(assert) {
  var structure = io.cif(BASIC_CIF);
  var res3 = structure.chain('A').residueByRnum(3);
  // only the altloc-A and altloc-"." atoms should have been kept: N (alt A)
  // and CA (alt "."), not the altloc-B duplicate of N.
  strictEqual(res3.atoms().length, 2);
});

test('gives each atom the exact element from type_symbol, no guessing', function(assert) {
  var structure = io.cif(BASIC_CIF);
  var n = structure.chain('A').residueByRnum(1).atom('N');
  strictEqual(n.element(), 'N');
});

test('groups a multi-atom heteroatom group (label_seq_id ".") into one residue per asym id', function(assert) {
  var structure = io.cif(BASIC_CIF);
  var chainD = structure.chain('D');
  assert.ok(!!chainD);
  strictEqual(chainD.residues().length, 1);
  strictEqual(chainD.residues()[0].name(), 'GOL');
  strictEqual(chainD.residues()[0].atoms().length, 2);
});

var SS_CIF = [
  'loop_',
  '_atom_site.group_PDB',
  '_atom_site.id',
  '_atom_site.type_symbol',
  '_atom_site.label_atom_id',
  '_atom_site.label_comp_id',
  '_atom_site.label_asym_id',
  '_atom_site.label_seq_id',
  '_atom_site.Cartn_x',
  '_atom_site.Cartn_y',
  '_atom_site.Cartn_z',
  'ATOM  1 C CA THR A 1 0.0 0.0 0.0',
  'ATOM  2 C CA THR A 2 1.0 0.0 0.0',
  'ATOM  3 C CA THR A 3 2.0 0.0 0.0',
  'ATOM  4 C CA THR A 4 3.0 0.0 0.0',
  'ATOM  5 C CA THR B 1 0.0 1.0 0.0',
  'ATOM  6 C CA THR B 2 1.0 1.0 0.0',
  'ATOM  7 C CA THR B 3 2.0 1.0 0.0',
  'ATOM  8 C CA THR B 4 3.0 1.0 0.0',
  'loop_',
  '_struct_conf.conf_type_id',
  '_struct_conf.beg_label_asym_id',
  '_struct_conf.beg_label_seq_id',
  '_struct_conf.end_label_asym_id',
  '_struct_conf.end_label_seq_id',
  'HELX_P A 1 A 3',
  'loop_',
  '_struct_sheet_range.sheet_id',
  '_struct_sheet_range.beg_label_asym_id',
  '_struct_sheet_range.beg_label_seq_id',
  '_struct_sheet_range.end_label_asym_id',
  '_struct_sheet_range.end_label_seq_id',
  'S1 B 1 B 3',
].join('\n');

test('wires _struct_conf into helix secondary structure assignment', function(assert) {
  var structure = io.cif(SS_CIF);
  var chainA = structure.chain('A');
  strictEqual(chainA.residueByRnum(1).ss(), 'C');
  strictEqual(chainA.residueByRnum(2).ss(), 'H');
  strictEqual(chainA.residueByRnum(3).ss(), 'C');
  strictEqual(chainA.residueByRnum(4).ss(), 'C');
});

test('wires _struct_sheet_range into strand secondary structure assignment', function(assert) {
  var structure = io.cif(SS_CIF);
  var chainB = structure.chain('B');
  strictEqual(chainB.residueByRnum(1).ss(), 'C');
  strictEqual(chainB.residueByRnum(2).ss(), 'E');
  strictEqual(chainB.residueByRnum(3).ss(), 'C');
});

var ASSEMBLY_CIF = [
  'loop_',
  '_atom_site.group_PDB',
  '_atom_site.id',
  '_atom_site.type_symbol',
  '_atom_site.label_atom_id',
  '_atom_site.label_comp_id',
  '_atom_site.label_asym_id',
  '_atom_site.label_seq_id',
  '_atom_site.Cartn_x',
  '_atom_site.Cartn_y',
  '_atom_site.Cartn_z',
  'ATOM  1 C CA THR A 1 0.0 0.0 0.0',
  'loop_',
  '_pdbx_struct_oper_list.id',
  '_pdbx_struct_oper_list.matrix[1][1]',
  '_pdbx_struct_oper_list.matrix[1][2]',
  '_pdbx_struct_oper_list.matrix[1][3]',
  '_pdbx_struct_oper_list.matrix[2][1]',
  '_pdbx_struct_oper_list.matrix[2][2]',
  '_pdbx_struct_oper_list.matrix[2][3]',
  '_pdbx_struct_oper_list.matrix[3][1]',
  '_pdbx_struct_oper_list.matrix[3][2]',
  '_pdbx_struct_oper_list.matrix[3][3]',
  '_pdbx_struct_oper_list.vector[1]',
  '_pdbx_struct_oper_list.vector[2]',
  '_pdbx_struct_oper_list.vector[3]',
  '1 1 0 0 0 1 0 0 0 1 0 0 0',
  '2 1 0 0 0 1 0 0 0 1 10 0 0',
  '3 0 -1 0 1 0 0 0 0 1 0 0 0',
  'loop_',
  '_pdbx_struct_assembly_gen.assembly_id',
  '_pdbx_struct_assembly_gen.asym_id_list',
  '_pdbx_struct_assembly_gen.oper_expression',
  '1 A 1,2',
  '2 A (3)(2)',
].join('\n');

test('expands a plain comma-separated oper_expression into one generator', function(assert) {
  var structure = io.cif(ASSEMBLY_CIF);
  var assembly = structure.assembly('1');
  assert.ok(!!assembly);
  strictEqual(assembly.generators().length, 1);
  var gen = assembly.generator(0);
  deepEqual(gen.chains(), ['A']);
  strictEqual(gen.matrices().length, 2);
  assert.mat4Equal(gen.matrix(0), mat4.create());
  assert.mat4Equal(gen.matrix(1), mat4.fromValues(1,0,0,0, 0,1,0,0, 0,0,1,0, 10,0,0,1));
});

test('expands a parenthesized-product oper_expression via matrix composition', function(assert) {
  var structure = io.cif(ASSEMBLY_CIF);
  var assembly = structure.assembly('2');
  var gen = assembly.generator(0);
  strictEqual(gen.matrices().length, 1);

  var op2 = mat4.fromValues(1,0,0,0, 0,1,0,0, 0,0,1,0, 10,0,0,1);
  var op3 = mat4.fromValues(0,1,0,0, -1,0,0,0, 0,0,1,0, 0,0,0,1);
  // "(3)(2)" means operator 3 is applied first, then operator 2 -- i.e. the
  // resulting matrix is op2 * op3.
  var expected = mat4.create();
  mat4.multiply(expected, op2, op3);
  assert.mat4Equal(gen.matrix(0), expected);
});

// categories with a single row are commonly written as key-value pairs
// instead of a loop, e.g. for entries with one assembly or one helix.
var KEY_VALUE_CIF = [
  'loop_',
  '_atom_site.group_PDB',
  '_atom_site.id',
  '_atom_site.type_symbol',
  '_atom_site.label_atom_id',
  '_atom_site.label_comp_id',
  '_atom_site.label_asym_id',
  '_atom_site.label_seq_id',
  '_atom_site.Cartn_x',
  '_atom_site.Cartn_y',
  '_atom_site.Cartn_z',
  'ATOM  1 C CA THR A 1 0.0 0.0 0.0',
  'ATOM  2 C CA THR A 2 1.0 0.0 0.0',
  'ATOM  3 C CA THR A 3 2.0 0.0 0.0',
  '_struct_conf.conf_type_id      HELX_P',
  '_struct_conf.beg_label_asym_id A',
  '_struct_conf.beg_label_seq_id  1',
  '_struct_conf.end_label_asym_id A',
  '_struct_conf.end_label_seq_id  3',
  '_pdbx_struct_oper_list.id          1',
  '_pdbx_struct_oper_list.matrix[1][1] 1',
  '_pdbx_struct_oper_list.matrix[1][2] 0',
  '_pdbx_struct_oper_list.matrix[1][3] 0',
  '_pdbx_struct_oper_list.matrix[2][1] 0',
  '_pdbx_struct_oper_list.matrix[2][2] 1',
  '_pdbx_struct_oper_list.matrix[2][3] 0',
  '_pdbx_struct_oper_list.matrix[3][1] 0',
  '_pdbx_struct_oper_list.matrix[3][2] 0',
  '_pdbx_struct_oper_list.matrix[3][3] 1',
  '_pdbx_struct_oper_list.vector[1]   5',
  '_pdbx_struct_oper_list.vector[2]   0',
  '_pdbx_struct_oper_list.vector[3]   0',
  '_pdbx_struct_assembly_gen.assembly_id     1',
  '_pdbx_struct_assembly_gen.oper_expression 1',
  '_pdbx_struct_assembly_gen.asym_id_list    A',
].join('\n');

test('reads categories written as key-value pairs as single row tables', function(assert) {
  var structure = io.cif(KEY_VALUE_CIF);
  strictEqual(structure.chain('A').residueByRnum(2).ss(), 'H');
  var assembly = structure.assembly('1');
  assert.ok(!!assembly);
  deepEqual(assembly.generator(0).chains(), ['A']);
  assert.mat4Equal(assembly.generator(0).matrix(0),
                   mat4.fromValues(1,0,0,0, 0,1,0,0, 0,0,1,0, 5,0,0,1));
});

test('returns undefined for a document with no _atom_site loop', function(assert) {
  var structure = io.cif('_entry.id 1CRN\n');
  strictEqual(structure, undefined);
});
