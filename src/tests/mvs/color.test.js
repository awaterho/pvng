import { test, strictEqual, ok } from '../helpers';
import { resolveMVSColor } from '../../mvs/color';

test('mvs color: hex values are always supported', function() {
  var resolved = resolveMVSColor('#6688ff');
  strictEqual(resolved.supported, true);
  ok(resolved.colorOp);
});

test('mvs color: names in pv\'s palette are supported', function() {
  var resolved = resolveMVSColor('green');
  strictEqual(resolved.supported, true);
});

test('mvs color: American "gray" spelling maps to pv\'s "grey"', function() {
  var resolved = resolveMVSColor('darkgray');
  strictEqual(resolved.supported, true);
});

test('mvs color: names outside pv\'s small palette are reported unsupported, not guessed', function() {
  var resolved = resolveMVSColor('cornflowerblue');
  strictEqual(resolved.supported, false);
  strictEqual(typeof resolved.reason, 'string');
});
