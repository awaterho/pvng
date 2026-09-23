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

// draws biological assembly 1 (symmetry-related copies included) when the
// structure defines one, e.g. entries fetched from RCSB, and just the
// asymmetric unit otherwise. The local fixtures carry no assembly records.
function related() {
  return structure.assembly('1') ? '1' : 'asym';
}

// opacity slider (in #display-widget): applies to every currently-visible
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
                         showRelated : related() });
}

function lines() {
  viewer.clear();
  var go = viewer.lines('structure', structure, {
              color: color.byResidueProp('num'),
              showRelated : related() });
  go.setSelection(go.select({rnumRange : [15,20]}));
  go.setOpacity(0.5, go.select({rnumRange : [25,30]}));
}

function cartoon() {
  viewer.clear();
  var go = viewer.cartoon('structure', structure, {
      color : color.ssSuccession(), showRelated : related(),
  });
  var rotation = viewpoint.principalAxes(go);
  //go.setSelection(go.select({rtype : 'C' }));
  viewer.setRotation(rotation)
}

function lineTrace() {
  viewer.clear();
  viewer.lineTrace('structure', structure, { showRelated : related() });
}

function spheres() {
  viewer.clear();
  viewer.spheres('structure', structure, { showRelated : related() });
}

function sline() {
  viewer.clear();
  viewer.sline('structure', structure,
      { color : color.uniform('red'), showRelated : related() });
}

function tube() {
  viewer.clear();
  viewer.tube('structure', structure, { showRelated : related() });
  viewer.lines('structure.ca', structure.select({aname :'CA'}),
            { color: color.uniform('blue'), lineWidth : 1,
              showRelated : related() });
}

function trace() {
  viewer.clear();
  viewer.trace('structure', structure, { showRelated : related() });

}
function ballsAndSticks() {
  viewer.clear();
  viewer.ballsAndSticks('structure', structure, { showRelated : related() });
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
  document.getElementById('traj-widget').style.display = 'none';
  io.fetchCif('pdbs/'+cif_id+'.cif', function(s) {
    structure = s;
    preset();
    viewer.autoZoom();
  });
}

function trajectory() {
  viewer.clear();
  document.getElementById('traj-widget').style.display = 'block';
  var theTimeOut;
  var intervalFunc;
  var button = document.getElementById('traj-button');
  button.onclick = function(event) {
    event.preventDefault();
    if (button.textContent === 'Start') {
      button.textContent = 'Stop';
      theTimeOut = setInterval(intervalFunc, 1000.0/15.0);
    } else {
      clearInterval(theTimeOut);
      button.textContent = 'Start';
    }
  };
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
  document.getElementById('traj-widget').style.display = 'none';
  io.fetchCif('pdbs/1nmr.cif', function(structures) {
    viewer.clear()
    structure = structures[0];
    for (var i = 0; i < structures.length; ++i) {
      viewer.cartoon('ensemble_'+ i, structures[i]);
    }
    viewer.autoZoom();
  }, { loadAllModels : true } );
}
// menu behaviour, as Foundation's top-bar plugin used to provide it on top
// of the Foundation styles in index.html. On wide screens the dropdowns open
// on hover, which those styles key off the not-click class. On narrow
// screens the menu icon expands the bar, and a menu title slides in its
// entries with a Back link.
function initTopBar() {
  var bar = document.querySelector('.top-bar');
  var section = bar.querySelector('.top-bar-section');
  var narrow = window.matchMedia('(max-width: 40em)');
  var closeSubmenu = function() {
    bar.querySelectorAll('.has-dropdown.moved').forEach(function(item) {
      item.classList.remove('moved');
    });
    section.style.left = '';
    bar.style.height = '';
  };
  var collapse = function() {
    closeSubmenu();
    bar.classList.remove('expanded');
  };
  bar.querySelector('.toggle-topbar').addEventListener('click', function(event) {
    event.preventDefault();
    if (bar.classList.contains('expanded')) {
      collapse();
    } else {
      bar.classList.add('expanded');
    }
  });
  bar.querySelectorAll('.has-dropdown').forEach(function(item) {
    item.classList.add('not-click');
    var title = item.firstElementChild;
    var dropdown = item.querySelector('.dropdown');
    // same markup Foundation generates; the styles only show the
    // js-generated entries on narrow screens
    dropdown.insertAdjacentHTML('afterbegin',
      '<li class="title back js-generated"><h5><a href="#">Back</a></h5></li>' +
      '<li class="parent-link show-for-small"><a class="parent-link js-generated" href="#">' +
      title.textContent + '</a></li>');
    dropdown.querySelector('.back a').addEventListener('click', function(event) {
      event.preventDefault();
      closeSubmenu();
    });
    dropdown.querySelector('a.parent-link').addEventListener('click', function(event) {
      event.preventDefault();
    });
    title.addEventListener('click', function(event) {
      event.preventDefault();
      if (!narrow.matches) {
        return;
      }
      item.classList.add('moved');
      section.style.left = '-100%';
      bar.style.height = (bar.querySelector('.title-area').offsetHeight +
                          dropdown.offsetHeight) + 'px';
    });
  });
  // picking an entry closes the menu on narrow screens
  bar.querySelectorAll('.dropdown li:not(.title):not(.parent-link) > a').forEach(function(link) {
    link.addEventListener('click', collapse);
  });
  narrow.addEventListener('change', collapse);
}

