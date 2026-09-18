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


import utils from '../utils';
import type { GLWithViewport, ShaderProgram } from './cam';

interface CanvasOptions {
  width: number;
  height: number;
  antialias?: boolean;
  backgroundColor: [number, number, number] | Float32Array;
  forceManualAntialiasing?: boolean;
}

function isWebGLSupported(gl?: WebGL2RenderingContext | null): boolean {
  if (document.readyState !== "complete" &&
      (document.readyState as string) !== "loaded" &&
      document.readyState !== "interactive") {
    console.error('isWebGLSupported only works after DOMContentLoaded');
    return false;
  }
  if (gl === undefined) {
    try {
      const canvas = document.createElement("canvas");
      return !!  (window.WebGL2RenderingContext &&
          canvas.getContext("webgl2"));
    } catch {
      return false;
    }
  }
  return !!gl;
}


class Canvas {
  private _width: number;
  private _antialias: boolean | undefined;
  private _height: number;
  private _resize: boolean;
  private _lastTimestamp: number | null;
  private _domElement: HTMLElement;
  private _backgroundColor: [number, number, number] | Float32Array;
  private _forceManualAntialiasing: boolean | undefined;
  private _canvas!: HTMLCanvasElement;
  private _gl!: GLWithViewport;
  private _samples!: number;
  private _realWidth!: number;
  private _realHeight!: number;

  constructor(parentElement: HTMLElement, options: CanvasOptions) {
    this._width = options.width;
    this._antialias = options.antialias;
    this._height = options.height;
    this._resize = false;
    this._lastTimestamp = null;
    this._domElement = parentElement;
    this._initCanvas();
    this._backgroundColor = options.backgroundColor;
    this._forceManualAntialiasing = options.forceManualAntialiasing;
  }

  private _ensureSize(): void {
    if (!this._resize) {
      return;
    }
    this._resize = false;
    const realWidth = this._width * this._samples;
    const realHeight = this._height * this._samples;
    this._realWidth = realWidth;
    this._realHeight = realHeight;
    this._gl.viewport(0, 0, realWidth, realHeight);
    this._applySize(realWidth, realHeight);
  }

  // Sets the canvas' drawing-buffer resolution (width/height attributes,
  // which may be a multiple of the logical size when using manual
  // supersampled antialiasing) while pinning its CSS layout size to the
  // logical this._width/this._height. Without an explicit CSS size, the
  // element's layout box defaults to the (possibly supersampled) attribute
  // size, e.g. doubling the space it takes up in the page.
  private _applySize(realWidth: number, realHeight: number): void {
    this._canvas.width = realWidth;
    this._canvas.height = realHeight;
    this._canvas.style.width = this._width + 'px';
    this._canvas.style.height = this._height + 'px';
  }

  // tells the canvas to resize. The resize does not happen immediately but is
  // delayed until the next redraw. This avoids flickering
  resize(width: number, height: number): void {
    if (width === this._width && height === this._height) {
      return;
    }
    this._resize = true;
    this._width = width;
    this._height = height;
  }

  fitParent(): void {
    const parentRect = this._domElement.getBoundingClientRect();
    this.resize(parentRect.width, parentRect.height);
  }

  gl(): GLWithViewport {
    return this._gl;
  }


  // returns the content of the WebGL context as a data URL element which can be
  // inserted into an img element. This allows users to save a picture to disk
  imageData(): string {
    return this._canvas.toDataURL();
  }

  private _initContext(): boolean {
    try {
      const contextOpts = {
        antialias : this._antialias && !this._forceManualAntialiasing,
        preserveDrawingBuffer : true // for image export
      };
      this._gl = this._canvas.getContext('webgl2', contextOpts) as unknown as GLWithViewport;
    }
    catch (err) {
      console.error('WebGL not supported', err);
      return false;
    }
    if (!this._gl) {
      console.error('WebGL not supported');
      return false;
    }
    return true;
  }

  initGL(): boolean {
    let samples = 1;
    if (!this._initContext()) {
      return false;
    }

    const gl = this._gl;
    if (!gl.getContextAttributes()!.antialias &&
        this._forceManualAntialiasing && this._antialias) {
      samples = 2;
    }
    this._realWidth = this._width * samples;
    this._realHeight = this._height * samples;
    this._samples = samples;
    this._applySize(this._realWidth, this._realHeight);
    gl.viewportWidth = this._realWidth;
    gl.viewportHeight = this._realHeight;

    gl.clearColor(this._backgroundColor[0]!, this._backgroundColor[1]!,
                  this._backgroundColor[2]!, 1.0);
    gl.lineWidth(2.0);
    gl.cullFace(gl.FRONT);
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    return true;
  }


