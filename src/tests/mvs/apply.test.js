import { test, strictEqual, ok } from '../helpers';
import { applyMVS, applyMVSToStructure } from '../../mvs/apply';
import io from '../../io';

var TWO_CHAIN_PDB = '\
ATOM      1  CA  ALA A   1      11.104  13.207   2.100  1.00 10.00           C\n\
ATOM      2  CA  GLY A   2      12.560  13.454   2.400  1.00 10.00           C\n\
ATOM      3  CA  ALA B   1      20.104  13.207   2.100  1.00 10.00           C\n\
ATOM      4  CA  GLY B   2      21.560  13.454   2.400  1.00 10.00           C\n\
END\n\
';

function makeStubViewer(calls) {
  var record = function(method) {
    return function(name, structure, opts) {
      calls.push({ method: method, name: name, structure: structure, opts: opts || {} });
    };
  };
  return {
    cartoon: record('cartoon'),
    ballsAndSticks: record('ballsAndSticks'),
    lines: record('lines'),
    spheres: record('spheres'),
    trace: record('trace'),
  };
}

function makeTree(componentSelector, colorParams) {
  var representationChildren = colorParams ? [{ kind: 'color', params: colorParams }] : undefined;
  return {
    root: {
      kind: 'root',
      children: [
        {
          kind: 'download', params: { url: 'fake://structure.pdb' },
          children: [
            {
              kind: 'parse', params: { format: 'pdb' },
              children: [
                {
                  kind: 'structure', params: { type: 'model' },
                  children: [
                    {
                      kind: 'component', params: { selector: componentSelector },
                      children: [
                        { kind: 'representation', params: { type: 'cartoon' }, children: representationChildren },
                      ],
                    },
                    { kind: 'representation', params: { type: 'ball_and_stick' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

test('mvs apply: renders a component + colored representation, plus a bare representation defaulting to "all"', async function() {
  var calls = [];
  var viewer = makeStubViewer(calls);
  var tree = makeTree({ label_asym_id: 'A' }, { color: 'green' });
  var fetchStub = function() { return Promise.resolve(TWO_CHAIN_PDB); };

  await applyMVS(tree, viewer, { fetch: fetchStub, onWarning: function(msg) { throw new Error('unexpected warning: ' + msg); } });

  strictEqual(calls.length, 2);

  var cartoonCall = calls[0];
  strictEqual(cartoonCall.method, 'cartoon');
  strictEqual(cartoonCall.structure.chains().length, 1);
  strictEqual(cartoonCall.structure.chains()[0].name(), 'A');
  ok(cartoonCall.opts.color);

  var ballsCall = calls[1];
  strictEqual(ballsCall.method, 'ballsAndSticks');
  strictEqual(ballsCall.structure.chains().length, 2);
  strictEqual(ballsCall.opts.color, undefined);
});

test('mvs apply: unsupported selector fields/shorthands are reported via onWarning instead of failing silently', async function() {
  var calls = [];
  var viewer = makeStubViewer(calls);
  var tree = makeTree('nucleic', null);
  var fetchStub = function() { return Promise.resolve(TWO_CHAIN_PDB); };
  var warnings = [];

  await applyMVS(tree, viewer, { fetch: fetchStub, onWarning: function(msg) { warnings.push(msg); } });

  // the "nucleic" component is unsupported, so only the bare "all" representation renders.
  strictEqual(calls.length, 1);
  strictEqual(calls[0].method, 'ballsAndSticks');
  ok(warnings.some(function(w) { return w.indexOf('nucleic') !== -1; }));
});

test('mvs applyMVSToStructure: renders against an already-parsed structure, skipping download/parse', async function() {
  var calls = [];
  var viewer = makeStubViewer(calls);
  var structure = io.pdb(TWO_CHAIN_PDB);
  var tree = {
    root: {
      kind: 'root',
      children: [{
        kind: 'structure', params: { type: 'model' },
        children: [{
          kind: 'component', params: { selector: { label_asym_id: 'B' } },
          children: [{ kind: 'representation', params: { type: 'spacefill' } }],
        }],
      }],
    },
  };

  await applyMVSToStructure(structure, tree, viewer, {
    onWarning: function(msg) { throw new Error('unexpected warning: ' + msg); },
  });

  strictEqual(calls.length, 1);
  strictEqual(calls[0].method, 'spheres');
  strictEqual(calls[0].structure.chains().length, 1);
  strictEqual(calls[0].structure.chains()[0].name(), 'B');
});
