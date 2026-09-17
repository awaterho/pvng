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
import type { vec3 } from 'gl-matrix';
import utils from './utils';
import type Cam from './gfx/cam';

interface Picked {
  pos(): vec3;
}

// Structural typing for Canvas (gfx/canvas.js, not yet converted).
interface MouseCanvas {
  domElement(): HTMLElement;
  onWheel(ffHandler: (event: WheelEvent) => void, otherHandler: (event: WheelEvent) => void): void;
  on(event: string, fn: (event: Event) => void): void;
  removeEventListener(event: string, fn: (event: Event) => void): void;
}

// Structural typing for Viewer (viewer.js, not yet converted).
interface MouseViewer {
  setCenter(pos: vec3, animationTime: number): void;
  pick(point: { x: number; y: number }): Picked | null;
  _dispatchEvent(event: Event, name: string, picked: Picked | null): void;
  requestRedraw(): void;
}

class MouseHandler {
  private _viewer: MouseViewer;
  private _canvas: MouseCanvas;
  private _cam: Cam;
  private _animationTime: number;
  private _lastMouseUpTime: number | null;
  private _lastMouseDownTime!: number;
  private _lastMousePos!: { x: number; y: number };
  private _mousePanListener!: (event: Event) => void;
  private _mouseRotateListener!: (event: Event) => void;
  private _mouseUpListener!: (event: Event) => void;

  constructor(canvas: MouseCanvas, viewer: MouseViewer, cam: Cam, animationTime: number) {
    this._viewer = viewer;
    this._canvas = canvas;
    this._cam = cam;
    this._canvas = canvas;
    this._animationTime = animationTime;
    this._lastMouseUpTime = null;
    this._init();
  }

  private _centerOnClicked(picked: Picked | null): void {
    if (picked === null) {
      return;
    }
    this._viewer.setCenter(picked.pos(), this._animationTime);
  }

  private _mouseUp(event: MouseEvent): void {
    const canvas = this._canvas;
    const currentTime = (new Date()).getTime();
    if ((this._lastMouseUpTime === null ||
        currentTime - this._lastMouseUpTime > 300) &&
        (currentTime - this._lastMouseDownTime < 300)) {
      const rect = this._canvas.domElement().getBoundingClientRect();
      const picked = this._viewer.pick(
          { x : event.clientX - rect.left, y : event.clientY - rect.top });
      this._viewer._dispatchEvent(event, 'click', picked);
    }
    this._lastMouseUpTime = currentTime;
    canvas.removeEventListener('mousemove', this._mouseRotateListener);
    canvas.removeEventListener('mousemove', this._mousePanListener);
    canvas.removeEventListener('mouseup', this._mouseUpListener);
    document.removeEventListener('mouseup', this._mouseUpListener);
    document.removeEventListener('mousemove', this._mouseRotateListener);
    document.removeEventListener('mousemove', this._mousePanListener);
  }

  setCam(cam: Cam): void {
    this._cam = cam;
  }

  private _init(): boolean {
    this._mousePanListener = utils.bind(this, this._mousePan) as (event: Event) => void;
    this._mouseRotateListener = utils.bind(this, this._mouseRotate) as (event: Event) => void;
    this._mouseUpListener = utils.bind(this, this._mouseUp) as (event: Event) => void;

    // Firefox responds to the wheel event, whereas other browsers listen to
    // the mousewheel event. Register different event handlers, depending on
    // what properties are available.
    this._canvas.onWheel(utils.bind(this, this._mouseWheelFF) as (event: WheelEvent) => void,
                         utils.bind(this, this._mouseWheel) as (event: WheelEvent) => void);
    this._canvas.on('dblclick', utils.bind(this, this._mouseDoubleClick) as (event: Event) => void);
    this._canvas.on('mousedown', utils.bind(this, this._mouseDown) as (event: Event) => void);
    return true;
  }

  private _mouseWheel(event: WheelEvent & { wheelDelta: number }): void {
    this._cam.zoom(event.wheelDelta < 0 ? -1 : 1);
    event.preventDefault();
    this._viewer.requestRedraw();
  }

  private _mouseWheelFF(event: WheelEvent): void {
    this._cam.zoom(event.deltaY < 0 ? 1 : -1);
    event.preventDefault();
    this._viewer.requestRedraw();
  }

  private _mouseDoubleClick = (function() {
    return function(this: MouseHandler, event: MouseEvent): void {
      const rect = this._canvas.domElement().getBoundingClientRect();
      const picked = this._viewer.pick(
          { x : event.clientX - rect.left, y : event.clientY - rect.top });
      this._viewer._dispatchEvent(event, 'doubleClick', picked);
      this._viewer.requestRedraw();
    };
  })();

  private _mouseDown(event: MouseEvent): void {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    this._lastMouseDownTime = (new Date()).getTime();
    event.preventDefault();
    if (event.shiftKey === true || event.button === 1) {
      this._canvas.on('mousemove', this._mousePanListener);
      document.addEventListener('mousemove', this._mousePanListener, false);
    } else {
      this._canvas.on('mousemove', this._mouseRotateListener);
      document.addEventListener('mousemove', this._mouseRotateListener, false);
    }
    this._canvas.on('mouseup', this._mouseUpListener);
    document.addEventListener('mouseup', this._mouseUpListener, false);
    this._lastMousePos = { x : event.pageX, y : event.pageY };
  }

  private _mouseRotate(event: MouseEvent): void {
    const newMousePos = { x : event.pageX, y : event.pageY };
    const delta = {
      x : newMousePos.x - this._lastMousePos.x,
      y : newMousePos.y - this._lastMousePos.y
    };

    const speed = 0.005;
    this._cam.rotateX(speed * delta.y);
    this._cam.rotateY(speed * delta.x);
    this._lastMousePos = newMousePos;
    this._viewer.requestRedraw();
  }

  private _mousePan(event: MouseEvent): void {
    const newMousePos = { x : event.pageX, y : event.pageY };
    const delta = {
      x : newMousePos.x - this._lastMousePos.x,
      y : newMousePos.y - this._lastMousePos.y
    };

    // adjust speed according to distance to camera center, it's not
    // perfect but gives good enough results.
    const speed =
      0.002 * Math.tan(0.5 * this._cam.fieldOfViewY()) * this._cam.zoom();
    this._cam.panXY(speed * delta.x,
                    speed * delta.y);
    this._lastMousePos = newMousePos;
    this._viewer.requestRedraw();
  }

}

export default MouseHandler;
