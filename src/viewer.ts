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

import { vec3, mat3, mat4 } from 'gl-matrix';
import color from './color';
import UniqueObjectIdPool from './unique-object-id-pool';
import canvasModule from './gfx/canvas';
import utils, { Range } from './utils';
import FrameBuffer from './gfx/framebuffer';
import SceneBuffers from './gfx/oit-buffers';
import PoolAllocator from './buffer-allocators';
import Cam, { type ShaderProgram } from './gfx/cam';
import shaders from './gfx/shaders';
import TouchHandler from './touch';
import MouseHandler from './mouse';
import renderModuleRaw from './gfx/render';
import type { RenderStructure, RenderOptions, RenderAtom } from './gfx/render';
import TextLabel, { type TextLabel as ITextLabel, type TextLabelOptions } from './gfx/label';
import CustomMeshCtor, { type CustomMesh } from './gfx/custom-mesh';
import anim from './gfx/animation';
import SceneNodeCtor, { type SceneNode as ISceneNode } from './gfx/scene-node';
import type { BaseGeom } from './gfx/base-geom';
import geom from './geom';
import slab from './slab';

// render.ts's exports object is typed as Record<string, unknown> (each
// property is only known to be one specific function from inside render.ts
// itself); this describes the shape actually used here.
interface RenderModule {
  spheres(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions): BaseGeom;
  billboardedSpheres(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions): BaseGeom;
  ballsAndSticks(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions): BaseGeom;
  points(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions): BaseGeom;
  lines(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions): BaseGeom;
  lineTrace(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions): BaseGeom;
  sline(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions): BaseGeom;
  trace(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions): BaseGeom;
  cartoon(structure: RenderStructure, gl: WebGL2RenderingContext, opts: RenderOptions): BaseGeom;
  surface(data: DataView, gl: WebGL2RenderingContext, opts: RenderOptions): BaseGeom;
}
const render = renderModuleRaw as unknown as RenderModule;

type RGBA = ReturnType<typeof color.forceRGB>;
type CanvasT = InstanceType<typeof canvasModule.Canvas>;
type SlabStrategy = InstanceType<typeof slab.FixedSlab> | InstanceType<typeof slab.AutoSlab> | null;
type EventCallback = (arg: unknown, event: unknown) => void;
type ClickHandler = EventCallback | 'center' | null;

// minimal structural type for the OES_draw_buffers_indexed extension object
// (not part of TypeScript's DOM lib): per-drawbuffer blend function, needed
// so the OIT accumulation pass's two render targets can each use a
// different blend equation in the same MRT draw call.
interface DrawBuffersIndexedExt {
  blendFunciOES(buf: number, src: number, dst: number): void;
}

// structural typing for the geometry objects tracked in this._objects: only
// what Viewer itself touches, common to every BaseGeom-derived render result
// (MeshGeom/LineGeom/BillboardGeom), CustomMesh and TextLabel alike.
interface ViewerObject {
  name(name?: string): string;
  destroy(): void;
  draw(cam: unknown, shaderCatalog: unknown, style: unknown, pass: unknown): void;
  order(order?: number): number;
  visible(): boolean;
  show(): void;
  hide(): void;
  updateProjectionIntervals(
    xAxis: vec3, yAxis: vec3, zAxis: vec3,
    xInterval: { update(v: number): void }, yInterval: { update(v: number): void },
    zInterval: { update(v: number): void },
  ): void;
  updateSquaredSphereRadius(center: vec3, radius: number | null): number | null;
}

interface PickedData {
  geom: BaseGeom;
  atom?: RenderAtom;
  isTrace?: boolean;
  center?: vec3;
  userData?: unknown;
}

interface ViewerExtension {
  optionOverrides?: (() => Record<string, unknown>) | null;
  init(viewer: Viewer): void;
}

// FIXME: Browser vendors tend to block quite a few graphic cards. Instead
//   of showing this very generic message, implement a per-browser
//   diagnostic. For example, when we detect that we are running a recent
//   Chrome and WebGL is not available, we should say that the user is
//   supposed to check chrome://gpu for details on why WebGL is not
//   available. Similar troubleshooting pages are available for other
//   browsers.
const WEBGL_NOT_SUPPORTED = '\
<div style="vertical-align:middle; text-align:center;">\
<h1>WebGL not supported</h1><p>Your browser does not support WebGL. \
You might want to try Chrome, Firefox, IE 11, or newer versions of Safari\
</p>\
<p>If you are using a recent version of one of the above browsers, your \
graphic card might be blocked. Check the browser documentation for details \
on how to unblock it.\
</p>\
</div>';

// gl-matrix v3 dropped mat4.fromMat3 (present in the v2.2.0 this code was
// originally written against); this reproduces its exact behavior: copy a
// mat3 into the upper-left 3x3 of an identity mat4.
function mat4FromMat3(out: mat4, a: mat3): mat4 {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  out[3] = 0;
  out[4] = a[3];
  out[5] = a[4];
  out[6] = a[5];
  out[7] = 0;
  out[8] = a[6];
  out[9] = a[7];
  out[10] = a[8];
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
}

function isiOS(): boolean {
  return (/(iPad|iPhone|iPod)/g).test(navigator.userAgent);
}

function isAndroid(): boolean {
  return (/Android/ig).test(navigator.userAgent);
}
function shouldUseHighPrecision(gl: WebGL2RenderingContext): boolean {
  // high precision for shaders is only required on iOS, all the other browsers
  // are doing just fine with mediump.
  const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)!;
  const highpSupported = !!highp.precision;
  return highpSupported && (isiOS() || isAndroid());
}

const requestAnimFrame = (function(){
  return window.requestAnimationFrame ||
         (window as unknown as { webkitRequestAnimationFrame?: typeof window.requestAnimationFrame })
             .webkitRequestAnimationFrame ||
         (window as unknown as { mozRequestAnimationFrame?: typeof window.requestAnimationFrame })
             .mozRequestAnimationFrame ||
         function(callback: FrameRequestCallback) {
           window.setTimeout(callback, 1000 / 60);
         };
})();

function slabModeToStrategy(mode?: string, options?: Record<string, unknown>): SlabStrategy {
  mode = mode || 'auto';
  if (mode === 'fixed') {
    return new slab.FixedSlab(options);
  }
  if (mode === 'auto') {
    return new slab.AutoSlab();
  }
  return null;
}


class PickedObject {
  private _pos: vec3;
  private _target: unknown;
  private _node: BaseGeom;
  private _symIndex: number | null;
  private _legacyObject: PickedData;
  private _legacyTransform: mat4 | null;
  private _connectivity: string;

