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
import { vec3, quat, mat3, mat4 } from 'gl-matrix';
import geom from '../geom';

// Structural typing for Cam (gfx/cam.ts, not yet converted): only what
// animations call on it.
interface AnimCam {
  setZoom(zoom: number): void;
  setCenter(center: vec3): void;
  setRotation(rotation: mat3 | quat): void;
  rotation(): mat4;
}

// base for all animations, e.g. position transitions, slerping etc.
class Animation<T = number> {
  protected _from: T;
  protected _to: T;
  protected _duration: number;
  protected _left: number;
  protected _start: number;
  protected _looping: boolean;
  protected _finished: boolean;
  protected _current!: unknown;

  constructor(from: T, to: T, duration: number) {
    this._from = from;
    this._to = to;
    this._duration = duration;
    this._left = duration;
    this._start = Date.now();
    this._looping = false;
    this._finished = false;
  }

  setLooping(looping: boolean): void {
    this._looping = looping;
  }

  step(cam: AnimCam): boolean {
    const now = Date.now();
    let elapsed = now - this._start;
    let t;
    if (this._duration === 0) {
      t = 1.0;
    } else {
      if (this._looping) {
        const times = Math.floor(elapsed/this._duration);
        t = (elapsed - times * this._duration)/this._duration;
      } else {
        elapsed = Math.min(this._duration, elapsed);
        t = elapsed/this._duration;
        this._finished = t === 1.0;
      }
    }
    this.apply(cam, t);
    return this._finished;
  }

  apply(cam: AnimCam, t: number): void {
    const smoothInterval = (1 - Math.cos(t * Math.PI ) ) / 2;
    const from = this._from as unknown as number;
    const to = this._to as unknown as number;
    this._current = from * (1-smoothInterval) + to * smoothInterval;
    cam.setZoom(this._current as number);
  }

  finished(): boolean {
    return this._finished;
  }
}



class Move extends Animation<vec3> {
  constructor(from: vec3, to: vec3, duration: number) {
    super(vec3.clone(from), vec3.clone(to), duration);
    this._current = vec3.clone(from);
  }

  override apply(cam: AnimCam, t: number): void {
    const smoothInterval = (1 - Math.cos(t * Math.PI ) ) / 2;
    const current = this._current as vec3;
    vec3.lerp(current, this._from, this._to, smoothInterval);
    cam.setCenter(current);
  }
}

class Rotate extends Animation<quat> {
  constructor(initialRotation: mat4, destinationRotation: mat4, duration: number) {
    const initial = mat3.create();
    const to = mat3.create();
    mat3.fromMat4(initial, initialRotation);
    mat3.fromMat4(to, destinationRotation);
    const initialQuat = quat.create();
    const toQuat = quat.create();
    quat.fromMat3(initialQuat, initial);
    quat.fromMat3(toQuat, to);
    super(initialQuat, toQuat, duration);
    this._current = mat3.create();
  }

  override apply = (function() {
    const quatRot = quat.create();

    return function(this: Rotate, cam: AnimCam, t: number): void {
      quat.slerp(quatRot, this._from, this._to, t);
      mat3.fromQuat(this._current as mat3, quatRot);
      cam.setRotation(this._current as mat3);
    };
  })();
}

class RockAndRoll extends Animation<null> {
  protected _axis: vec3;
  protected _previousAngle: number;

  constructor(axis: vec3, duration: number) {
    super(null, null, duration);
    this._axis = vec3.clone(axis);
    this.setLooping(true);
    this._previousAngle = 0.0;
  }

  override apply = (function() {
    const axisRot = mat3.create();
    const rotation = mat3.create();
    return function(this: RockAndRoll, cam: AnimCam, t: number): void {
      mat3.fromMat4(rotation, cam.rotation());
      const angle = 0.2 * Math.sin(2 * t * Math.PI);
      const deltaAngle = angle - this._previousAngle;
      this._previousAngle = angle;
      geom.axisRotation(axisRot, this._axis, deltaAngle);
      mat3.mul(rotation, axisRot, rotation);
      cam.setRotation(rotation);
    };
  })();
}

class Spin extends Animation<null> {
  protected _axis: vec3;
  protected _speed: number;
  protected _previousT: number;

  constructor(axis: vec3, speed: number) {
    const duration = 1000 * (2 * Math.PI / speed);
    super(null, null, duration);
    this._axis = vec3.clone(axis);
    this.setLooping(true);
    this._speed = speed;
    this._previousT = 0.0;
  }

  override apply = (function() {
    const axisRot = mat3.create();
    const rotation = mat3.create();
    return function(this: Spin, cam: AnimCam, t: number): void {
      mat3.fromMat4(rotation, cam.rotation());
      const angle = Math.PI * 2 * (t - this._previousT);
      this._previousT = t;
      geom.axisRotation(axisRot, this._axis, angle);
      mat3.mul(rotation, axisRot, rotation);
      cam.setRotation(rotation);
    };
  })();

  setSpeed(speed: number): void {
    this._speed = speed;
    this._duration = 1000 * (2 * Math.PI / speed);
  }

  setAxis(axis: vec3): void {
    this._axis = axis;
  }
}


class AnimationControl {
  private _animations: Animation<unknown>[];

  constructor() {
    this._animations = [];
  }

  // apply all currently active animations to the camera
  // returns true if there are pending animations.
  run(camera: AnimCam): boolean {
    this._animations = this._animations.filter(function(anim) {
      return !anim.step(camera);
    });
    return this._animations.length > 0;
  }

  add(animation: Animation<unknown>): void {
    this._animations.push(animation);
  }

  remove(animation: Animation<unknown>): void {
    this._animations = this._animations.filter(function(a) {
      return a !== animation;
    });
  }
}


function move(from: vec3, to: vec3, duration: number): Move {
  return new Move(from, to, duration);
}

function rotate(from: mat4, to: mat4, duration: number): Rotate {
  return new Rotate(from, to, duration);
}

function zoom(from: number, to: number, duration: number): Animation<number> {
  return new Animation(from, to, duration);
}


function spin(axis: vec3, speed: number): Spin {
  return new Spin(axis, speed);
}

function rockAndRoll(): RockAndRoll {
  return new RockAndRoll([0, 1, 0], 2000);
}

export default {
  AnimationControl : AnimationControl,
  move : move,
  rotate : rotate,
  zoom : zoom,
  rockAndRoll : rockAndRoll,
  spin : spin
};