function onClick(id, handler) {
  document.getElementById(id).addEventListener('click', function(event) {
    event.preventDefault();
    handler();
  });
}

initTopBar();
onClick('1r6a', transferase);
onClick('1crn', crambin);
onClick('1ake', kinase);
onClick('4ubb', polymerase);
onClick('4c46', longHelices);
onClick('2f8v', telethonin);
onClick('2por', porin);
onClick('ensemble', ensemble);
onClick('custom-mesh', cross);
onClick('style-cartoon', cartoon);
onClick('style-tube', tube);
onClick('style-line-trace', lineTrace);
onClick('style-sline', sline);
onClick('style-trace', trace);
onClick('style-lines', lines);
onClick('style-balls-and-sticks', ballsAndSticks);
onClick('style-surface', surface);
onClick('style-points', points);
onClick('style-spheres', spheres);
onClick('color-uniform', uniform);
onClick('color-element', byElement);
onClick('color-chain', byChain);
onClick('color-ss-succ', ssSuccession);
onClick('color-ss', ss);
onClick('trajectory', trajectory);
onClick('color-rainbow', rainbow);
onClick('color-pro-red', proInRed);
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

document.getElementById('load-from-pdb').addEventListener('change', function() {
  var pdbId = this.value;
  this.blur();
  getFromRcsb(pdbId);
});

document.getElementById('get-pdb-button').addEventListener('click', function(event) {
  event.preventDefault();
  var input = document.getElementById('load-from-pdb');
  var pdbId = input.value;
  input.value = '';
  input.blur();
  getFromRcsb(pdbId);
});

document.getElementById('opacity-slider').addEventListener('input', function() {
  var val = parseFloat(this.value);
  document.getElementById('opacity-value').textContent = val.toFixed(2);
  applyOpacity(val);
});

viewer = pv.Viewer(document.getElementById('viewer'), {
    width : 'auto', height: 'auto', antialias : true, fog : true,
    outline : true, quality : 'high',
    selectionColor : 'white',
    background : '#ccc', animateTime: 500, doubleClick : null
});
window.viewer = viewer;

// fog and outline toggles, and a background slider running from white to
// black. All start from the viewer's current options.
function initDisplayControls() {
  var fog = document.getElementById('fog-toggle');
  var outline = document.getElementById('outline-toggle');
  var background = document.getElementById('background-slider');
  fog.checked = viewer.options('fog');
  outline.checked = viewer.options('outline');
  background.value = 1 - viewer.options('background')[0];
  fog.addEventListener('change', function() {
    viewer.options('fog', fog.checked);
  });
  outline.addEventListener('change', function() {
    viewer.options('outline', outline.checked);
  });
  background.addEventListener('input', function() {
    var grey = 1 - parseFloat(background.value);
    viewer.options('background', [grey, grey, grey, 1]);
  });
}
initDisplayControls();

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
