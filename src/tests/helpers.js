// Small QUnit-compatible shim on top of Vitest, so the existing QUnit-style
// tests (using both the bare global assertions like strictEqual()/ok() and
// the assert.X()/assert.async() style passed into test(name, function(assert)
// {...})) can be ported to Vitest by changing only the module wrapper
// (require/define -> import), not the test bodies.
import { it, expect } from 'vitest';

export function almostEqual(actual, expected, epsilon) {
  epsilon = epsilon === undefined ? 0.000001 : epsilon;
  return Math.abs(actual - expected) < epsilon;
}

export function ok(cond) { expect(!!cond).toBe(true); }
export function notOk(cond) { expect(!!cond).toBe(false); }
export function strictEqual(actual, expected) { expect(actual).toBe(expected); }
export function notStrictEqual(actual, expected) { expect(actual).not.toBe(expected); }
export function equal(actual, expected) { expect(actual).toEqual(expected); }
export function notEqual(actual, expected) { expect(actual).not.toEqual(expected); }
export function deepEqual(actual, expected) { expect(actual).toEqual(expected); }
export function propEqual(actual, expected) { expect(actual).toEqual(expected); }
export function throwsAssertion(fn) { expect(fn).toThrow(); }

export function almostEqualAssert(actual, expected, epsilon) {
  expect(almostEqual(actual, expected, epsilon)).toBe(true);
}
export function vec2Equal(actual, expected, epsilon) {
  for (var i = 0; i < 2; ++i) almostEqualAssert(actual[i], expected[i], epsilon);
}
export function vec3Equal(actual, expected, epsilon) {
  for (var i = 0; i < 3; ++i) almostEqualAssert(actual[i], expected[i], epsilon);
}
export function vec4Equal(actual, expected, epsilon) {
  for (var i = 0; i < 4; ++i) almostEqualAssert(actual[i], expected[i], epsilon);
}
export function mat3Equal(actual, expected, epsilon) {
  for (var i = 0; i < 9; ++i) almostEqualAssert(actual[i], expected[i], epsilon);
}
export function mat4Equal(actual, expected, epsilon) {
  for (var i = 0; i < 16; ++i) almostEqualAssert(actual[i], expected[i], epsilon);
}

function makeAssert() {
  var pending = 0;
  var asyncRequested = false;
  var resolveDone;
  var donePromise = new Promise(function(resolve) { resolveDone = resolve; });

  var assert = {
    ok: ok,
    notOk: notOk,
    strictEqual: strictEqual,
    notStrictEqual: notStrictEqual,
    equal: equal,
    notEqual: notEqual,
    deepEqual: deepEqual,
    propEqual: propEqual,
    throws: throwsAssertion,
    almostEqual: almostEqualAssert,
    vec2Equal: vec2Equal,
    vec3Equal: vec3Equal,
    vec4Equal: vec4Equal,
    mat3Equal: mat3Equal,
    mat4Equal: mat4Equal,
    async: function() {
      asyncRequested = true;
      pending++;
      return function done() {
        pending--;
        if (pending === 0) {
          resolveDone();
        }
      };
    },
  };
  return { assert: assert, donePromise: donePromise, isAsync: function() { return asyncRequested; } };
}

export function test(name, fn) {
  it(name, async function() {
    var ctx = makeAssert();
    fn(ctx.assert);
    if (ctx.isAsync()) {
      await ctx.donePromise;
    }
  });
}
