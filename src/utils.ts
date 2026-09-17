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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => any;
// Old-style prototype-based "constructor functions" (function Foo() {...})
// don't get an inferred `new (...args) => T` construct signature from
// TypeScript, so this only requires what derive() actually touches: a
// .prototype object. Both plain functions and real classes satisfy this.
interface HasPrototype {
  prototype: object;
}

// Copies every property from baseclass.prototype (and, on top of that,
// every property from extensions) onto subclass.prototype. Used throughout
// the mol/gfx modules to fake a Base/View class hierarchy predating real
// ES2015 classes; this loses its purpose (and its callers) tier by tier as
// each Base/View pair is converted to `class X extends Y`, at which point
// this function will be deleted.
export function derive(
  subclass: HasPrototype,
  baseclass: HasPrototype,
  extensions?: Record<string, unknown>,
): void {
  const basePrototype = baseclass.prototype as Record<string, unknown>;
  const subPrototype = subclass.prototype as Record<string, unknown>;
  // jshint forin:false
  for (const prop in basePrototype) {
    subPrototype[prop] = basePrototype[prop];
  }
  if (extensions === undefined) {
    return;
  }
  for (const ext in extensions) {
    subPrototype[ext] = extensions[ext];
  }
}

export function bind<T extends AnyFunction>(obj: unknown, fn: T): AnyFunction {
  return function(this: unknown, ...args: unknown[]) {
    return fn.apply(obj, args);
  };
}

export function update<T extends object>(dst: T, src?: Partial<T>): T {
  src = src || {};
  for (const prop in src) {
    if (Object.prototype.hasOwnProperty.call(src, prop)) {
      dst[prop as keyof T] = src[prop] as T[keyof T];
    }
  }
  return dst;
}

export function copy<T extends object>(src: T): T {
  const cloned = {} as T;
  update(cloned, src);
  return cloned;
}

function defaultComp<T extends number | string>(lhs: T, rhs: T): boolean {
  return lhs < rhs;
}

export type CompareFn<T> = (lhs: T, rhs: T) => boolean;

// returns the index into the values array for the first value identical to
// *value*.
export function binarySearch<T extends number | string>(
  values: readonly T[], value: T, comp?: CompareFn<T>
): number;
export function binarySearch<T>(
  values: readonly T[], value: T, comp: CompareFn<T>
): number;
export function binarySearch<T>(
  values: readonly T[], value: T, comp?: CompareFn<T>
): number {
  if (values.length === 0) {
    return -1;
  }
  const compareFn = comp || (defaultComp as unknown as CompareFn<T>);
  let low = 0, high = values.length;
  let mid  = (low + high) >> 1;
  while (true) {
    const midValue = values[mid]!;
    if (compareFn(value, midValue)) {
      high = mid;
    } else if (compareFn(midValue, value)) {
      low = mid;
    } else {
      return mid;
    }
    const newMid  = (low + high) >> 1;
    if (newMid === mid) {
      return -1;
    }
    mid = newMid;
  }
}

// returns the index of the first item in the list whose value is
// larger or equal than *value*.
export function indexFirstLargerEqualThan<T extends number | string>(
  values: readonly T[], value: T, comp?: CompareFn<T>
): number;
export function indexFirstLargerEqualThan<T>(
  values: readonly T[], value: T, comp: CompareFn<T>
): number;
export function indexFirstLargerEqualThan<T>(
  values: readonly T[], value: T, comp?: CompareFn<T>
): number {
  const compareFn = comp || (defaultComp as unknown as CompareFn<T>);
  if (values.length === 0 || compareFn(values[values.length - 1]!, value)) {
    return -1;
  }
  let low = 0, high = values.length;
  let mid = (low + high) >> 1;
  while (true) {
    const midValue = values[mid]!;
    if (compareFn(value, midValue)) {
      // there might be other values larger than value with an index
      // lower than mid.
      high = mid;
    } else if (compareFn(midValue, value)) {
      low = mid + 1;
    } else {
      high = mid;
    }
    const newMid  = (low + high) >> 1;
    if (newMid === mid) {
      return mid;
    }
    mid = newMid;
  }
}

export function indexLastSmallerThan<T extends number | string>(
  values: readonly T[], value: T, comp?: CompareFn<T>
): number;
export function indexLastSmallerThan<T>(
  values: readonly T[], value: T, comp: CompareFn<T>
): number;
export function indexLastSmallerThan<T>(
  values: readonly T[], value: T, comp?: CompareFn<T>
): number {
  const compareFn = comp || (defaultComp as unknown as CompareFn<T>);
  if (values.length === 0 || compareFn(values[values.length-1]!, value)) {
    return values.length-1;
  }
  if (compareFn(value, values[0]!) || !compareFn(values[0]!, value)) {
    return -1;
  }
  let low = 0, high = values.length;
  let mid = (low + high) >> 1;
  while (true) {
    const midValue = values[mid]!;
    if (compareFn(value, midValue) || !compareFn(midValue, value)) {
      high = mid;
    } else {
      low = mid;
    }
    const newMid  = (low + high) >> 1;
    if (newMid === mid) {
      return mid;
    }
    mid = newMid;
  }
}

export function indexLastSmallerEqualThan<T extends number | string>(
  values: readonly T[], value: T, comp?: CompareFn<T>
): number;
export function indexLastSmallerEqualThan<T>(
  values: readonly T[], value: T, comp: CompareFn<T>
): number;
export function indexLastSmallerEqualThan<T>(
  values: readonly T[], value: T, comp?: CompareFn<T>
): number {
  const compareFn = comp || (defaultComp as unknown as CompareFn<T>);
  if (values.length === 0 || compareFn(values[values.length-1]!, value)) {
    return values.length-1;
  }
  if (compareFn(value, values[0]!)) {
    return -1;
  }
  let low = 0, high = values.length;
  let mid = (low + high) >> 1;
  while (true) {
    const midValue = values[mid]!;
    if (compareFn(value, midValue)) {
      high = mid;
    } else {
      low = mid;
    }
    const newMid  = (low + high) >> 1;
    if (newMid === mid) {
      return mid;
    }
    mid = newMid;
  }
}

export class Range {
  private _empty: boolean;
  private _min: number | null;
  private _max: number | null;

  constructor(min?: number, max?: number) {
    if (min === undefined || max === undefined) {
      this._empty = true;
      this._min = this._max = null;
    } else {
      this._empty = false;
      this._min = min;
      this._max = max;
    }
  }

  min(): number | null {
    return this._min;
  }

  max(): number | null {
    return this._max;
  }

  length(): number {
    return this._max! - this._min!;
  }

  empty(): boolean {
    return this._empty;
  }

  center(): number {
    return (this._max! + this._min!) * 0.5;
  }

  extend(amount: number): void {
    this._min! -= amount;
    this._max! += amount;
  }

  update(val: number): void {
    if (!this._empty) {
      if (val < this._min!) {
        this._min = val;
      } else if (val > this._max!) {
        this._max = val;
      }
      return;
    }
    this._min = this._max = val;
    this._empty = false;
  }
}

export default {
  derive,
  bind,
  update,
  copy,
  binarySearch,
  indexFirstLargerEqualThan,
  indexLastSmallerThan,
  indexLastSmallerEqualThan,
  Range,
};
