// Copyright (c) 2013-2015 Marco Biasini
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
import type { vec3 } from 'gl-matrix';
import utils from '../utils';
import SceneNode, { type SceneNode as ISceneNode } from './scene-node';
import type Cam from './cam';

export interface TextLabelOptions {
  fillStyle?: string;
  backgroundAlpha?: number;
  fontSize?: number;
  font?: string;
  fontStyle?: string;
  fontColor?: string;
}

interface ResolvedTextLabelOptions {
  fillStyle: string;
  backgroundAlpha: number;
  fontSize: number;
  font: string;
  fontStyle: string;
  fontColor: string;
}

interface ShaderCatalog {
  text: WebGLProgram;
}

function smallestPowerOfTwo(size: number): number {
  let s = 1;
  while (s < size) {
    s *= 2;
  }
  return s;
}

// NOTE: kept as a prototype-based constructor function -- see
// gfx/vertex-array-base.ts/gfx/base-geom.ts for why (this chain-invokes
// SceneNode via `.call()`).
export interface TextLabel extends ISceneNode {
  _options: ResolvedTextLabelOptions;
  _pos: vec3;
  _interleavedBuffer: WebGLBuffer;
  _interleavedData: Float32Array;
  _texture: WebGLTexture;
  _xScale: number;
  _yScale: number;
  _width: number;
  _height: number;
  _ready: boolean;

  _setupTextParameters(ctx: CanvasRenderingContext2D): void;
  _prepareText(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, text: string): void;
  _textureFromCanvas(targetTexture: WebGLTexture, srcCanvas: HTMLCanvasElement): void;
  bind(): void;
}

interface TextLabelConstructor {
  new (
    gl: WebGL2RenderingContext, canvas: HTMLCanvasElement, context: CanvasRenderingContext2D,
    pos: vec3, text: string, options?: TextLabelOptions,
  ): TextLabel;
  (
    this: TextLabel, gl: WebGL2RenderingContext, canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D, pos: vec3, text: string, options?: TextLabelOptions,
  ): void;
  prototype: TextLabel;
}

const TextLabel = function(
  this: TextLabel, gl: WebGL2RenderingContext, canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D, pos: vec3, text: string, options?: TextLabelOptions,
) {
  (SceneNode as unknown as (this: TextLabel, gl: WebGL2RenderingContext) => void).call(this, gl);
  const opts = options || {};
  this._options = {
    fillStyle: opts.fillStyle || '#000',
    backgroundAlpha: opts.backgroundAlpha || 0.0,
    fontSize: opts.fontSize || 24,
    font: opts.font || 'Verdana',
    fontStyle: opts.fontStyle || 'normal',
    fontColor: opts.fontColor || '#000',
  };
  this._order = 100;
  this._pos = pos;
  this._interleavedBuffer = this._gl.createBuffer()!;
  this._interleavedData = new Float32Array(5 * 6);

  this._prepareText(canvas, context, text);

  const halfWidth = 0.5;
  const halfHeight = 0.5;
  this._interleavedData[0] = pos[0];
  this._interleavedData[1] = pos[1];
  this._interleavedData[2] = pos[2];
  this._interleavedData[3] = -halfWidth;
  this._interleavedData[4] = -halfHeight;

  this._interleavedData[5] = pos[0];
  this._interleavedData[6] = pos[1];
  this._interleavedData[7] = pos[2];
  this._interleavedData[8] = halfWidth;
  this._interleavedData[9] = halfHeight;

  this._interleavedData[10] = pos[0];
  this._interleavedData[11] = pos[1];
  this._interleavedData[12] = pos[2];
  this._interleavedData[13] = halfWidth;
  this._interleavedData[14] = -halfHeight;

  this._interleavedData[15] = pos[0];
  this._interleavedData[16] = pos[1];
  this._interleavedData[17] = pos[2];
  this._interleavedData[18] = -halfWidth;
  this._interleavedData[19] = -halfHeight;

  this._interleavedData[20] = pos[0];
  this._interleavedData[21] = pos[1];
  this._interleavedData[22] = pos[2];
  this._interleavedData[23] = -halfWidth;
  this._interleavedData[24] = halfHeight;

  this._interleavedData[25] = pos[0];
  this._interleavedData[26] = pos[1];
  this._interleavedData[27] = pos[2];
  this._interleavedData[28] = halfWidth;
  this._interleavedData[29] = halfHeight;
} as unknown as TextLabelConstructor;