  constructor(
    target: unknown, node: BaseGeom, symIndex: number | null, pos: vec3, object: PickedData,
    transform: mat4 | null, connectivity: string,
  ) {
    this._pos = pos;
    this._target = target;
    this._node = node;
    this._symIndex = symIndex;
    this._legacyObject = object;
    this._legacyTransform = transform;
    this._connectivity = connectivity;
  }

  symIndex(): number | null {
    return this._symIndex;
  }
  target(): unknown {
    return this._target;
  }
  pos(): vec3 {
    return this._pos;
  }

  connectivity(): string {
    return this._connectivity;
  }

  node(): BaseGeom {
    return this._node;
  }
  // the following functions are here for supporting the old pick interface.
  // It's use is discouraged as it's much more complicated to use.
  transform(): mat4 | null {
    return this._legacyTransform;
  }

  object(): PickedData {
    return this._legacyObject;
  }
}

function optValue<T>(opts: Record<string, unknown>, name: string, defaultValue: T): T {
  if (name in opts) {
    return opts[name] as T;
  }
  return defaultValue;
}


function getDoubleClickHandler(opts: Record<string, unknown>): ClickHandler {
  if (opts.atomDoubleClick) {
    console.warn('use of atomDoubleClick is deprecated. ',
                 'use doubleClick instead');
    return opts.atomDoubleClick as ClickHandler;
  }
  if (opts.atomDoubleClicked) {
    console.warn('use of atomDoubleClicked is deprecated. ',
                 'use doubleClick instead');
    return opts.atomDoubleClicked as ClickHandler;
  }
  if (opts.doubleClick) {
    return opts.doubleClick as ClickHandler;
  }
  return 'center';
}

function getClickHandler(opts: Record<string, unknown>): ClickHandler {
  if (opts.atomClick) {
    console.warn('use of atomClick is deprecated. ',
                 'use click instead');
    return opts.atomClick as ClickHandler;
  }
  if (opts.atomClicked) {
    console.warn('use of atomClicked is deprecated. ',
                 'use click instead');
    return opts.atomClicked as ClickHandler;
  }
  if (opts.click) {
    return opts.click as ClickHandler;
  }
  return null;
}

interface ResolvedViewerOptions {
  width: number;
  height: number;
  animateTime: number;
  antialias?: boolean;
  forceManualAntialiasing: boolean;
  quality: string;
  style: string;
  background: RGBA;
  slabMode: SlabStrategy;
  outline: boolean;
  outlineColor: RGBA;
  outlineWidth: number;
  selectionColor: RGBA;
  fov: number;
  doubleClick: ClickHandler;
  click: ClickHandler;
  fog: boolean;
  noKeyboardGrab: boolean;
  arcDetail?: number;
  sphereDetail?: number;
  splineDetail?: number;
  [key: string]: unknown;
}

class Viewer {
  private _options: ResolvedViewerOptions;
  private _extensions!: ViewerExtension[];
  private _initialized: boolean;
  private _objects: ViewerObject[];
  private _domElement: HTMLElement;
  private _redrawRequested: boolean;
  private _resize: boolean;
  private _lastTimestamp: number | null;
  private _objectIdManager: UniqueObjectIdPool<PickedData>;
  private _spin: ReturnType<typeof anim.spin> | null;
  private _rockAndRoll: ReturnType<typeof anim.rockAndRoll> | null;
  listenerMap: Record<string, EventCallback[]>;
  private _animControl: InstanceType<typeof anim.AnimationControl>;
  private _keyInput!: Document | HTMLTextAreaElement | null;
  private _canvas!: CanvasT | null;
  private _textureCanvas!: HTMLCanvasElement;
  // NOTE: not private -- structurally implements TouchViewer's
  // `_mouseHandler: { _mouseDoubleClick(...): void }` for touch.ts.
  _mouseHandler!: MouseHandler;
  private _touchHandler!: TouchHandler;
  private _pickBuffer!: FrameBuffer;
  private _sceneBuffers!: SceneBuffers;
  private _compositeShader!: ShaderProgram;
  private _compositeUniforms!: { opaqueColor: WebGLUniformLocation | null; accumTex: WebGLUniformLocation | null; revealTex: WebGLUniformLocation | null };
  private _blitShader!: ShaderProgram;
  private _blitUniforms!: { opaqueColor: WebGLUniformLocation | null };
  private _drawBuffersIndexedExt: DrawBuffersIndexedExt | null = null;
  private _2dcontext!: CanvasRenderingContext2D;
  private _float32Allocator!: PoolAllocator<Float32Array>;
  private _uint16Allocator!: PoolAllocator<Uint16Array>;
  private _cam!: Cam;
  private _shaderCatalog!: Record<string, ShaderProgram | null>;
  private _boundDraw!: () => void;

  constructor(domElement: HTMLElement, opts?: Record<string, unknown>) {
    this._options = this._initOptions(opts, domElement);

    this._initialized = false;
    this._objects = [];
    this._domElement = domElement;
    this._redrawRequested = false;
    this._resize = false;
    this._lastTimestamp = null;
    this._objectIdManager = new UniqueObjectIdPool<PickedData>();
    // these two are set to the animation objects when spin/rockAndRoll
    // are active
    this._spin = null;
    this._rockAndRoll = null;

    this.listenerMap = { };

    this._animControl = new anim.AnimationControl();
    this._initKeyboardInput();
    // NOTE: make sure to only request features supported by all browsers,
    // not only browsers that support WebGL in this constructor. WebGL
    // detection only happens in Viewer._initGL. Once this happened, we are
    // save to use whatever feature pleases us, e.g. typed arrays, 2D
    // contexts etc.
    this._initCanvas();

    this.quality(this._options.quality);

    if (this._options.click !== null) {
      this.on('click', this._options.click);
    }
    if (this._options.doubleClick !== null) {
      this.on('doubleClick', this._options.doubleClick);
    }


    if (document.readyState === "complete" ||
      (document.readyState as string) === "loaded" ||
        document.readyState === "interactive") {
      this._initViewer();
    } else {
      document.addEventListener('DOMContentLoaded',
                                utils.bind(this, this._initViewer) as EventListener);
    }
  }

