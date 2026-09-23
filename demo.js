var viewer;

// index.html (dev) doesn't build/load dist/pv.iife.js
// bundle, so fall back to importing the TypeScript source directly --
// this only works when served through the Vite dev server, which
// transpiles it on the fly.
var pv = window.pv;
if (!pv) {
  pv = (await import('./src/index')).default;
  window.pv = pv;
}
var io = pv.io;
var viewpoint = pv.viewpoint;
var color = pv.color;

var structure;

// opacity slider (#opacity-widget): applies to every currently-visible
// render object that supports it, and is re-applied by preset() whenever a
// new structure is loaded, so dragging the slider then loading a different
// structure keeps the same transparency -- a quick way to see the
// weighted-blended OIT pipeline (viewer.ts's _draw()) composite overlapping
// translucent cartoon/sphere geometry correctly regardless of draw order.
var currentOpacity = 1.0;
function applyOpacity(val) {
  currentOpacity = val;
  viewer.forEach(function(go) {
    if (typeof go.setOpacity === 'function') {
      go.setOpacity(val);
    }
  });
  viewer.requestRedraw();
}

function points() {
  viewer.clear();
  viewer.points('structure', structure, {
                         color: color.byResidueProp('num'),
                         showRelated : '1' });
}

function lines() {
  viewer.clear();
  var go = viewer.lines('structure', structure, {
              color: color.byResidueProp('num'),
              showRelated : '1' });
  go.setSelection(go.select({rnumRange : [15,20]}));
  go.setOpacity(0.5, go.select({rnumRange : [25,30]}));
}

function cartoon() {
  viewer.clear();
  var go = viewer.cartoon('structure', structure, {
      color : color.ssSuccession(), showRelated : '1',
  });
  var rotation = viewpoint.principalAxes(go);
  //go.setSelection(go.select({rtype : 'C' }));
  viewer.setRotation(rotation)
}

function lineTrace() {
  viewer.clear();
  viewer.lineTrace('structure', structure, { showRelated : '1' });
}

function spheres() {
  viewer.clear();
  viewer.spheres('structure', structure, { showRelated : '1' });
}

function sline() {
  viewer.clear();
  viewer.sline('structure', structure,
          { color : color.uniform('red'), showRelated : '1'});
}

function tube() {
  viewer.clear();
  viewer.tube('structure', structure);
  viewer.lines('structure.ca', structure.select({aname :'CA'}),
            { color: color.uniform('blue'), lineWidth : 1,
              showRelated : '1' });
}

function trace() {
  viewer.clear();
  viewer.trace('structure', structure, { showRelated : '1' });

}
function ballsAndSticks() {
  viewer.clear();
  viewer.ballsAndSticks('structure', structure, { showRelated : '1' });
}

function surface() {
  viewer.clear();
  viewer.surface('structure', structure.select('protein'), {
    color: color.ssSuccession()
  }).then(function(go) {
    if (go) {
      go.setOpacity(currentOpacity);
    }
  });
}

function preset() {
  viewer.clear();
  var ligand = structure.select({'rnames' : ['SAH', 'RVP']});
  viewer.ballsAndSticks('structure.ligand', ligand, {
  });
  viewer.cartoon('structure.protein', structure, { boundingSpheres: false });
  applyOpacity(currentOpacity);
}

// loads a structure from its local mmCIF fixture (pdbs/<id>.cif).
function load(cif_id) {
  $('#traj-widget').hide();
  io.fetchCif('pdbs/'+cif_id+'.cif', function(s) {
    structure = s;
    preset();
    viewer.autoZoom();
  });
}

function trajectory() {
  viewer.clear();
  $('#traj-widget').show();
  var theTimeOut;
  var intervalFunc;
  $('#traj-button').click(function() {
    var t = $('#traj-button').text();
    if (t === 'Start') {
      $('#traj-button').text('Stop');
      theTimeOut = setInterval(intervalFunc, 1000.0/15.0);
    } else {
      clearInterval(theTimeOut);
      $('#traj-button').text('Start');
    }
  });
  pv.io.fetchCrd('pdbs/trj.crd', function(s) {
    structure = s;
    viewer.ballsAndSticks('trajectory', structure);
    viewer.autoZoom();
    pv.traj.fetchDcd('pdbs/trj.dcd', s, function(cg) {
      var frameId = 0;
      intervalFunc = function() {
        cg.useFrame(frameId);
        frameId += 1;
        frameId = frameId % 32;
        viewer.clear();
        viewer.ballsAndSticks('trajectory', structure);
      };
    });
  });
}

function kinase() {
  load('1ake');
}

function crambin() {
  load('1crn');
}

function transferase() {
  load('1r6a');
}

function telethonin() { load('2f8v'); }

function porin() {
  load('2por');
}
function longHelices() {
  load('4C46');
}

