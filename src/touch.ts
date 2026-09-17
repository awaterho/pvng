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
import utils from './utils';
import type Cam from './gfx/cam';

interface Point {
  x: number;
  y: number;
}

interface Picked {
  pos(): unknown;
}

// Structural typing for Viewer (viewer.js, not yet converted).
interface TouchViewer {
  requestRedraw(): void;
  pick(point: Point): Picked | null;
  _dispatchEvent(event: Event, name: string, picked: Picked | null): void;
  _mouseHandler: {
    _mouseDoubleClick(event: { clientX: number; clientY: number }): void;
  };
}

// the state accumulated across a touch gesture; built up incrementally by
// _extractEventAttributes as fields become available/relevant.
interface TouchState {
  center?: Point;
  pointers?: Point[];
  numTouches?: number;
  rotation: number;
  scale: number;
  deltaScale: number;
  deltaRotation: number;
  deltaCenter?: Point;
  initialPointers?: Point[];
}

function getCenter(touches: TouchList): Point {
  let centerX = 0, centerY = 0;
  for (let i = 0; i < touches.length; ++i) {
    centerX += touches[i]!.clientX;
    centerY += touches[i]!.clientY;
  }
  centerX /= touches.length;
  centerY /= touches.length;
  return { x : centerX, y : centerY };
}

function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getScale(prevPointers: Point[], newPointers: Point[]): number {
  const prevD = distance(prevPointers[0]!, prevPointers[1]!);
  const newD = distance(newPointers[0]!, newPointers[1]!);
  return newD / (prevD === 0 ? 1 : prevD);
}

function getAngle(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.atan2(dy, dx);
}

function getRotationAngle(prevPointers: Point[], newPointers: Point[]): number {
  return getAngle(newPointers[1]!, newPointers[0]!) -
        getAngle(prevPointers[1]!, prevPointers[0]!);
}

class TouchHandler {
  private _element: HTMLElement;
  private _touchState: TouchState;
  private _lastSingleTap: number | null;
  private _viewer: TouchViewer;
  private _cam: Cam;

  constructor(element: HTMLElement, viewer: TouchViewer, cam: Cam) {
    this._element = element;
    this._element.addEventListener('touchmove',
                                   utils.bind(this, this._touchMove) as (event: Event) => void);
    this._element.addEventListener('touchstart',
                                   utils.bind(this, this._touchStart) as (event: Event) => void);
    this._element.addEventListener('touchend',
                                   utils.bind(this, this._touchEnd) as (event: Event) => void);
    this._element.addEventListener('touchcancel',
                                   utils.bind(this, this._touchEnd) as (event: Event) => void);
    this._touchState = {
      scale : 1.0,
      rotation : 0.0,
      deltaScale: 0.0,
      deltaRotation: 0.0,
      center : undefined
    };
    this._lastSingleTap = null;
    this._viewer = viewer;
    this._cam = cam;
  }

  // calculates the relevant touch/gesture properties based on previous touch
  // state and the new event. It returns the new state with deltaScale,
  // deltaRotation and deltaCenter attached than can be used to control the
  // camera.
  private _extractEventAttributes(previousState: TouchState, event: TouchEvent): TouchState {
    const state: TouchState = {
      rotation: 0,
      scale: 1.0,
      deltaScale: 0.0,
      deltaRotation: 0.0,
    };
    state.center = getCenter(event.targetTouches);
    state.pointers = [];
    for (let i = 0; i < event.targetTouches.length; ++i) {
      const t = event.targetTouches[i]!;
      state.pointers.push({ x: t.clientX, y : t.clientY });
    }
    state.numTouches = event.targetTouches.length;

    if (previousState.center) {
      state.deltaCenter = {
        x : state.center.x - previousState.center.x,
        y : state.center.y - previousState.center.y
      };
    }

    if (previousState.numTouches !== 2 || state.numTouches !== 2) {
      return state;
    }
    if (previousState.initialPointers) {
      state.initialPointers = previousState.initialPointers;
    } else {
      state.initialPointers = previousState.pointers;
    }

    state.scale = getScale(state.initialPointers!, state.pointers);
    state.deltaScale = state.scale - previousState.scale;
    state.rotation = getRotationAngle(state.initialPointers!, state.pointers);
    state.deltaRotation = state.rotation - previousState.rotation;
    return state;
  }


  private _touchMove(event: TouchEvent): void {
    event.preventDefault();
    const newState = this._extractEventAttributes(this._touchState, event);
    const deltaScale =  - newState.deltaScale * 4.0;
    if (deltaScale !== 0) {
      this._cam.zoom(deltaScale);
    }
    if (newState.numTouches === 2 && this._touchState.numTouches === 2) {
      // scale pan amount by current zoom value. This increases the camera
      // shift when far away from the image center.
      const speed =
        0.002 * Math.tan(0.5 * this._cam.fieldOfViewY()) * this._cam.zoom();
      this._cam.panXY(newState.deltaCenter!.x * speed,
                      newState.deltaCenter!.y * speed);
    }
    const deltaZRotation =  - newState.deltaRotation;
    this._cam.rotateZ(deltaZRotation);
    // FIXME: ideally we would rotate the scene around the touch center.
    // This would feel more natural. Now when the touch center is far
    // away from the project center of the viewer, rotation is a little
    // awkward.
    if (newState.numTouches === 1 && this._touchState.numTouches === 1) {
        this._cam.rotateX(newState.deltaCenter!.y * 0.005);
        this._cam.rotateY(newState.deltaCenter!.x * 0.005);
    }
    this._viewer.requestRedraw();
    this._touchState = newState;
    this._lastSingleTap = null;
  }



  private _touchStart(event: TouchEvent): void {
    event.preventDefault();
    if (event.targetTouches.length === 1) {
      // detect double tap
      let now: number | null = new Date().getTime();
      if (this._lastSingleTap !== null) {
        const delta = now - this._lastSingleTap;
        if (delta < 300) {
          this._viewer._mouseHandler._mouseDoubleClick({
              clientX : event.targetTouches[0]!.clientX,
              clientY : event.targetTouches[0]!.clientY });
          now = null;
        }
      }
      this._lastSingleTap = now;
    } else {
      this._lastSingleTap = null;
    }
    this._touchState =
      this._extractEventAttributes(this._touchState, event);
  }

  private _touchEnd(event: TouchEvent): void {
    event.preventDefault();
    // detect first tap
    if (this._lastSingleTap) {
      const rect = this._element.getBoundingClientRect();
      const pointer = this._touchState.pointers![0]!;
      const picked = this._viewer.pick(
          { x : pointer.x - rect.left, y : pointer.y - rect.top });
      this._viewer._dispatchEvent(event, 'click', picked);
    }
  }
}

export default TouchHandler;