  private _initOptions(opts: Record<string, unknown> | undefined, domElement: HTMLElement): ResolvedViewerOptions {
    opts = opts || {};
    this._extensions = (opts.extensions as ViewerExtension[]) || [];
    this._extensions.forEach(function(ext) {
      if (ext.optionOverrides !== null && ext.optionOverrides !== undefined) {
        utils.update(opts!, ext.optionOverrides());
      }
    });
    const options: ResolvedViewerOptions = {
      width : (opts.width as number || 500),
      height : (opts.height as number || 500),
      animateTime : (opts.animateTime as number || 0),
      antialias : opts.antialias as boolean | undefined,
      forceManualAntialiasing: optValue(opts, 'forceManualAntialiasing', true),
      quality : optValue(opts, 'quality', 'low'),
      style : optValue(opts, 'style', 'hemilight'),
      background : color.forceRGB(opts.background as string || 'white'),
      slabMode : slabModeToStrategy(opts.slabMode as string | undefined),
      outline : optValue(opts, 'outline', true),
      outlineColor : color.forceRGB(optValue(opts, 'outlineColor', 'black')),
      outlineWidth: optValue(opts, 'outlineWidth', 1.5),
      selectionColor : color.forceRGB(optValue<string | RGBA>(opts, 'selectionColor', '#3f3'),
                                      0.7),
      fov : optValue(opts, 'fov', 45.0),
      doubleClick : getDoubleClickHandler(opts),
      click : getClickHandler(opts),
      fog : optValue(opts, 'fog', true),
      noKeyboardGrab : optValue(opts, 'noKeyboardGrab', false),
    };
    const parentRect = domElement.getBoundingClientRect();
    if ((options.width as unknown) === 'auto') {
      options.width = parentRect.width;
    }
    if ((options.height as unknown) === 'auto') {
      options.height = parentRect.height;
    }
    return options;
  }

  // with rendering to avoid flickering.
  private _ensureSize(): void {
    if (!this._resize) {
      return;
    }
    this._resize = false;
    this._cam.setViewportSize(this._canvas!.viewportWidth(),
                              this._canvas!.viewportHeight());
    this._pickBuffer.resize(this._options.width, this._options.height);
    this._sceneBuffers.resize(this._canvas!.viewportWidth(), this._canvas!.viewportHeight());
  }

  resize(width: number, height: number): void {
    if (width === this._options.width && height === this._options.height) {
      return;
    }
    this._canvas!.resize(width, height);
    this._resize = true;
    this._options.width = width;
    this._options.height = height;
    this.requestRedraw();
  }

  fitParent(): void {
    const parentRect = this._domElement.getBoundingClientRect();
    this.resize(parentRect.width, parentRect.height);
  }

  gl(): WebGL2RenderingContext {
    return this._canvas!.gl();
  }

  ok(): boolean {
    return this._initialized;
  }

  options(optName: string, value?: unknown): unknown {
    if (value !== undefined) {
      this._options[optName] = value;
      if (optName === 'fog') {
        this._cam.fog(value as boolean);
        this.requestRedraw();
      } else if (optName === 'fov') {
        this._cam.setFieldOfViewY((value as number) * Math.PI / 180.0);
      } else if (optName === 'selectionColor') {
        this._cam.setSelectionColor(color.forceRGB(value as string | RGBA, 0.7));
      } else if (optName === 'outlineColor') {
        // NOTE: setOutlineColorColor is not a typo we introduced -- this
        // pre-existing call site never matched Cam's actual setOutlineColor
        // method name, so this option silently never took effect at runtime.
        (this._cam as unknown as { setOutlineColorColor(color: RGBA): void })
            .setOutlineColorColor(color.forceRGB(value as string | RGBA));
      } else if (optName === 'outlineWidth') {
        this._cam.setOutlineWidth((value as number) + 0.0 /* force to float*/);
      }
    }
    return this._options[optName];
  }

  quality(qual?: string): string {
    if (qual === undefined) {
      return this._options.quality;
    }
    this._options.quality = qual;
    if (qual === 'high') {
      this._options.arcDetail = 4;
      this._options.sphereDetail = 16;
      this._options.splineDetail = 8;
    }
    if (qual === 'medium') {
      this._options.arcDetail = 2;
      this._options.sphereDetail = 10;
      this._options.splineDetail = 5;
    }
    if (qual === 'low') {
      this._options.arcDetail = 2;
      this._options.sphereDetail = 8;
      this._options.splineDetail = 3;
    }
    return this._options.quality;
  }

  // returns the content of the WebGL context as a data URL element which can be
  // inserted into an img element. This allows users to save a picture to disk
  imageData(): string {
    return this._canvas!.imageData();
  }

  private _initPickBuffer(): void {
    const fbOptions = {
      width : this._options.width, height : this._options.height
    };
    this._pickBuffer = new FrameBuffer(this._canvas!.gl(), fbOptions);
  }

