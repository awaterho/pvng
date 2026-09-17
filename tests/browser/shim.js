// Minimal in-browser QUnit-compatible test shim. Existing QUnit-style test
// files (test(name, function(assert) {...}) using assert.ok/strictEqual/
// vecNEqual/matNEqual/async etc.) run against this instead of real QUnit,
// so they can be ported to Playwright by changing only the module wrapper.
// Results are collected here (not thrown) so a single Playwright test can
// run a whole fixture file inside the page and report every QUnit test's
// pass/fail back to Node afterwards.
let results = [];
let pending = 0;

export function getResults() {
  return results;
}

export function getPending() {
  return pending;
}

function almostEqual(actual, expected, epsilon) {
  epsilon = epsilon === undefined ? 0.000001 : epsilon;
  return Math.abs(actual - expected) < epsilon;
}

function makeAssert(entry) {
  function record(cond, msg) {
    if (!cond) {
      entry.passed = false;
      entry.errors.push(msg);
    }
  }
  const assert = {
    ok: function(cond, msg) { record(!!cond, msg || 'ok() failed'); },
    notOk: function(cond, msg) { record(!cond, msg || 'notOk() failed'); },
    strictEqual: function(a, b, msg) {
      record(a === b, msg || (String(a) + ' !== ' + String(b)));
    },
    notStrictEqual: function(a, b, msg) {
      record(a !== b, msg || (String(a) + ' === ' + String(b)));
    },
    equal: function(a, b, msg) { record(a == b, msg || (String(a) + ' != ' + String(b))); },
    notEqual: function(a, b, msg) { record(a != b, msg || (String(a) + ' == ' + String(b))); },
    deepEqual: function(a, b, msg) {
      record(JSON.stringify(a) === JSON.stringify(b), msg || 'deepEqual failed');
    },
    throws: function(fn, msg) {
      let threw = false;
      try { fn(); } catch { threw = true; }
      record(threw, msg || 'expected function to throw');
    },
    almostEqual: function(a, b, epsilon, msg) {
      record(almostEqual(a, b, epsilon), msg || (a + ' !~ ' + b));
    },
    vec2Equal: function(a, b, epsilon) {
      for (let i = 0; i < 2; ++i) assert.almostEqual(a[i], b[i], epsilon);
    },
    vec3Equal: function(a, b, epsilon) {
      for (let i = 0; i < 3; ++i) assert.almostEqual(a[i], b[i], epsilon);
    },
    vec4Equal: function(a, b, epsilon) {
      for (let i = 0; i < 4; ++i) assert.almostEqual(a[i], b[i], epsilon);
    },
    mat3Equal: function(a, b, epsilon) {
      for (let i = 0; i < 9; ++i) assert.almostEqual(a[i], b[i], epsilon);
    },
    mat4Equal: function(a, b, epsilon) {
      for (let i = 0; i < 16; ++i) assert.almostEqual(a[i], b[i], epsilon);
    },
    async: function() {
      pending++;
      let done = false;
      return function() {
        if (done) return;
        done = true;
        pending--;
      };
    },
  };
  return assert;
}

export function test(name, fn) {
  const entry = { name: name, passed: true, errors: [] };
  results.push(entry);
  const assert = makeAssert(entry);
  try {
    fn(assert);
  } catch (e) {
    entry.passed = false;
    entry.errors.push('exception: ' + (e && e.message ? e.message : String(e)));
  }
}