  private _shaderFromString(shader_code: string, type: 'fragment' | 'vertex', precision: string): WebGLShader | null {
    let shader;
    const gl = this._gl;
    if (type === 'fragment') {
      shader = gl.createShader(gl.FRAGMENT_SHADER)!;
    } else if (type === 'vertex') {
      shader = gl.createShader(gl.VERTEX_SHADER)!;
    } else {
      console.error('could not determine type for shader');
      return null;
    }

    // replace the precision placeholder in shader source code with appropriate
    // value. See comment on top of shaders.js for details.
    const code = shader_code.replace('${PRECISION}', precision);
    gl.shaderSource(shader, code);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.log(code);
      console.error(gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  }

  initShader(vert_shader: string, frag_shader: string, precision: string): ShaderProgram | null {
    const gl = this._gl;
    const fs = this._shaderFromString(frag_shader, 'fragment', precision);
    const vs = this._shaderFromString(vert_shader, 'vertex', precision);
    const shaderProgram = gl.createProgram() as unknown as ShaderProgram & Record<string, unknown>;
    gl.attachShader(shaderProgram, vs!);
    gl.attachShader(shaderProgram, fs!);
    gl.linkProgram(shaderProgram);
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
      console.error('could not initialise shaders');
      console.error(gl.getShaderInfoLog(shaderProgram));
      return null;
    }
    // get vertex attribute location for the shader once to
    // avoid repeated calls to getAttribLocation/getUniformLocation
    const getAttribLoc = utils.bind(gl, gl.getAttribLocation) as (p: WebGLProgram, name: string) => number;
    const getUniformLoc = utils.bind(gl, gl.getUniformLocation) as
      (p: WebGLProgram, name: string) => WebGLUniformLocation | null;
    shaderProgram.posAttrib = getAttribLoc(shaderProgram, 'attrPos');
    shaderProgram.colorAttrib = getAttribLoc(shaderProgram, 'attrColor');
    shaderProgram.normalAttrib = getAttribLoc(shaderProgram, 'attrNormal');
    shaderProgram.objIdAttrib = getAttribLoc(shaderProgram, 'attrObjId');
    shaderProgram.selectAttrib = getAttribLoc(shaderProgram, 'attrSelect');
    shaderProgram.symId = getUniformLoc(shaderProgram, 'symId')!;
    shaderProgram.projection = getUniformLoc(shaderProgram, 'projectionMat')!;
    shaderProgram.modelview = getUniformLoc(shaderProgram, 'modelviewMat')!;
    shaderProgram.rotation = getUniformLoc(shaderProgram, 'rotationMat')!;
    shaderProgram.fog = getUniformLoc(shaderProgram, 'fog')!;
    shaderProgram.fogFar = getUniformLoc(shaderProgram, 'fogFar')!;
    shaderProgram.fogNear = getUniformLoc(shaderProgram, 'fogNear')!;
    shaderProgram.fogColor = getUniformLoc(shaderProgram, 'fogColor')!;
    shaderProgram.outlineColor = getUniformLoc(shaderProgram, 'outlineColor')!;
    shaderProgram.outlineWidth = getUniformLoc(shaderProgram, 'outlineWidth')!;
    shaderProgram.relativePixelSize = getUniformLoc(shaderProgram,
                                                    'relativePixelSize')!;
    shaderProgram.selectionColor = getUniformLoc(shaderProgram,
                                                 'selectionColor')!;
    shaderProgram.pointSize = getUniformLoc(shaderProgram, 'pointSize')!;
    shaderProgram.zoom = getUniformLoc(shaderProgram, 'zoom')!;
    shaderProgram.outlineEnabled = getUniformLoc(shaderProgram,
                                                 'outlineEnabled')!;
    shaderProgram.opaqueOnly = getUniformLoc(shaderProgram, 'opaqueOnly')!;

    return shaderProgram as unknown as ShaderProgram;
  }

  // register event handler on canvas DOM element
  on(name: string, handler: (event: Event) => void): void {
    this._canvas.addEventListener(name, handler, false);
  }
  removeEventListener(name: string, listener: (event: Event) => void): void {
    this._canvas.removeEventListener(name, listener, false);
  }

  // helper to register different event handler depending on whether we are
  // running in firefox or any other browser
  onWheel(firefoxHandler: (event: Event) => void, handler: (event: Event) => void): void {
    if ('onwheel' in this._canvas) {
      this.on('wheel', firefoxHandler);
    } else {
      this.on('mousewheel', handler);
    }
  }
  domElement(): HTMLCanvasElement {
    return this._canvas;
  }

  // bind the canvas as the primary render target and prepare everything for
  // drawing.
  bind(): void {
    this._ensureSize();
    this._gl.viewport(0, 0, this._realWidth, this._realHeight);
  }

  // the current super sampling factor. At the moment either 1 or 2 is
  // returned, depending on whether manual antialiasing is enabled or not.
  superSamplingFactor(): number {
    return this._samples;
  }

  viewportWidth(): number {
    return this._realWidth;
  }

  viewportHeight(): number {
    return this._realHeight;
  }

  width(): number {
    return this._width;
  }

  height(): number {
    return this._height;
  }

  private _initCanvas(): void {
    this._canvas = document.createElement('canvas');
    this._domElement.appendChild(this._canvas);
    this._applySize(this._width, this._height);
  }

  isWebGLSupported(): boolean {
    return isWebGLSupported(this._gl);
  }

  destroy(): void {
    this._canvas.width = 1;
    this._canvas.height = 1;
    this._canvas.parentElement!.removeChild(this._canvas);
    this._canvas = null as unknown as HTMLCanvasElement;
  }
}

export default {
  Canvas : Canvas,
  isWebGLSupported : isWebGLSupported
};