  private _initViewer(): boolean {
    if (!this._canvas!.initGL()) {
      this._domElement.removeChild(this._canvas!.domElement());
      this._domElement.innerHTML = WEBGL_NOT_SUPPORTED;
      this._domElement.style.width = this._options.width + 'px';
      this._domElement.style.height = this._options.height + 'px';
      return false;
    }
    this._initPickBuffer();
    this._2dcontext = this._textureCanvas.getContext('2d')!;
    this._float32Allocator = new PoolAllocator(Float32Array);
    this._uint16Allocator = new PoolAllocator(Uint16Array);
    this._cam = new Cam(this._canvas!.gl());
    this._cam.setUpsamplingFactor(this._canvas!.superSamplingFactor());
    this._cam.setOutlineWidth(this._options.outlineWidth);
    this._cam.setOutlineEnabled(this._options.outline);
    this._cam.fog(this._options.fog);
    this._cam.setFogColor(this._options.background as vec3);
    this._cam.setOutlineColor(this._options.outlineColor as vec3);
    this._cam.setSelectionColor(this._options.selectionColor);
    this._cam.setFieldOfViewY(this._options.fov * Math.PI / 180.0);
    this._mouseHandler.setCam(this._cam);

    const c = this._canvas!;
    const p = shouldUseHighPrecision(c.gl()) ? 'highp' : 'mediump';
    this._shaderCatalog = {
      hemilight : c.initShader(shaders.HEMILIGHT_VS,
                               shaders.PRELUDE_FS + shaders.HEMILIGHT_FS, p),
      phong : c.initShader(shaders.HEMILIGHT_VS,
                           shaders.PRELUDE_FS + shaders.PHONG_FS, p),
      outline : c.initShader(shaders.OUTLINE_VS,
                             shaders.PRELUDE_FS + shaders.OUTLINE_FS, p),
      lines : c.initShader(shaders.LINES_VS,
                           shaders.PRELUDE_FS + shaders.LINES_FS, p),
      text : c.initShader(shaders.TEXT_VS, shaders.TEXT_FS, p),
      selectLines : c.initShader(shaders.SELECT_LINES_VS,
                                 shaders.SELECT_LINES_FS, p),
      select : c.initShader(shaders.SELECT_VS, shaders.SELECT_FS, p)
    };
    const hasFragDepth = !!c.gl().getExtension('EXT_frag_depth');
    if (hasFragDepth) {
      this._shaderCatalog.spheres =
        c.initShader(shaders.SPHERES_VS,
                     shaders.PRELUDE_FS + shaders.SPHERES_FS, p);
      this._shaderCatalog.selectSpheres =
        c.initShader(shaders.SELECT_SPHERES_VS,
                     shaders.PRELUDE_FS + shaders.SELECT_SPHERES_FS, p);
    }

    this._sceneBuffers = new SceneBuffers(c.gl(), {
      width : c.viewportWidth(), height : c.viewportHeight(),
    });
    this._blitShader = c.initShader(shaders.OIT_COMPOSITE_VS, shaders.OIT_BLIT_FS, p)!;
    this._blitUniforms = {
      opaqueColor : c.gl().getUniformLocation(this._blitShader, 'opaqueColor'),
    };
    if (this._sceneBuffers.oitSupported()) {
      this._shaderCatalog.hemilightTransparent =
        c.initShader(shaders.OIT_ACCUM_VS, shaders.OIT_ACCUM_HEMILIGHT_FS, p);
      this._shaderCatalog.phongTransparent =
        c.initShader(shaders.OIT_ACCUM_VS, shaders.OIT_ACCUM_PHONG_FS, p);
      if (hasFragDepth) {
        this._shaderCatalog.spheresTransparent =
          c.initShader(shaders.OIT_ACCUM_SPHERES_VS, shaders.OIT_ACCUM_SPHERES_FS, p);
      }
      this._shaderCatalog.linesTransparent =
        c.initShader(shaders.OIT_ACCUM_LINES_VS, shaders.OIT_ACCUM_LINES_FS, p);
      this._compositeShader = c.initShader(
        shaders.OIT_COMPOSITE_VS, shaders.OIT_COMPOSITE_FS, p,
      )!;
      const gl2 = c.gl();
      this._compositeUniforms = {
        opaqueColor : gl2.getUniformLocation(this._compositeShader, 'opaqueColor'),
        accumTex : gl2.getUniformLocation(this._compositeShader, 'accumTex'),
        revealTex : gl2.getUniformLocation(this._compositeShader, 'revealTex'),
      };
      // per-drawbuffer blend state: the accumulation target needs additive
      // blending while the revealage target needs multiplicative blending,
      // in the same MRT draw call -- core WebGL2 only has one blend state
      // shared by every draw buffer, so this needs the indexed variant.
      this._drawBuffersIndexedExt = gl2.getExtension('OES_draw_buffers_indexed');
      if (this._drawBuffersIndexedExt === null) {
        this._sceneBuffers.disableOit();
      }
    }
    this._cam.setOpaqueOnly(this._sceneBuffers.oitSupported());
    this._boundDraw = utils.bind(this, this._draw) as () => void;
    this._touchHandler = new TouchHandler(this._canvas!.domElement(),
                                          this, this._cam);
    const gl = c.gl();
    let outlineOffset = 0.0;
    // in case we have fewer than 24 depth bits, we need to add offset
    // the drawn outline a tiny bit, as otherwise the outline appears on
    // top of the actual geometry.
    if (gl.getParameter(gl.DEPTH_BITS) >= 24) {
        outlineOffset = 0.00001;
    }
    const outlineProg = this._shaderCatalog.outline;
    gl.useProgram(outlineProg as WebGLProgram | null);
    gl.uniform1f(gl.getUniformLocation(outlineProg!, 'outlineOffset'),
                 outlineOffset);
    // call init on all registered extensions
    this._extensions.forEach((ext) => {
      ext.init(this);
    });
    if (!this._initialized) {
      this._initialized = true;
      this._dispatchEvent({'name':'viewerReadyEvent'} as unknown as Event,
                                     'viewerReady', this);
    }
    return true;
  }

  requestRedraw(): void {
    if (this._redrawRequested) {
      return;
    }
    this._redrawRequested = true;
    requestAnimFrame(this._boundDraw);
  }

  boundingClientRect(): DOMRect {
    return this._canvas!.domElement().getBoundingClientRect();
  }

  private _drawWithPass(pass: string): void {
    for (let i = 0, e = this._objects.length; i !== e; ++i) {
      this._objects[i]!
          .draw(this._cam, this._shaderCatalog, this._options.style, pass);
    }
  }

  private _initKeyboardInput(): void {
    if (this._options.noKeyboardGrab) {
        this._keyInput = null;
        return;
    }
    if (isiOS() || isAndroid()) {
      this._keyInput = document;
      return;
    }
    // this function creates a textarea element inside a div with height
    // and width of zero. When the user clicks on the viewer, we set
    // focus on the text area to receive text input. This makes sure we
    // only capture keypress events when the viewer is focused.
    const zeroSizedDiv = document.createElement('div');
    zeroSizedDiv.setAttribute('style', 'overflow:hidden;width:0;height:0');
    this._keyInput = document.createElement('textarea');
    this._domElement.appendChild(zeroSizedDiv);
    zeroSizedDiv.appendChild(this._keyInput);
    this._keyInput.focus();
  }

  focus(): void {
    if (this._keyInput === document || this._keyInput === null) {
      return;
    }
    (this._keyInput as HTMLTextAreaElement).focus();
  }

  private _initCanvas(): void {
    const canvasOptions = {
      antialias : this._options.antialias,
      forceManualAntialiasing: this._options.forceManualAntialiasing,
      height : this._options.height,
      width : this._options.width,
      backgroundColor : this._options.background as unknown as [number, number, number] | Float32Array
    };
    this._canvas = new canvasModule.Canvas(this._domElement, canvasOptions);
    this._textureCanvas = document.createElement('canvas');
    this._textureCanvas.style.display = 'none';
    this._domElement.appendChild(this._textureCanvas);
    this._mouseHandler = new MouseHandler(this._canvas as never, this, this._cam,
                                          this._options.animateTime);
    this._canvas.domElement()
        .addEventListener('mousedown', utils.bind(this, this.focus) as EventListener);
  }

  translate = (function() {
    const newCenter = vec3.create();
    const inverseRotation = mat4.create();
    return function(this: Viewer, vector: vec3, ms?: number) {
      ms = ms || 0;
      mat4.transpose(inverseRotation, this._cam.rotation());
      vec3.transformMat4(newCenter, vector, inverseRotation);
      vec3.sub(newCenter, this._cam.center(), newCenter);
      if (ms === 0) {
        this._cam.setCenter(newCenter);
        this.requestRedraw();
        return;
      }
      this._animControl.add(anim.move(this._cam.center(),
                                      vec3.clone(newCenter), ms) as never);
      this.requestRedraw();
    };
  })();

