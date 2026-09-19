import color from '../color';

// pv only ships a small hand-picked named-color palette (see color.ts's
// COLORS table), not the full CSS color name set MVS allows. Hex values are
// always supported; named colors are only supported when they happen to be
// in pv's palette (plus the American/British "gray"/"grey" spellings).
const PV_COLOR_NAMES = new Set([
  'white', 'black', 'grey', 'lightgrey', 'darkgrey',
  'red', 'darkred', 'lightred',
  'green', 'darkgreen', 'lightgreen',
  'blue', 'darkblue', 'lightblue',
  'yellow', 'darkyellow', 'lightyellow',
  'cyan', 'darkcyan', 'lightcyan',
  'magenta', 'darkmagenta', 'lightmagenta',
  'orange', 'darkorange', 'lightorange',
]);

const GRAY_TO_GREY: Record<string, string> = {
  gray: 'grey', darkgray: 'darkgrey', lightgray: 'lightgrey',
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

export type ColorResolution =
  | { supported: true; colorOp: InstanceType<typeof color.ColorOp> }
  | { supported: false; reason: string };

export function resolveMVSColor(value: string): ColorResolution {
  if (HEX_COLOR_RE.test(value)) {
    return { supported: true, colorOp: color.uniform(value) };
  }
  const normalized = value.toLowerCase();
  const pvName = GRAY_TO_GREY[normalized] ?? normalized;
  if (PV_COLOR_NAMES.has(pvName)) {
    return { supported: true, colorOp: color.uniform(pvName) };
  }
  return {
    supported: false,
    reason: `color "${value}" is not a hex value and not in pv's named-color palette`,
  };
}
