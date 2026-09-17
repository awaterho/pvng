import { test, strictEqual, deepEqual } from './helpers';
import { parseCIF } from '../cif';

test('parses simple key-value pairs', function(assert) {
  const doc = parseCIF('_entry.id 1CRN\n_exptl.method \'X-RAY DIFFRACTION\'\n');
  strictEqual(doc.getValue('entry', 'id'), '1CRN');
  strictEqual(doc.getValue('exptl', 'method'), 'X-RAY DIFFRACTION');
});

test('category/item lookups are case-insensitive', function(assert) {
  const doc = parseCIF('_Entry.Id 1CRN\n');
  strictEqual(doc.getValue('entry', 'id'), '1CRN');
});

test('ignores comments', function(assert) {
  const doc = parseCIF('# a comment\n_entry.id 1CRN # trailing comment\n');
  strictEqual(doc.getValue('entry', 'id'), '1CRN');
});

test('skips the data_ block header', function(assert) {
  const doc = parseCIF('data_1CRN\n_entry.id 1CRN\n');
  strictEqual(doc.getValue('entry', 'id'), '1CRN');
});

test('unquoted values may contain apostrophes not followed by whitespace', function(assert) {
  const doc = parseCIF([
    'loop_',
    '_atom_site.label_atom_id',
    '_atom_site.type_symbol',
    "O5' O",
    "C4' C",
  ].join('\n'));
  const rows = doc.loopRows('atom_site');
  strictEqual(rows.length, 2);
  strictEqual(rows[0].get('label_atom_id'), "O5'");
  strictEqual(rows[1].get('label_atom_id'), "C4'");
});

test('a quote mid-value only closes the value when followed by whitespace', function(assert) {
  // the embedded apostrophe is followed by '-' (not whitespace), so it does
  // not end the quoted value -- only the final quote (followed by EOL) does.
  const doc = parseCIF('_atom_site.label_comp_id "O5\'-phosphate"\n');
  strictEqual(doc.getValue('atom_site', 'label_comp_id'), "O5'-phosphate");
});

test('parses a semicolon-delimited multi-line text field', function(assert) {
  const doc = parseCIF([
    '_struct.pdbx_descriptor',
    ';first line',
    'second line',
    ';',
    '_entry.id 1CRN',
  ].join('\n'));
  strictEqual(doc.getValue('struct', 'pdbx_descriptor'), 'first line\nsecond line');
  strictEqual(doc.getValue('entry', 'id'), '1CRN');
});

test('parses a loop_ table into rows keyed by column name', function(assert) {
  const doc = parseCIF([
    'loop_',
    '_atom_site.group_PDB',
    '_atom_site.label_atom_id',
    '_atom_site.Cartn_x',
    'ATOM N 1.000',
    'ATOM CA 2.500',
    'HETATM O 3.750',
  ].join('\n'));
  const rows = doc.loopRows('atom_site');
  strictEqual(rows.length, 3);
  strictEqual(rows[0].get('group_pdb'), 'ATOM');
  strictEqual(rows[0].get('label_atom_id'), 'N');
  strictEqual(rows[0].getNumber('cartn_x'), 1.0);
  strictEqual(rows[2].get('group_pdb'), 'HETATM');
  strictEqual(rows[2].getNumber('cartn_x'), 3.75);
});

test('loop_ values may wrap across multiple lines', function(assert) {
  const doc = parseCIF([
    'loop_',
    '_atom_site.group_PDB',
    '_atom_site.label_atom_id',
    '_atom_site.Cartn_x',
    'ATOM',
    'N',
    '1.000',
    'ATOM CA 2.500',
  ].join('\n'));
  const rows = doc.loopRows('atom_site');
  strictEqual(rows.length, 2);
  strictEqual(rows[0].get('label_atom_id'), 'N');
  strictEqual(rows[1].getNumber('cartn_x'), 2.5);
});

test('returns an empty array for a loop that does not exist', function(assert) {
  const doc = parseCIF('_entry.id 1CRN\n');
  deepEqual(doc.loopRows('atom_site'), []);
});

test('getNumber treats . and ? as absent, not NaN', function(assert) {
  const doc = parseCIF([
    'loop_',
    '_atom_site.label_seq_id',
    '_atom_site.occupancy',
    '. ?',
    '5 1.00',
  ].join('\n'));
  const rows = doc.loopRows('atom_site');
  strictEqual(rows[0].getNumber('label_seq_id'), undefined);
  strictEqual(rows[0].getNumber('occupancy'), undefined);
  strictEqual(rows[0].get('label_seq_id'), '.');
  strictEqual(rows[1].getNumber('label_seq_id'), 5);
  strictEqual(rows[1].getNumber('occupancy'), 1.0);
});

test('get returns undefined for a column not present in the loop', function(assert) {
  const doc = parseCIF([
    'loop_',
    '_atom_site.label_atom_id',
    'N',
  ].join('\n'));
  const rows = doc.loopRows('atom_site');
  strictEqual(rows[0].get('cartn_x'), undefined);
});
