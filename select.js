import PV from './src/index';

var pv = PV;
window.pv = pv;
var viewer = pv.Viewer(document.getElementById('viewer'), {
    width : 'auto', height: 'auto', antialias : true,
    outline : true, quality : 'medium', style : 'hemilight',
    selectionColor : 'red',
    background : '#333', animateTime: 500, doubleClick : null
});
window.viewer = viewer;

viewer.options('selectionColor', '#f00');

pv.io.fetchCif('/pdbs/1crn.cif', function(s) {
  viewer.on('viewerReady', function() {
    var go = viewer.spheres('crambin', s, { showRelated: '1'});
    go.setSelection(go.select({rnumRange : [15,20]}));
    viewer.autoZoom();
  });
});

document.addEventListener('keypress', function(ev) {
  if (ev.charCode === 13) {
    var allSelections = [];
    viewer.forEach(function(go) {
      if (go.selection !== undefined) {
        allSelections.push(go.selection());
      }
    });
    viewer.fitTo(allSelections);
  }
});

viewer.on('click', function(picked, ev) {
  if (picked === null || picked.target() === null) {
    return;
  }
  if (picked.node().structure === undefined) {
    return;
  }
  var extendSelection = ev.shiftKey;
  var sel;
  if (extendSelection) {
    sel = picked.node().selection();
  } else {
    sel = picked.node().structure().createEmptyView();
  }
  if (!sel.removeAtom(picked.target(), true)) {
    // in case atom was not part of the view, we have to add it, because it 
    // wasn't selected before. Otherwise removeAtom took care of it.
    sel.addAtom(picked.target());
  } 
  picked.node().setSelection(sel);
  viewer.requestRedraw();
});
