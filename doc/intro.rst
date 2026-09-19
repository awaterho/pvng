Getting started with pvng
========================================================

Getting the pvng source-code
--------------------------------------------------------

`pvng` is built with `Vite <https://vitejs.dev>`_ and distributed via npm/git rather than as pre-built release tarballs or through bower. Clone the repository and build it yourself:

.. code-block:: bash

  git clone https://github.com/awaterho/pvng.git
  cd pvng
  npm install
  npm run build

This produces ``dist/pv.iife.js`` (a self-contained bundle defining a global ``pv``, suitable for a plain ``<script>`` tag), as well as ``dist/pv.js`` and ``dist/pv.cjs`` for use with a bundler or ``require``, plus generated TypeScript type declarations.

.. note::

  WebGL2 is required. pvng does not run in browsers without WebGL2 support.


Setting up a small website
-----------------------------------------------------

The following minimal example shows how to include pvng in a website for protein structure visualisation. For that purpose, we will create a small index.html file containing the bare-minimum required to run pvng. The example does not depend on any external library. But of course it is also possible to combine pvng with jQuery or other popular JS libraries.

In case you want to recreate the example, create a directory for the index.html file and change into that directory.

The index.html file
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

The page is essentially a bare-bone HTML page which includes the pv.iife.js bundle built above. In the preamble, we define a meta element to prevent page scrolling and load the pvng library.

.. code-block:: html

  <html>
  <head>
    <title>Dengue Virus Methyl Transferase</title>
    <meta name="viewport" content="width=device-width, user-scalable=no, minimum-scale=1.0, maximum-scale=1.0">
  </head>
  <body>
  <div id=viewer></div>
  </body>
  <script type='text/javascript' src='pv.iife.js'></script>


Now on to the interesting part. First, we :ref:`initialise the viewer <pv.viewer.init>` with custom settings. The width and height of the viewer are initialized to 600 pixels with antialising enabled and a medium detail level. These settings have been tested on a variety of devices and are known to work well for typical proteins.

.. code-block:: html

  <script type='text/javascript'>
  // override the default options with something less restrictive.
  var options = {
    width: 600,
    height: 600,
    antialias: true,
    quality : 'medium'
  };
  // insert the viewer under the Dom element with id 'gl'.
  var viewer = pv.Viewer(document.getElementById('viewer'), options);
  </script>


Most of the work happens in loadMethylTransferase. This function will be called when the DOMContentLoaded event fires and we will use it to populate the WebGL viewer with a nice protein structure.

.. code-block:: html

  <script type='text/javascript'>

  function loadMethylTransferase() {
    // asynchronously load the mmCIF file for the dengue methyl transferase
    // from the server and display it in the viewer. pv.io.fetchPdb is also
    // still available if you'd rather load a classic PDB file.
    pv.io.fetchCif('1r6a.cif', function(structure) {
        // display the protein as cartoon, coloring the secondary structure
        // elements in a rainbow gradient.
        viewer.cartoon('protein', structure, { color : pv.color.ssSuccession() });
        // there are two ligands in the structure, the co-factor S-adenosyl 
        // homocysteine and the inhibitor ribavirin-5' triphosphate. They have 
        // the three-letter codes SAH and RVP, respectively. Let's display them 
        // with balls and sticks.
        var ligands = structure.select({ rnames : ['SAH', 'RVP'] });
        viewer.ballsAndSticks('ligands', ligands);
        viewer.centerOn(structure);
    });
  }

  // load the methyl transferase once the DOM has finished loading. That's
  // the earliest point the WebGL context is available.
  document.addEventListener('DOMContentLoaded', loadMethylTransferase);
  </script>

Running the Example
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

Before running the example, we have to make sure that the pv.iife.js file and the mmCIF file for the methyl transferase are in the right location. Copy ``dist/pv.iife.js`` from your build and fetch the mmCIF file for 1r6a from `RCSB <https://www.rcsb.org/structure/1r6a>`_. Then serve the files with any static file server, for example:

.. code-block:: bash

  python -m http.server

And visit localhost:8000 with a WebGL2-enabled browser.