utils.derive(TextLabel, SceneNode, {
  updateProjectionIntervals: function(this: TextLabel) {
    // text labels don't affect the projection interval. Don't do anything.
  },

  updateSquaredSphereRadius: function(this: TextLabel, center: vec3, radius: number | null) {
    // text labels don't affect the bounding spheres.
    return radius;
  },


  _setupTextParameters: function(this: TextLabel, ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = this._options.fontColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = this._options.fontStyle + ' ' +
               this._options.fontSize + 'px '+
               this._options.font;
  },

  _prepareText: function(this: TextLabel, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, text: string) {
    this._setupTextParameters(ctx);
    const estimatedWidth = ctx.measureText(text).width;
    const estimatedHeight = this._options.fontSize;
    canvas.width = smallestPowerOfTwo(estimatedWidth);
    canvas.height = smallestPowerOfTwo(estimatedHeight);
    ctx.fillStyle = this._options.fillStyle;
    ctx.globalAlpha = this._options.backgroundAlpha;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this._setupTextParameters(ctx);
    ctx.globalAlpha = 1.0;
    ctx.lineWidth = 0.5;
    ctx.fillText(text, 0, canvas.height);
    ctx.strokeText(text, 0, canvas.height);
    /*
    // use the following code for testing purposes. for optimal visual
    // results, the pixels of the canvas must match one to one to pixels
    // in the 3D scene.
    ctx.fillStyle='black';
    for (var i = 0; i < canvas.width; i+=2) {
      for (var j = 0; j < canvas.height; j+=2) {
        ctx.fillRect(i + j%2, j, 1, 1);
      }
    }
    */
    this._texture = this._gl.createTexture()!;
    this._textureFromCanvas(this._texture, canvas);
    // these two variables give us the use portion of the canvas.
    this._xScale = estimatedWidth / canvas.width;
    this._yScale = estimatedHeight / canvas.height;
    this._width = estimatedWidth;
    this._height = estimatedHeight;
  },

  _textureFromCanvas: function(this: TextLabel, targetTexture: WebGLTexture, srcCanvas: HTMLCanvasElement) {
    const gl = this._gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, targetTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA,
                  gl.UNSIGNED_BYTE, srcCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
  },

  bind: function(this: TextLabel) {
    const gl = this._gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._interleavedBuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    if (this._ready) {
      return;
    }
    gl.bufferData(gl.ARRAY_BUFFER, this._interleavedData, gl.STATIC_DRAW);
    this._ready = true;
  },

  draw: function(this: TextLabel, cam: Cam, shaderCatalog: ShaderCatalog, style: unknown, pass: unknown) {
    if (!this._visible) {
      return;
    }

    if (pass !== 'normal') {
      return;
    }
    const shader = shaderCatalog.text;
    cam.bind(shader as never);
    this.bind();
    const gl = this._gl;
    const factor = cam.upsamplingFactor();
    gl.uniform1f(gl.getUniformLocation(shader, 'xScale'), this._xScale);
    gl.uniform1f(gl.getUniformLocation(shader, 'yScale'), this._yScale);
    gl.uniform1f(gl.getUniformLocation(shader, 'width'),
                 factor * 2.0*this._width/cam.viewportWidth());
    gl.uniform1f(gl.getUniformLocation(shader, 'height'),
                 factor * 2.0*this._height/cam.viewportHeight());
    gl.uniform1i(gl.getUniformLocation(shader, 'sampler'), 0);
    const vertAttrib = gl.getAttribLocation(shader, 'attrCenter');
    gl.enableVertexAttribArray(vertAttrib);
    gl.vertexAttribPointer(vertAttrib, 3, gl.FLOAT, false, 5 * 4, 0 * 4);
    const texAttrib = gl.getAttribLocation(shader, 'attrCorner');
    gl.vertexAttribPointer(texAttrib, 2, gl.FLOAT, false, 5 * 4, 3 * 4);
    gl.enableVertexAttribArray(texAttrib);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(vertAttrib);
    gl.disableVertexAttribArray(texAttrib);
    gl.disable(gl.BLEND);
  }
} as Partial<TextLabel>);

export default TextLabel;
