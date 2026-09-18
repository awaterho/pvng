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

// Manages the render targets needed for weighted blended order-independent
// transparency and for SSAO: an opaque color+depth target, a transparent
// accumulation target (RGBA16F accumulation + R16F revealage) that shares
// the opaque target's depth buffer, so the transparent pass can depth-test
// against already-drawn opaque geometry without writing depth itself, and
// two small single-channel targets (raw + blurred) holding the SSAO
// occlusion factor. See Viewer._draw() for how these are bound across a
// frame.
//
// This is deliberately a separate class from FrameBuffer (used for picking):
// that one is a simple single-attachment UNSIGNED_BYTE target, while this
// one needs multiple render targets and float-renderable formats, which
// aren't available on every WebGL2 implementation (gated on
// EXT_color_buffer_float) -- see oitSupported().
interface SceneBuffersOptions {
  width: number;
  height: number;
  // divides the SSAO/blur targets' resolution relative to the opaque
  // target -- pass the canvas's manual-supersampling factor here so SSAO
  // (a low-frequency effect that gets box-blurred anyway) runs at real
  // pixel resolution instead of the supersampled one. 1 means full res.
  ssaoDownscale?: number;
}

class SceneBuffers {
  private _gl: WebGL2RenderingContext;
  private _width: number;
  private _height: number;
  private _bufferWidth: number;
  private _bufferHeight: number;
  private _ssaoDownscale: number;
  private _ssaoWidth: number;
  private _ssaoHeight: number;
  private _oitSupported: boolean;
  private _ssaoSupported: boolean;
  private _depthTexture: WebGLTexture;
  private _opaqueFbo: WebGLFramebuffer;
  private _opaqueColorTexture: WebGLTexture;
  private _oitFbo: WebGLFramebuffer | null;
  private _accumTexture: WebGLTexture | null;
  private _revealTexture: WebGLTexture | null;
  private _ssaoFbo: WebGLFramebuffer;
  private _ssaoTexture: WebGLTexture;
  private _ssaoBlurFbo: WebGLFramebuffer;
  private _ssaoBlurTexture: WebGLTexture;

  constructor(gl: WebGL2RenderingContext, options: SceneBuffersOptions) {
    this._gl = gl;
    this._width = options.width;
    this._height = options.height;
    this._bufferWidth = -1;
    this._bufferHeight = -1;
    this._ssaoDownscale = Math.max(1, options.ssaoDownscale || 1);
    this._ssaoWidth = -1;
    this._ssaoHeight = -1;
    this._oitSupported = !!gl.getExtension('EXT_color_buffer_float');
    this._ssaoSupported = true;

    this._depthTexture = gl.createTexture()!;
    this._opaqueFbo = gl.createFramebuffer()!;
    this._opaqueColorTexture = gl.createTexture()!;
    if (this._oitSupported) {
      this._oitFbo = gl.createFramebuffer()!;
      this._accumTexture = gl.createTexture()!;
      this._revealTexture = gl.createTexture()!;
    } else {
      this._oitFbo = null;
      this._accumTexture = null;
      this._revealTexture = null;
    }
    this._ssaoFbo = gl.createFramebuffer()!;
    this._ssaoTexture = gl.createTexture()!;
    this._ssaoBlurFbo = gl.createFramebuffer()!;
    this._ssaoBlurTexture = gl.createTexture()!;
    this._allocate();
  }

  // false when EXT_color_buffer_float isn't available -- callers should
  // fall back to plain (non-order-independent) alpha blending in that case.
  oitSupported(): boolean {
    return this._oitSupported;
  }