function ssSuccession() {
  viewer.forEach(function(go) {
    go.colorBy(color.ssSuccession());
  });
  viewer.requestRedraw();
}

function uniform() {
  viewer.forEach(function(go) {
    go.colorBy(color.uniform([0,1,0]));
  });
  viewer.requestRedraw();
}
function byElement() {
  viewer.forEach(function(go) {
    go.colorBy(color.byElement());
  });
  viewer.requestRedraw();
}

function ss() {
  viewer.forEach(function(go) {
    go.colorBy(color.bySS());
  });
  viewer.requestRedraw();
}

function proInRed() {
  viewer.forEach(function(go) {
    go.colorBy(color.uniform('red'), go.select({rname : 'PRO'}));
  });
  viewer.requestRedraw();
}
function rainbow() {
  viewer.forEach(function(go) {
    go.colorBy(color.rainbow());
  });
  viewer.requestRedraw();
}

function byChain() {
  viewer.forEach(function(go) {
    go.colorBy(color.byChain());
  });
  viewer.requestRedraw();
}

function polymerase() {
  load('4UBB');
};


function cross() {
  viewer.clear();
  var go = viewer.customMesh('custom');

  go.addSphere([-10, 0, 0], 2, { userData : 'one' } );
  go.addSphere([10, 0, 0], 2, { userData : 'two' } );
  go.addSphere([0, -10, 0], 2, { userData : 'three' } );
  go.addSphere([0, 10, 0], 2, { userData : 'four' } );
  go.addSphere([0, 0, -10], 2, { userData : 'five' } );
  go.addSphere([0, 0, 10], 2, { userData : 'six' } );
  viewer.setCenter([0,0,0], 2, { userData : 'seven' } );
  viewer.setZoom(20);
}

function ensemble() {
  $('#traj-widget').hide();
  io.fetchCif('pdbs/1nmr.cif', function(structures) {
    viewer.clear()
    structure = structures[0];
    for (var i = 0; i < structures.length; ++i) {
      viewer.cartoon('ensemble_'+ i, structures[i]);
    }
    viewer.autoZoom();
  }, { loadAllModels : true } );
}
$(document).foundation();
$('#1r6a').click(transferase);
$('#1crn').click(crambin);
$('#1ake').click(kinase);
$('#4ubb').click(polymerase);
$('#4c46').click(longHelices);
$('#2f8v').click(telethonin);
$('#2por').click(porin);
$('#ensemble').click(ensemble);
$('#custom-mesh').click(cross);
$('#style-cartoon').click(cartoon);
$('#style-tube').click(tube);
$('#style-line-trace').click(lineTrace);
$('#style-sline').click(sline);
$('#style-trace').click(trace);
$('#style-lines').click(lines);
$('#style-balls-and-sticks').click(ballsAndSticks);
$('#style-surface').click(surface);
$('#style-points').click(points);
$('#style-spheres').click(spheres);
$('#color-uniform').click(uniform);
$('#color-element').click(byElement);
$('#color-chain').click(byChain);
$('#color-ss-succ').click(ssSuccession);
$('#color-ss').click(ss);
$('#trajectory').click(trajectory);
$('#color-rainbow').click(rainbow);
$('#color-pro-red').click(proInRed);
// fetches and renders a structure by PDB id from RCSB in mmCIF format, used
// by both pressing Enter/blurring the input (the 'change' event) and
// clicking the "Get" button next to it.
function getFromRcsb(pdbId) {
  if (!pdbId) {
    return;
  }
  var url = 'https://files.rcsb.org/download/' + pdbId + '.cif';
  io.fetchCif(url, function(s) {
    structure = s;
    cartoon();
    viewer.autoZoom();
  });
}

$('#load-from-pdb').change(function() {
  var pdbId = this.value;
  this.value = '';
  this.blur();
  getFromRcsb(pdbId);
});

$('#get-pdb-button').click(function() {
  var input = $('#load-from-pdb');
  var pdbId = input.val();
  input.val('');
  input.blur();
  getFromRcsb(pdbId);
});

$('#opacity-slider').on('input', function() {
  var val = parseFloat(this.value);
  $('#opacity-value').text(val.toFixed(2));
  applyOpacity(val);
});

viewer = pv.Viewer(document.getElementById('viewer'), {
    width : 'auto', height: 'auto', antialias : true, fog : true,
    outline : true, quality : 'high',
    selectionColor : 'white',
    background : '#ccc', animateTime: 500, doubleClick : null
});
window.viewer = viewer;

viewer.addListener('viewerReady', transferase);

viewer.on('doubleClick', function(picked) {
  if (picked === null) {
    viewer.fitTo(structure);
    return;
  }
  viewer.setCenter(picked.pos(), 500);
});

window.addEventListener('resize', function() {
      viewer.fitParent();
});