  rotate = (function() {
    const normalizedAxis = vec3.create();
    const targetRotation3 = mat3.create();
    const targetRotation4 = mat4.create();
    return function(this: Viewer, axis: vec3, angle: number, ms?: number) {
      ms = ms || 0;
      vec3.normalize(normalizedAxis, axis);
      geom.axisRotation(targetRotation3, normalizedAxis, angle);
      mat4FromMat3(targetRotation4, targetRotation3);
      mat4.mul(targetRotation4, targetRotation4, this._cam.rotation());
      if (ms === 0) {
        this._cam.setRotation(targetRotation4);
        this.requestRedraw();
        return;
      }

      this._animControl.add(anim.rotate(this._cam.rotation(),
                                        targetRotation4, ms) as never);
      this.requestRedraw();
    };
  })();

  setRotation(rotation: mat3 | mat4, ms?: number): void {
    ms = ms || 0;
    if (ms === 0) {
      this._cam.setRotation(rotation);
      this.requestRedraw();
      return;
    }
    // in case it's a mat3, convert to mat4
    let rotation4: mat4;
    if (rotation.length === 9) {
      rotation4 = mat4.create();
      mat4FromMat3(rotation4, rotation as mat3);
    } else {
      rotation4 = mat4.clone(rotation as mat4);
    }
    this._animControl.add(anim.rotate(this._cam.rotation(), rotation4, ms) as never);
    this.requestRedraw();
  }

  setCamera(rotation: mat3 | mat4, center: vec3, zoom: number, ms?: number): void {
    ms = ms || 0;
    this.setCenter(center, ms);
    this.setRotation(rotation, ms);
    this.setZoom(zoom, ms);
  }

  // performs interpolation of current camera position
  private _animateCam(): void {
    const anotherRedraw = this._animControl.run(this._cam as never);
    if (anotherRedraw) {
      this.requestRedraw();
    }
  }
  private _draw(): void {
    if (this._canvas === null) {
      // only happens when viewer has been destroyed
      return;
    }
    this._redrawRequested = false;
    this._animateCam();
    this._canvas.bind();
    // must be called "after" canvas.bind(). we need to some of the properties
    // calculated in canvas._ensureSize()
    this._ensureSize();
    const gl = this._canvas.gl();

    const newSlab = this._options.slabMode
        ? (this._options.slabMode.update as (objects: unknown[], cam: unknown) => InstanceType<typeof slab.Slab> | null)(
            this._objects, this._cam)
        : null;
    if (newSlab !== null) {
      this._cam.setNearFar(newSlab.near, newSlab.far);
    }

    const oit = this._sceneBuffers.oitSupported();

    // opaque pass: outline (silhouette) geometry and every fully-opaque
    // fragment, rendered into an offscreen target rather than directly onto
    // the canvas -- the transparent pass below (when OIT is supported)
    // needs to depth-test against this same depth buffer without writing to
    // it, which isn't possible against the canvas's own default framebuffer.
    this._sceneBuffers.bindOpaque();
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    // blending stays on for the whole opaque-target pass: when oit is true
    // it's a no-op, since every shader only lets fully-opaque fragments
    // reach this pass (shaders.ts's PRELUDE_FS opaqueOnly gate); when oit is
    // false (no float-render-target support) this is the only blending that
    // happens all frame, since there's no separate transparent pass to fall
    // back to.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (this._options.outline) {
      gl.cullFace(gl.BACK);
      this._drawWithPass('outline');
    }
    gl.cullFace(gl.FRONT);
    this._drawWithPass('normal');
    gl.disable(gl.BLEND);

    if (oit) {
      this._drawTransparent(gl);
    }

