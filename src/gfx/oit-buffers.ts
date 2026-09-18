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
// transparency: an opaque color+depth target, and a transparent
// accumulation target (RGBA16F accumulation + R16F revealage) that shares
// the opaque target's depth buffer, so the transparent pass can depth-test
// against already-drawn opaque geometry without writing depth itself. See
// Viewer._draw() for how these are bound across a frame.
//
// This is deliberately a separate class from FrameBuffer (used for picking):
// that one is a simple single-attachment UNSIGNED_BYTE target, while this
// one needs multiple render targets and float-renderable formats, which
// aren't available on every WebGL2 implementation (gated on
// EXT_color_buffer_float) -- see oitSupported().
interface SceneBuffersOptions {
  width: number;
  height: number;
}

class SceneBuffers {
  private _gl: WebGL2RenderingContext;
  private _width: number;
  private _height: number;
  private _bufferWidth: number;
  private _bufferHeight: number;
  private _oitSupported: boolean;
  private _depthHandle: WebGLRenderbuffer;
  private _opaqueFbo: WebGLFramebuffer;
  private _opaqueColorTexture: WebGLTexture;
  private _oitFbo: WebGLFramebuffer | null;
  private _accumTexture: WebGLTexture | null;
  private _revealTexture: WebGLTexture | null;

  constructor(gl: WebGL2RenderingContext, options: SceneBuffersOptions) {
    this._gl = gl;
    this._width = options.width;
    this._height = options.height;
    this._bufferWidth = -1;
    this._bufferHeight = -1;
    this._oitSupported = !!gl.getExtension('EXT_color_buffer_float');

    this._depthHandle = gl.createRenderbuffer()!;
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

  private _setupTexture(texture: WebGLTexture, internalFormat: number, format: number, type: number): void {
    const gl = this._gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, this._width, this._height, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private _allocate(): void {
    const gl = this._gl;

    gl.bindRenderbuffer(gl.RENDERBUFFER, this._depthHandle);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this._width, this._height);

    this._setupTexture(this._opaqueColorTexture, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opaqueFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._opaqueColorTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this._depthHandle);

    if (this._oitSupported && this._oitFbo !== null) {
      this._setupTexture(this._accumTexture!, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
      // RGBA (not single-channel) so the blend equation's "source alpha"
      // factor (ONE_MINUS_SRC_ALPHA) has a real alpha component to read --
      // every channel holds the same revealage value, see shaders.ts's
      // OIT_ACCUM_*_FS.
      this._setupTexture(this._revealTexture!, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._oitFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._accumTexture!, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this._revealTexture!, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this._depthHandle);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        // some WebGL2 implementations advertise EXT_color_buffer_float but
        // don't actually support this exact combination of attachments --
        // fall back gracefully rather than rendering garbage.
        this._oitSupported = false;
      }
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);

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

  opaqueColorTexture(): WebGLTexture { return this._opaqueColorTexture; }
  accumTexture(): WebGLTexture { return this._accumTexture!; }
  revealTexture(): WebGLTexture { return this._revealTexture!; }
}

export default SceneBuffers;