  // force OIT off even though float render targets are supported -- used
  // when OES_draw_buffers_indexed (needed for per-target blend state) is
  // unavailable.
  disableOit(): void {
    this._oitSupported = false;
  }

  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
  }

  private _ensureSize(): void {
    if (this._width !== this._bufferWidth || this._height !== this._bufferHeight) {
      this._allocate();
    }
  }

  private _setupTexture(
    texture: WebGLTexture, internalFormat: number, format: number, type: number,
    width: number, height: number, filter: number = this._gl.NEAREST,
  ): void {
    const gl = this._gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private _allocate(): void {
    const gl = this._gl;

    // depth as a texture (not a renderbuffer) so SSAO can sample it --
    // must stay NEAREST-filtered, since depth textures aren't filterable
    // in core WebGL2.
    this._setupTexture(this._depthTexture, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT,
                       gl.UNSIGNED_INT, this._width, this._height);

    this._setupTexture(this._opaqueColorTexture, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE,
                       this._width, this._height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opaqueFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._opaqueColorTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this._depthTexture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('opaque framebuffer incomplete');
    }

    if (this._oitSupported && this._oitFbo !== null) {
      this._setupTexture(this._accumTexture!, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT,
                         this._width, this._height);
      // RGBA (not single-channel) so the blend equation's "source alpha"
      // factor (ONE_MINUS_SRC_ALPHA) has a real alpha component to read --
      // every channel holds the same revealage value, see shaders.ts's
      // OIT_ACCUM_*_FS.
      this._setupTexture(this._revealTexture!, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT,
                         this._width, this._height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._oitFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._accumTexture!, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this._revealTexture!, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this._depthTexture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        // some WebGL2 implementations advertise EXT_color_buffer_float but
        // don't actually support this exact combination of attachments --
        // fall back gracefully rather than rendering garbage.
        this._oitSupported = false;
      }
    }

    this._ssaoWidth = Math.max(1, Math.ceil(this._width / this._ssaoDownscale));
    this._ssaoHeight = Math.max(1, Math.ceil(this._height / this._ssaoDownscale));
    this._setupTexture(this._ssaoTexture, gl.R8, gl.RED, gl.UNSIGNED_BYTE,
                       this._ssaoWidth, this._ssaoHeight, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._ssaoFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._ssaoTexture, 0);
    this._ssaoSupported = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

    this._setupTexture(this._ssaoBlurTexture, gl.R8, gl.RED, gl.UNSIGNED_BYTE,
                       this._ssaoWidth, this._ssaoHeight, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._ssaoBlurFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._ssaoBlurTexture, 0);
    this._ssaoSupported = this._ssaoSupported &&
      gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this._bufferWidth = this._width;
    this._bufferHeight = this._height;
  }

  // binds the opaque target: single RGBA8 color attachment, depth test and
  // write both meant to be enabled by the caller.
  bindOpaque(): void {
    this._ensureSize();
    const gl = this._gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opaqueFbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, this._width, this._height);
  }

  // binds the transparency accumulation target: two color attachments
  // (accumulation, revealage) sharing the opaque pass's depth buffer. Only
  // valid when oitSupported() is true.
  bindTransparent(): void {
    const gl = this._gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._oitFbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, this._width, this._height);
  }

  // binds the SSAO raw-occlusion target: single R8 color attachment, no
  // depth test/write needed since it's a fullscreen pass over the already
  // resolved opaque depth texture.
  bindSsao(): void {
    this._ensureSize();
    const gl = this._gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._ssaoFbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, this._ssaoWidth, this._ssaoHeight);
  }

  // binds the SSAO blurred-occlusion target.
  bindSsaoBlur(): void {
    this._ensureSize();
    const gl = this._gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._ssaoBlurFbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, this._ssaoWidth, this._ssaoHeight);
  }

  // false if this GPU/driver rejects the R8 SSAO render targets -- callers
  // should fall back to skipping SSAO entirely rather than rendering
  // garbage.
  ssaoSupported(): boolean {
    return this._ssaoSupported;
  }

  ssaoWidth(): number { return this._ssaoWidth; }
  ssaoHeight(): number { return this._ssaoHeight; }

  opaqueColorTexture(): WebGLTexture { return this._opaqueColorTexture; }
  depthTexture(): WebGLTexture { return this._depthTexture; }
  accumTexture(): WebGLTexture { return this._accumTexture!; }
  revealTexture(): WebGLTexture { return this._revealTexture!; }
  ssaoTexture(): WebGLTexture { return this._ssaoTexture; }
  ssaoBlurTexture(): WebGLTexture { return this._ssaoBlurTexture; }
}

export default SceneBuffers;