    this._compositeToCanvas(gl, oit);
  }

  // transparent pass: renders only translucent fragments (every
  // participating shader discards fragments with alpha ~1) into the
  // accumulation/revealage targets, depth-testing against (but not writing
  // to) the opaque pass's depth buffer. See gfx/oit-buffers.ts and
  // shaders.ts's OIT_ACCUM_*_FS for the weighted-blended-OIT math.
  private _drawTransparent(gl: WebGL2RenderingContext): void {
    this._sceneBuffers.bindTransparent();
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [1, 1, 1, 1]);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    const ext = this._drawBuffersIndexedExt!;
    ext.blendFunciOES(0, gl.ONE, gl.ONE);
    ext.blendFunciOES(1, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    this._drawWithPass('transparent');
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  // composites the (optional) transparent accumulation onto the opaque
  // target and presents the result on the visible canvas.
  private _compositeToCanvas(gl: WebGL2RenderingContext, oit: boolean): void {
    const width = this._canvas!.viewportWidth();
    const height = this._canvas!.viewportHeight();
    if (!oit) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(this._blitShader);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._sceneBuffers.opaqueColorTexture());
      gl.uniform1i(this._blitUniforms.opaqueColor, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      this._cam.invalidateCurrentShader();
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    // CULL_FACE is still enabled (cullFace(FRONT)) from the opaque pass --
    // the fullscreen composite triangle is front-facing and would be
    // silently culled entirely otherwise.
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this._compositeShader);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._sceneBuffers.opaqueColorTexture());
    gl.uniform1i(this._compositeUniforms.opaqueColor, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._sceneBuffers.accumTexture());
    gl.uniform1i(this._compositeUniforms.accumTex, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this._sceneBuffers.revealTexture());
    gl.uniform1i(this._compositeUniforms.revealTex, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    this._cam.invalidateCurrentShader();
  }

  setCenter(center: vec3, ms?: number): void {
    ms = ms || 0;
    if (ms === 0) {
      this._cam.setCenter(center);
      return;
    }
    this._animControl.add(anim.move(this._cam.center(),
                                    vec3.clone(center), ms) as never);
    this.requestRedraw();
  }

  zoom(): number {
    return this._cam.zoom();
  }
  setZoom(zoom: number, ms?: number): void {
    ms = ms || 0;
    if (ms === 0) {
      this._cam.setZoom(zoom);
      return;
    }
    this._animControl.add(anim.zoom(this._cam.zoom(), zoom, ms) as never);
    this.requestRedraw();
  }

  centerOn(what: { center(): vec3 }, ms?: number): void {
    this.setCenter(what.center(), ms);
  }


  clear(): void {
    for (let i = 0; i < this._objects.length; ++i) {
      this._objects[i]!.destroy();
    }
    this._objects = [];
  }

  on(eventName: string, callback: EventCallback | 'center'): void {
    if (eventName === 'keypress' ||
        eventName === 'keydown' ||
        eventName === 'keyup') {
      // attach keyboard events to key input text area. We will
      // only receive these events in case the text area has focus. Note that
      // _keyInput is set to the document in case we are running on a
      // tablet/phone as we wold pop up the on-screen keyboard otherwise.
      this._keyInput!.addEventListener(eventName, callback as EventListener, false);
      return;
    }
    if (eventName === 'viewpointChanged') {
      this._cam.addOnCameraChanged(callback as never);
      return;
    }
    if (eventName === 'mousemove' ||
        eventName === 'mousedown' || eventName === 'mouseup') {
      this._canvas!.domElement().addEventListener(eventName, callback as EventListener, false);
    }

    let callbacks = this.listenerMap[eventName];
    if (typeof callbacks === 'undefined') {
      callbacks = [];
      this.listenerMap[eventName] = callbacks;
    }
    if (callback === 'center') {
      const cb = utils.bind(
        this._mouseHandler,
        (this._mouseHandler as unknown as { _centerOnClicked: (picked: unknown) => void })._centerOnClicked,
      ) as EventCallback;
      callbacks.push(cb);
    } else {
      callbacks.push(callback);
    }
    // in case viewer is already initialized, fire viewerReady immediately.
    // Otherwise, the callback would never be invoked in this case:
    //
    // document.addEventListener('DOMContentLoaded', function() {
    //    viewer = pv.Viewer(...);
    //    viewer.on('viewerReady', function(viewer) {
    //    });
    // });
    if (this._initialized && eventName === 'viewerReady') {
      // don't use dispatch here, we only want this very callback to be
      // invoked.
      (callback as EventCallback)(this, null);
    }
  }

  addListener(eventName: string, callback: EventCallback | 'center'): void {
    this.on(eventName, callback);
  }

  // NOTE: not private -- structurally implements TouchViewer/MouseViewer's
  // _dispatchEvent for touch.ts/mouse.ts.
  _dispatchEvent(event: Event, newEventName: string, arg: unknown): void {
    const callbacks = this.listenerMap[newEventName];
    if (callbacks) {
      callbacks.forEach(function (callback) {
        callback(arg, event);
      });
    }
  }

  RENDER_MODES = [
    'sline', 'lines', 'trace', 'lineTrace', 'cartoon', 'tube', 'spheres',
    'ballsAndSticks', 'points'
  ];

  /// simple dispatcher which allows to render using a certain style.
  //  will bail out if the render mode does not exist.
  renderAs(name: string, structure: unknown, mode: string, opts?: Record<string, unknown>): BaseGeom | undefined {
    let found = false;
    for (let i = 0; i < this.RENDER_MODES.length; ++i) {
      if (this.RENDER_MODES[i] === mode) {
        found = true;
        break;
      }
    }
    if (!found) {
      console.error('render mode', mode, 'not supported');
      return;
    }

    return (this as unknown as Record<string, (name: string, structure: unknown, opts?: Record<string, unknown>) => BaseGeom>)[mode]!(name, structure, opts);
  }

  private _handleStandardMolOptions(
    opts: Record<string, unknown> | undefined, structure: { assembly(name: string): unknown },
  ): Record<string, unknown> {
    const resolved = this._handleStandardOptions(opts);
    resolved.showRelated = resolved.showRelated || 'asym';
    if (resolved.showRelated && resolved.showRelated !== 'asym') {
      if (structure.assembly(resolved.showRelated as string) === null) {
        console.error('no assembly with name', resolved.showRelated,
                      '. Falling back to asymmetric unit');
        resolved.showRelated = 'asym';
      }
    }
    return resolved;
  }

  private _handleStandardOptions(opts: Record<string, unknown> | undefined): Record<string, unknown> {
    const resolved = utils.copy(opts || {});
    resolved.float32Allocator = this._float32Allocator;
    resolved.uint16Allocator = this._uint16Allocator;
    resolved.idPool = this._objectIdManager;
    return resolved;
  }


  lineTrace(name: string, structure: RenderStructure, opts?: Record<string, unknown>): BaseGeom {
    const options = this._handleStandardMolOptions(opts, structure as never);
    options.color = options.color || color.uniform([ 1, 0, 1 ]);
    options.lineWidth = options.lineWidth || 4.0;

    const obj = render.lineTrace(structure, this._canvas!.gl(), options as unknown as RenderOptions);
    return this.add(name, obj);
  }

  spheres(name: string, structure: RenderStructure, opts?: Record<string, unknown>): BaseGeom {
    const options = this._handleStandardMolOptions(opts, structure as never);
    options.color = options.color || color.byElement();
    options.sphereDetail = this.options('sphereDetail');
    options.radiusMultiplier = options.radiusMultiplier || 1.0;
    let obj;
    // in case we can write to the depth buffer from the fragment shader
    // (EXT_frag_depth) we can use billboarded spheres instead of creating
    // the full sphere geometry. That's faster AND looks better.
    if (this._canvas!.gl().getExtension('EXT_frag_depth')) {
      obj = render.billboardedSpheres(structure, this._canvas!.gl(), options as unknown as RenderOptions);
    } else {
      obj = render.spheres(structure, this._canvas!.gl(), options as unknown as RenderOptions);
    }
    return this.add(name, obj);
  }

  sline(name: string, structure: RenderStructure, opts?: Record<string, unknown>): BaseGeom {
    const options = this._handleStandardMolOptions(opts, structure as never);
    options.color = options.color || color.uniform([ 1, 0, 1 ]);
    options.splineDetail = options.splineDetail || this.options('splineDetail');
    options.strength = options.strength || 1.0;
    options.lineWidth = options.lineWidth || 4.0;

    const obj = render.sline(structure, this._canvas!.gl(), options as unknown as RenderOptions);
    return this.add(name, obj);
  }

  cartoon(name: string, structure: RenderStructure, opts?: Record<string, unknown>): BaseGeom {
    const options = this._handleStandardMolOptions(opts, structure as never);
    options.color = options.color || color.bySS();
    options.strength = options.strength || 1.0;
    options.splineDetail = options.splineDetail || this.options('splineDetail');
    options.arcDetail = options.arcDetail || this.options('arcDetail');
    options.radius = options.radius || 0.3;
    options.forceTube = options.forceTube || false;
    options.smoothStrands =
        options.smoothStrands === undefined ? true : options.smoothStrands;
    const obj = render.cartoon(structure, this._canvas!.gl(), options as unknown as RenderOptions);
    const added = this.add(name, obj);
    return added;
  }


  surface(name: string, data: DataView, opts?: Record<string, unknown>): BaseGeom {
    const options = this._handleStandardOptions(opts);
    const obj = render.surface(data, this._canvas!.gl(), options as unknown as RenderOptions);
    return this.add(name, obj);
  }

  // renders the protein using a smoothly interpolated tube, essentially
  // identical to the cartoon render mode, but without special treatment for
  // helices and strands.
  tube(name: string, structure: RenderStructure, opts?: Record<string, unknown>): BaseGeom {
    opts = opts || {};
    opts.forceTube = true;
    return this.cartoon(name, structure, opts);
  }

  ballsAndSticks(name: string, structure: RenderStructure, opts?: Record<string, unknown>): BaseGeom {
    const options = this._handleStandardMolOptions(opts, structure as never);

    options.color = options.color || color.byElement();
    options.cylRadius = options.radius || options.cylRadius || 0.1;
    options.sphereRadius = options.radius || options.sphereRadius || 0.2;
    options.arcDetail = ((options.arcDetail as number) || (this.options('arcDetail') as number)) * 2;
    options.sphereDetail = options.sphereDetail || this.options('sphereDetail');
    options.scaleByAtomRadius = optValue(options, 'scaleByAtomRadius', true);

    const obj = render.ballsAndSticks(structure, this._canvas!.gl(), options as unknown as RenderOptions);
    return this.add(name, obj);
  }

  lines(name: string, structure: RenderStructure, opts?: Record<string, unknown>): BaseGeom {
    const options = this._handleStandardMolOptions(opts, structure as never);
    options.color = options.color || color.byElement();
    options.lineWidth = options.lineWidth || 4.0;
    const obj = render.lines(structure, this._canvas!.gl(), options as unknown as RenderOptions);
    return this.add(name, obj);
  }

  points(name: string, structure: RenderStructure, opts?: Record<string, unknown>): BaseGeom {
    const options = this._handleStandardMolOptions(opts, structure as never);
    options.color = options.color || color.byElement();
    options.pointSize = options.pointSize || 1.0;
    const obj = render.points(structure, this._canvas!.gl(), options as unknown as RenderOptions);
    return this.add(name, obj);
  }

  trace(name: string, structure: RenderStructure, opts?: Record<string, unknown>): BaseGeom {
    const options = this._handleStandardMolOptions(opts, structure as never);
    options.color = options.color || color.uniform([ 1, 0, 0 ]);
    options.radius = options.radius || 0.3;
    options.arcDetail = ((options.arcDetail as number) || (this.options('arcDetail') as number)) * 2;
    options.sphereDetail = options.sphereDetail || this.options('sphereDetail');

    const obj = render.trace(structure, this._canvas!.gl(), options as unknown as RenderOptions);
    return this.add(name, obj);
  }

  private _updateProjectionIntervals(
    axes: [vec3, vec3, vec3], intervals: [Range, Range, Range],
    structure: { eachAtom(callback: (atom: RenderAtom) => void): void },
  ): void {
    structure.eachAtom(function(atom) {
      const pos = atom.pos();
      for (let i = 0; i < 3; ++i) {
        intervals[i]!.update(vec3.dot(pos, axes[i]!));
      }
    });
    for (let i = 0; i < 3; ++i) {
      intervals[i]!.extend(1.5);
    }
  }

  fitTo(
    what: ISceneNode | { eachAtom(callback: (atom: RenderAtom) => void): void } | { length: number; [index: number]: unknown },
    ms?: number,
  ): void {
    const axes = this._cam.mainAxes();
    const intervals: [Range, Range, Range] =
        [ new Range(), new Range(), new Range() ];
    if (what instanceof SceneNodeCtor) {
      (what as unknown as ViewerObject).updateProjectionIntervals(axes[0], axes[1], axes[2], intervals[0],
                                     intervals[1], intervals[2]);
    } else if ((what as { eachAtom?: unknown }).eachAtom !== undefined) {
      this._updateProjectionIntervals(axes, intervals, what as { eachAtom(callback: (atom: RenderAtom) => void): void });
    } else if ((what as { length?: number }).length !== undefined) {
      const list = what as { length: number; [index: number]: { eachAtom(callback: (atom: RenderAtom) => void): void } };
      for (let i = 0; i < list.length; ++i) {
        this._updateProjectionIntervals(axes, intervals, list[i]!);
      }
    }
    this._fitToIntervals(axes, intervals, ms);
  }

  private _fitToIntervals(axes: [vec3, vec3, vec3], intervals: [Range, Range, Range], ms?: number): void {
    if (intervals[0].empty() || intervals[1].empty() || intervals[2].empty()) {
      console.error('could not determine interval. No objects shown?');
      return;
    }
    const cx = intervals[0].center();
    const cy = intervals[1].center();
    const cz = intervals[2].center();
    const center: vec3 = [
      cx * axes[0]![0] + cy * axes[1]![0] + cz * axes[2]![0],
      cx * axes[0]![1] + cy * axes[1]![1] + cz * axes[2]![1],
      cx * axes[0]![2] + cy * axes[1]![2] + cz * axes[2]![2]
    ] as unknown as vec3;
    const fovY = this._cam.fieldOfViewY();
    const aspect = this._cam.aspectRatio();
    const inPlaneX = intervals[0].length() / aspect;
    const inPlaneY = intervals[1].length();
    const inPlane = Math.max(inPlaneX, inPlaneY) * 0.5;
    const distanceToFront =  inPlane / Math.tan(0.5 * fovY);
    const newZoom =
        (distanceToFront + 0.5*intervals[2].length());
    const grace = 0.5;
    const near = Math.max(distanceToFront - grace, 0.1);
    const far = 2 * grace + distanceToFront + intervals[2].length();
    this._cam.setNearFar(near,  far);
    const time = ms === undefined ? this._options.animateTime : ms | 0;
    this.setCamera(this._cam.rotation(), center, newZoom, time);
    this.requestRedraw();
  }

  // adapt the zoom level to fit the viewport to all visible objects.
  autoZoom(ms?: number): void {
    const axes = this._cam.mainAxes();
    const intervals: [Range, Range, Range] =
        [ new Range(), new Range(), new Range() ];
    this.forEach(function(obj) {
      if (!obj.visible()) {
        return;
      }
      obj.updateProjectionIntervals(axes[0], axes[1], axes[2], intervals[0],
                                    intervals[1], intervals[2]);
    });
    this._fitToIntervals(axes, intervals, ms);
  }

  slabInterval(): void {
  }

  autoSlab(): void {
    // NOTE: this pre-existing typo (_slabMode instead of slabMode) means
    // this method has always been dead code -- this._options never had a
    // _slabMode field, so .update below always threw at runtime.
    const strategy = (this._options as unknown as { _slabMode?: SlabStrategy })._slabMode;
    const newSlab = strategy!.update(this._objects as never, this._cam as never);
    if (newSlab !== null) {
      this._cam.setNearFar(newSlab.near, newSlab.far);
    }
    this.requestRedraw();
  }

  // enable disable rock and rolling of camera
  rockAndRoll(enable?: boolean): boolean {
    if (enable === undefined) {
      return this._rockAndRoll !== null;
    }
    if (enable) {
      if (this._rockAndRoll === null) {
        this._rockAndRoll = anim.rockAndRoll();
        this._animControl.add(this._rockAndRoll as never);
        this.requestRedraw();
      }
      return true;
    }
    this._animControl.remove(this._rockAndRoll as never);
    this._rockAndRoll = null;
    this.requestRedraw();
    return false;
  }

  spin(speed?: number | boolean, axis?: vec3): boolean {
    if (speed === undefined) {
      return this._spin !== null;
    }
    if (speed === false) {
      this._animControl.remove(this._spin as never);
      this._spin = null;
      this.requestRedraw();
      return false;
    }
    if (speed === true) {
      speed = Math.PI/8;
    }
    axis = axis || ([0, 1, 0] as unknown as vec3);
    if (this._spin === null) {
      this._spin = anim.spin(axis, speed);
      this._animControl.add(this._spin as never);
    } else {
      this._spin.setSpeed(speed);
      this._spin.setAxis(axis);
    }
    this.requestRedraw();
    return true;
  }

  slabMode(mode?: string, options?: Record<string, unknown>): void {
    options = options || {};
    const strategy = slabModeToStrategy(mode, options);
    const newSlab = strategy
        ? (strategy.update as (objects: unknown[], cam: unknown) => InstanceType<typeof slab.Slab> | null)(
            this._objects, this._cam)
        : null;
    if (newSlab !== null) {
      this._cam.setNearFar(newSlab.near, newSlab.far);
    }
    this._options.slabMode = strategy;
    this.requestRedraw();
  }

  label(name: string, text: string, pos: vec3, options?: TextLabelOptions): ITextLabel {
    const label = new TextLabel(this._canvas!.gl(), this._textureCanvas,
                              this._2dcontext, pos, text, options);
    this.add(name, label as unknown as BaseGeom);
    return label;
  }
  customMesh(name: string, opts?: Record<string, unknown>): CustomMesh {
    const options = this._handleStandardOptions(opts);

    const mesh = new CustomMeshCtor(name, this._canvas!.gl(),
                              options.float32Allocator,
                              options.uint16Allocator,
                              options.idPool as never);
    this.add(name, mesh as unknown as BaseGeom);
    return mesh;
  }

  // INTERNAL: draws scene into offscreen pick buffer with the "select"
  // shader.
  private _drawPickingScene(): void {
    const gl = this._canvas!.gl();
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.clearColor(this._options.background[0]!, this._options.background[1]!,
                  this._options.background[2]!, 1.0);
    gl.cullFace(gl.FRONT);
    gl.enable(gl.CULL_FACE);
    this._drawWithPass('select');
  }

  pick(pos: { x: number; y: number }): PickedObject | null {
    this._pickBuffer.bind();
    this._drawPickingScene();
    let pixels: Uint8Array | { data: Uint8Array } = new Uint8Array(4);
    const gl = this._canvas!.gl();
    gl.readPixels(pos.x, this._options.height - pos.y, 1, 1,
                  gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    this._pickBuffer.release();
    if ((pixels as unknown as { data?: Uint8Array }).data) {
      pixels = (pixels as unknown as { data: Uint8Array }).data;
    }
    pixels = pixels as Uint8Array;
    const objId = pixels[0]! | (pixels[1]! << 8) | (pixels[2]! << 16);
    const symIndex = pixels[3]!;

    const picked = this._objectIdManager.objectForId(objId);
    if (picked === undefined) {
      return null;
    }
    let transformedPos = vec3.create();
    let target: unknown = null;
    let transform: mat4 | null = null;
    let connectivity = 'unknown';
    if (symIndex !== 255) {
      target = picked.atom;
      transform = picked.geom.symWithIndex(symIndex);
      vec3.transformMat4(transformedPos, picked.atom!.pos(), transform!);
      connectivity = picked.isTrace ? 'trace' : 'full';
    } else {
      if (picked.atom !== undefined) {
        target = picked.atom;
        transformedPos = picked.atom.pos();
        connectivity = picked.isTrace ? 'trace' : 'full';
      } else {
        target = picked.userData;
        transformedPos = picked.center!;
      }
    }
    return new PickedObject(target, picked.geom,
                            symIndex < 255 ? symIndex : null,
                            transformedPos, picked, transform,
                            connectivity);
  }

  add(name: string, obj: BaseGeom): BaseGeom {
    obj.name(name);
    this._objects.push(obj);
    this._objects.sort(function(lhs, rhs) {
      return lhs.order() - rhs.order();
    });
    this.requestRedraw();
    return obj;
  }

  private _globToRegex(glob: string): RegExp {
    const r = glob.replace('.', '\\.').replace('*', '.*');
    return new RegExp('^' + r + '$');
  }

  forEach(callback: (obj: ViewerObject, index: number) => void): void;
  forEach(pattern: string, callback: (obj: ViewerObject, index: number) => void): void;
  forEach(...args: [(obj: ViewerObject, index: number) => void] | [string, (obj: ViewerObject, index: number) => void]): void {
    let callback: (obj: ViewerObject, index: number) => void, pattern = '*';
    if (args.length === 2) {
      callback = args[1];
      pattern = args[0];
    } else {
      callback = args[0];
    }
    const regex = this._globToRegex(pattern);
    for (let i = 0; i < this._objects.length; ++i) {
      const obj = this._objects[i]!;
      if (regex.test(obj.name())) {
        callback(obj, i);
      }
    }
  }
  rotation(): mat4 {
    return this._cam.rotation();
  }

  center(): vec3 {
    return this._cam.center();
  }


  get(name: string): BaseGeom | null {
    for (let i = 0; i < this._objects.length; ++i) {
      if (this._objects[i]!.name() === name) {
        return this._objects[i] as unknown as BaseGeom;
      }
    }
    console.error('could not find object with name', name);
    return null;
  }

  hide(glob: string): void {
    this.forEach(glob, function(obj) { obj.hide(); });
  }

  show(glob: string): void {
    this.forEach(glob, function(obj) { obj.show(); });
  }

  // remove all objects whose names match the provided glob pattern from
  // the viewer.
  rm(glob: string): void {
    const newObjects: ViewerObject[] = [];
    const regex = this._globToRegex(glob);
    for (let i = 0; i < this._objects.length; ++i) {
      const obj = this._objects[i]!;
      if (!regex.test(obj.name())) {
        newObjects.push(obj);
      } else {
        obj.destroy();
      }
    }
    this._objects = newObjects;
  }
  all(): ViewerObject[] {
    return this._objects;
  }
  isWebGLSupported(): boolean {
    return this._canvas!.isWebGLSupported();
  }
  destroy(): void {
    this.clear();
    this._canvas!.destroy();
    this._canvas = null;
  }
}

export default {
  Viewer : function(elem: HTMLElement, options?: Record<string, unknown>) {
    return new Viewer(elem, options);
  },
  isWebGLSupported : canvasModule.isWebGLSupported
};
