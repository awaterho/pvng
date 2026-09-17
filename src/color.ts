// Copyright (c) 2013-2015 Marco Biasini
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
import { vec4 } from 'gl-matrix';

type RGBA = vec4 | number[];

// Structural typing for the mol data model (Atom/Residue/Chain/Mol, some
// already converted, some not): only what the color schemes below touch.
interface ColorResidue {
  ss(): string;
  index(): number;
  chain(): ColorChain;
}
interface ColorAtom {
  element(): string;
  residue(): ColorResidue;
}
interface HasProp {
  prop(name: string): number;
}
interface ColorBackboneTrace {
  length(): number;
  residueAt(index: number): { index(): number };
}
interface ColorChain {
  name(): string;
  backboneTraces(): ColorBackboneTrace[];
  residues(): { ss(): string; index(): number }[];
}
interface ColorObj {
  chains(): ColorChain[];
  eachAtom(callback: (atom: ColorAtom & HasProp) => void): void;
  eachResidue(callback: (residue: ColorResidue & HasProp) => void): void;
}

const rgb = {
  create: vec4.create,
  scale: vec4.scale,
  copy: vec4.copy,
  clone: vec4.clone,
  fromValues: vec4.fromValues,
  mix: function(out: RGBA, colorOne: RGBA, colorTwo: RGBA, t: number): RGBA {
    const oneMinusT = 1.0 - t;
    out[0] = colorOne[0]!*t+colorTwo[0]!*oneMinusT;
    out[1] = colorOne[1]!*t+colorTwo[1]!*oneMinusT;
    out[2] = colorOne[2]!*t+colorTwo[2]!*oneMinusT;
    out[3] = colorOne[3]!*t+colorTwo[3]!*oneMinusT;
    return out;
  },
};

let COLORS: Record<string, RGBA> = {
  white :        rgb.fromValues(1.0,1.0 ,1.0,1.0),
  black :        rgb.fromValues(0.0,0.0 ,0.0,1.0),
  grey :         rgb.fromValues(0.5,0.5 ,0.5,1.0),
  lightgrey :    rgb.fromValues(0.8,0.8 ,0.8,1.0),
  darkgrey :     rgb.fromValues(0.3,0.3 ,0.3,1.0),
  red :          rgb.fromValues(1.0,0.0 ,0.0,1.0),
  darkred :      rgb.fromValues(0.5,0.0 ,0.0,1.0),
  lightred :     rgb.fromValues(1.0,0.5 ,0.5,1.0),
  green :        rgb.fromValues(0.0,1.0 ,0.0,1.0),
  darkgreen :    rgb.fromValues(0.0,0.5 ,0.0,1.0),
  lightgreen :   rgb.fromValues(0.5,1.0 ,0.5,1.0),
  blue :         rgb.fromValues(0.0,0.0 ,1.0,1.0),
  darkblue :     rgb.fromValues(0.0,0.0 ,0.5,1.0),
  lightblue :    rgb.fromValues(0.5,0.5 ,1.0,1.0),
  yellow :       rgb.fromValues(1.0,1.0 ,0.0,1.0),
  darkyellow :   rgb.fromValues(0.5,0.5 ,0.0,1.0),
  lightyellow :  rgb.fromValues(1.0,1.0 ,0.5,1.0),
  cyan :         rgb.fromValues(0.0,1.0 ,1.0,1.0),
  darkcyan :     rgb.fromValues(0.0,0.5 ,0.5,1.0),
  lightcyan :    rgb.fromValues(0.5,1.0 ,1.0,1.0),
  magenta :      rgb.fromValues(1.0,0.0 ,1.0,1.0),
  darkmagenta :  rgb.fromValues(0.5,0.0 ,0.5,1.0),
  lightmagenta : rgb.fromValues(1.0,0.5 ,1.0,1.0),
  orange :       rgb.fromValues(1.0,0.5 ,0.0,1.0),
  darkorange :   rgb.fromValues(0.5,0.25,0.0,1.0),
  lightorange :  rgb.fromValues(1.0,0.75,0.5,1.0)
};


function hex2rgb(color: string, alpha?: number): RGBA | undefined {
  alpha = alpha === undefined ? 1.0 : +alpha;
  let r, g, b, a;
  if (color.length === 4 || color.length === 5 ) {
    r = parseInt(color[1]!, 16);
    g = parseInt(color[2]!, 16);
    b = parseInt(color[3]!, 16);
    a = Math.round(alpha * 15);
    if(color.length===5) {
      a = parseInt(color[4]!, 16);
    }
    const oneOver15 = 1/15.0;
    return rgb.fromValues(oneOver15 * r, oneOver15 * g,
                          oneOver15 * b, oneOver15 * a);
  }
  if (color.length === 7 || color.length === 9) {
    r = parseInt(color.substr(1, 2), 16);
    g = parseInt(color.substr(3, 2), 16);
    b = parseInt(color.substr(5, 2), 16);
    a = Math.round(255 * alpha);
    if(color.length===9) {
      a = parseInt(color.substr(7, 2), 16);
    }
    const oneOver255 = 1/255.0;
    return rgb.fromValues(oneOver255 * r, oneOver255 * g,
                          oneOver255 * b, oneOver255 * a);
  }
  return undefined;
}


// provide an override of the default color setting.
function setColorPalette(customColors: Record<string, RGBA>): void {
  console.log("setting colors");
  COLORS = customColors;
  initGradients();
}

// internal function to force various types into an RGBA quadruplet
function forceRGB(color: string | RGBA, alpha?: number): RGBA {
  alpha = alpha === undefined ? 1.0 : +alpha;
  if (typeof color === 'string') {
    const lookup = COLORS[color];
    if (lookup !== undefined) {
      const cloned = rgb.clone(lookup as vec4) as RGBA;
      cloned[3] = alpha;
      return cloned;
    }
    if (color.length > 0 && color[0] === '#') {
      return hex2rgb(color, alpha)!;
    }
    return color as unknown as RGBA;
  }
  // in case no alpha component is provided, default alpha to 1.0
  if (color.length === 3) {
    return [color[0]!, color[1]!, color[2]!, alpha];
  }
  return color;
}

type ColorFunc = (this: ColorOp, atom: ColorAtom, out: Float32Array | number[], index: number) => void;
type BeginFunc = ((this: ColorOp, obj: ColorObj) => void) | null;
type EndFunc = ((this: ColorOp) => void) | null;

class ColorOp {
  colorFor: ColorFunc;
  private _beginFunc: BeginFunc;
  private _endFunc: EndFunc;
  // scratch state, set ad-hoc by individual color scheme begin()
  // callbacks and read by their colorFor callbacks.
  [key: string]: unknown;

  constructor(colorFunc: ColorFunc, beginFunc: BeginFunc, endFunc: EndFunc) {
    this.colorFor = colorFunc;
    this._beginFunc = beginFunc;
    this._endFunc = endFunc;
  }

  begin(obj: ColorObj): void {
    if (this._beginFunc) {
      this._beginFunc(obj);
    }
  }

  end(): void {
    if (this._endFunc) {
      this._endFunc();
    }
  }
}


function uniform(color?: string | RGBA): ColorOp {
  const forced = forceRGB(color || 'white');
  return new ColorOp(function(atom, out, index) {
    out[index+0] = forced[0]!;
    out[index+1] = forced[1]!;
    out[index+2] = forced[2]!;
    out[index+3] = forced[3]!;
  }, null, null);
}

const CPK_TABLE: Record<string, [number, number, number]> = {
 H :  [0.87, 0.87, 0.87],
 C :  [0.61, 0.61, 0.61],
 N :  [0.00, 0.47, 0.84],
 O :  [0.97, 0.18, 0.18],
 F :  [0.12, 0.94, 0.12],
 CL : [0.12, 0.94, 0.12],
 BR : [0.60, 0.13, 0.00],
 I :  [0.40, 0.00, 0.73],
 HE : [0.00, 1.00, 1.00],
 NE : [0.00, 1.00, 1.00],
 AR : [0.00, 1.00, 1.00],
 XE : [0.00, 1.00, 1.00],
 KR : [0.00, 1.00, 1.00],
 P :  [1.00, 0.43, 0.13],
 S :  [1.00, 0.73, 0.22],
 B :  [1.00, 0.67, 0.47],
 LI : [0.47, 0.00, 1.00],
 NA : [0.47, 0.00, 1.00],
 K :  [0.47, 0.00, 1.00],
 RB : [0.47, 0.00, 1.00],
 CS : [0.47, 0.00, 1.00],
 FR : [0.47, 0.00, 1.00],
 BE : [0.00, 0.47, 0.00],
 MG : [0.00, 0.47, 0.00],
 SR : [0.00, 0.47, 0.00],
 BA : [0.00, 0.47, 0.00],
 RA : [0.00, 0.47, 0.00],
 TI : [0.60, 0.60, 0.60],
 FE : [0.56, 0.31, 0.12]
};

function byElement(palette?: Record<string, [number, number, number]>): ColorOp {
  if (!palette) {
    palette = CPK_TABLE;
  }
  return new ColorOp(function(atom, out, index) {
    const ele = atom.element();
    const color = palette![ele];
    if (color !== undefined) {
      out[index] = color[0];
      out[index+1] = color[1];
      out[index+2] = color[2];
      out[index+3] = 1.0;
      return;
    }
    out[index] = 1;
    out[index+1] = 0;
    out[index+2] = 1;
    out[index+3] = 1.0;
  }, null, null);
}

interface SSGradient {
  _colors?: RGBA[];
  C?: string | RGBA;
  H?: string | RGBA;
  E?: string | RGBA;
}

function bySS(grad?: SSGradient): ColorOp {
  let palette: Record<string, RGBA>;
  if (grad && grad._colors) {
    palette = {
      C: grad._colors[0]!,
      H: grad._colors[1]!,
      E: grad._colors[2]!
    };
  } else if (grad) {
    palette = {
      C : forceRGB(grad.C!),
      H : forceRGB(grad.H!),
      E : forceRGB(grad.E!)
    };
  } else {
    palette = {
      C: [0.8, 0.8, 0.8, 1.0],
      H: [0.6, 0.6, 0.9, 1.0],
      E: [0.2, 0.8, 0.2, 1.0]
    };
  }

  return new ColorOp(function(atom, out, index) {
    const ss = atom.residue().ss();
    const color = palette[ss];
    if (color !== undefined) {
      out[index] = color[0]!;
      out[index+1] = color[1]!;
      out[index+2] = color[2]!;
      out[index+3] = color[3]!;
    }
  }, null, null);
}

function rainbow(grad?: Gradient): ColorOp {
  if (!grad) {
    grad = gradient('rainbow') as Gradient;
  }
  const colorFunc = new ColorOp(function(a, out, index) {
    let t = 0.0;
    const limits = (this.chainLimits as Record<string, [number, number]>)[a.residue().chain().name()];
    if (limits !== undefined) {
      const idx = a.residue().index();
      t =  (idx - limits[0])/(limits[1]-limits[0]);
    }
    const x: RGBA = [1,1,1,1];
    grad!.colorAt(x, t);
    out[index] = x[0]!;
    out[index+1] = x[1]!;
    out[index+2] = x[2]!;
    out[index+3] = x[3]!;
  }, function(obj) {
    const chains = obj.chains();
    const chainLimits: Record<string, [number, number]> = {};
    this.chainLimits = chainLimits;
    for (let i = 0; i < chains.length; ++i) {
      const bb = chains[i]!.backboneTraces();
      if (bb.length === 0) {
        continue;
      }
      let minIndex = bb[0]!.residueAt(0).index(),
          maxIndex = bb[0]!.residueAt(bb[0]!.length()-1).index();
      for (let j = 1; j < bb.length; ++j) {
        const bbj = bb[j]!;
        minIndex = Math.min(minIndex, bbj.residueAt(0).index());
        maxIndex = Math.max(maxIndex, bbj.residueAt(bbj.length()-1).index());
      }
      if (minIndex !== maxIndex) {
        chainLimits[chains[i]!.name()] = [minIndex, maxIndex];
      }
    }
  },
  function() {
    this.chainLimits = null;
  });
  return colorFunc;
}

interface Gradient {
  _colors: RGBA[];
  colorAt(out: RGBA, value: number): RGBA;
}

function ssSuccession(grad?: Gradient, coilColor?: string | RGBA): ColorOp {
  if (!grad) {
    grad = gradient('rainbow') as Gradient;
  }
  const resolvedCoilColor = forceRGB(coilColor || 'lightgrey');
  const colorFunc = new ColorOp(function(a, out, index) {
    const idx = a.residue().index();
    const limits = (this.chainLimits as Record<string, { indices: Record<number, number>; max: number | null }>)[a.residue().chain().name()]!;
    const ssIndex = limits.indices[idx]!;
    if (ssIndex === -1) {
      out[index] = resolvedCoilColor[0]!;
      out[index+1] = resolvedCoilColor[1]!;
      out[index+2] = resolvedCoilColor[2]!;
      out[index+3] = resolvedCoilColor[3]!;
      return;
    }
    let t = 0.0;
    if (limits.max !== null) {
      t =  ssIndex/(limits.max > 0 ? limits.max : 1);
    }
    const x: RGBA = [0,0,0,0];
    grad!.colorAt(x, t);
    out[index] = x[0]!;
    out[index+1] = x[1]!;
    out[index+2] = x[2]!;
    out[index+3] = x[3]!;
  }, function(obj) {
    const chains = obj.chains();
    const chainLimits: Record<string, { indices: Record<number, number>; max: number | null }> = {};
    this.chainLimits = chainLimits;
    for (let i = 0; i < chains.length; ++i) {
      const residues = chains[i]!.residues();
      let maxIndex: number | null = null;
      const indices: Record<number, number> = {};
      let ssIndex = 0;
      let lastSS = 'C';
      for (let j = 0; j < residues.length; ++j) {
        const ss =  residues[j]!.ss();
        if (ss === 'C') {
          if (lastSS !== 'C') {
            ssIndex++;
          }
          indices[residues[j]!.index()] = -1;
        } else {
          maxIndex = ssIndex;
          indices[residues[j]!.index()] = ssIndex;
        }
        lastSS = ss;
      }
      chainLimits[chains[i]!.name()] = {
        indices : indices,
        max: maxIndex
      };
    }
  },
  function() {
    this.chainLimits = null;
  });
  return colorFunc;
}

function byChain(grad?: Gradient): ColorOp {
  if (!grad) {
    grad = gradient('rainbow') as Gradient;
  }
  const colorFunc = new ColorOp(function(a, out, index) {
    const chainIndex = (this.chainIndices as Record<string, number>)[a.residue().chain().name()]!;
    const t =  chainIndex*(this.scale as number);
    const x: RGBA = [0,0,0,0];
    grad!.colorAt(x, t);
    out[index+0] = x[0]!;
    out[index+1] = x[1]!;
    out[index+2] = x[2]!;
    out[index+3] = x[3]!;
  }, function(obj) {
    const chains = obj.chains();
    const chainIndices: Record<string, number> = {};
    this.chainIndices = chainIndices;
    for (let i = 0; i < chains.length; ++i) {
      chainIndices[chains[i]!.name()] = i;
    }
    this.scale = chains.length > 1 ? 1.0/(chains.length-1) : 1.0;
  },
  function() {
    this.chainIndices = null;
  });
  return colorFunc;
}

function getMinMaxRange(
  obj: ColorObj, iter: 'eachAtom' | 'eachResidue', propName: string
): { min: number | null; max: number | null } {
  let min: number | null = null;
  let max: number | null = null;
  obj[iter](function(item: HasProp) {
    const value = item.prop(propName);
    if (min === null && max === null) {
      min = max = value;
      return;
    }
    min = Math.min(min!, value);
    max = Math.max(max!, value);
  } as never);
  return { min: min, max: max };
}

const gradColor = (function() {
  const color = vec4.create();
  return function(out: Float32Array | number[], index: number, grad: Gradient, t: number): void {
    grad.colorAt(color, t);
    out[index+0] = color[0];
    out[index+1] = color[1];
    out[index+2] = color[2];
    out[index+3] = color[3];
  };
})();

function colorByItemProp(
  propName: string, grad: Gradient | undefined, range: [number, number] | undefined,
  iter: 'eachAtom' | 'eachResidue', item: (a: ColorAtom) => HasProp,
): ColorOp {
  if (!grad) {
    grad = gradient('rainbow') as Gradient;
  }
  return new ColorOp(function(a, out, index) {
    let t = 0.0;
    if (this._min !== this._max) {
      t = ((item(a).prop(propName) as number) - (this._min as number))/((this._max as number) - (this._min as number));
    }
    gradColor(out, index, grad!, t);
  },
  function(obj) {
    if (range !== undefined) {
      this._min = range[0];
      this._max = range[1];
      return;
    }
    const resolvedRange = getMinMaxRange(obj, iter, propName);
    this._min = resolvedRange.min;
    this._max = resolvedRange.max;
  },
  function() { }
  );
}

function byAtomProp(propName: string, grad?: Gradient, range?: [number, number]): ColorOp {
  return colorByItemProp(propName, grad, range, 'eachAtom',
                         function(a) {return a as unknown as HasProp;});
}

function byResidueProp(propName: string, grad?: Gradient, range?: [number, number]): ColorOp {
  return colorByItemProp(propName, grad, range, 'eachResidue',
                         function(a) {return a.residue() as unknown as HasProp;});
}

// linearly interpolates the array of colors and returns it as a Float32Array
// color must be an array containing a sequence of R,G,B triples.
function interpolateColor(colors: ArrayLike<number>, num: number): Float32Array {
  const out = new Float32Array((num*(colors.length/4-1) + 1)*4);
  let index = 0;
  const bf = vec4.create(), af = vec4.create();
  const halfNum = num/2;
  for (let i = 0; i < colors.length/4-1; ++i) {
    vec4.set(bf, colors[4*i+0]!, colors[4*i+1]!, colors[4*i+2]!, colors[4*i+3]!);
    vec4.set(af, colors[4*i+4]!, colors[4*i+5]!, colors[4*i+6]!, colors[4*i+7]!);
    for (let j = 0; j < num; ++j) {
      const t = j < halfNum ? 0.0 : 1.0;
      out[index+0] = bf[0]*(1-t)+af[0]*t;
      out[index+1] = bf[1]*(1-t)+af[1]*t;
      out[index+2] = bf[2]*(1-t)+af[2]*t;
      out[index+3] = bf[3]*(1-t)+af[3]*t;
      index+=4;
    }
  }
  out[index+0] = af[0];
  out[index+1] = af[1];
  out[index+2] = af[2];
  out[index+3] = af[3];
  return out;
}

const GRADIENTS: Record<string, Gradient> = { };

class GradientImpl implements Gradient {
  _colors: RGBA[];
  private _stops: number[];

  constructor(colors: (string | RGBA)[], stops: number[]) {
    this._colors = colors.map(c => forceRGB(c));
    this._stops = stops;
  }

  colorAt(out: RGBA, value: number): RGBA {
    if (value <= this._stops[0]!) {
      return vec4.copy(out as vec4, this._colors[0] as vec4) as unknown as RGBA;
    }
    if (value >= this._stops[this._stops.length-1]!) {
      return vec4.copy(out as vec4, this._colors[this._stops.length-1] as vec4) as unknown as RGBA;
    }
    // could use a binary search here, but since most gradients
    // have a really small number of stops, that's not going to
    // help much.
    let lowerIndex = 0;
    for (let i = 1; i < this._stops.length; ++i) {
      if (this._stops[i]! > value) {
        break;
      }
      lowerIndex = i;
    }
    const upperIndex = lowerIndex + 1;
    const lowerStop = this._stops[lowerIndex]!;
    const upperStop = this._stops[upperIndex]!;
    const t = (value - lowerStop)/ (upperStop - lowerStop);
    return rgb.mix(out, this._colors[upperIndex]!, this._colors[lowerIndex]!, t);
  }
}

// creates a new gradient from the given set of colors.
//
// colors must be a valid list of colors.
//
// when stops is set to 'equal' or ommitted, then the color stops are
// assumed to be equi distant on the interval 0,1. otherwise, stops
// must be  a list of floating point numbers with the same length
// than colors.
function gradient(colors: string | (string | RGBA)[], stops?: number[] | 'equal'): Gradient | undefined {
  if (typeof colors === 'string') {
    return GRADIENTS[colors];
  }
  let resolvedStops: number[];
  if (!stops || stops === 'equal') {
    resolvedStops = [];
    for (let i = 0; i < colors.length; ++i) {
      resolvedStops.push(i*1.0/(colors.length-1));
    }
  } else {
    resolvedStops = stops;
  }
  return new GradientImpl(colors, resolvedStops);
}

function initGradients(): void {
  GRADIENTS.rainbow = gradient(['blue', 'green', 'yellow', 'red'])!;
  GRADIENTS.reds = gradient(['lightred', 'darkred'])!;
  GRADIENTS.greens = gradient(['lightgreen', 'darkgreen'])!;
  GRADIENTS.blues = gradient(['lightblue', 'darkblue'])!;
  GRADIENTS.trafficlight = gradient(['green', 'yellow', 'red'])!;
  GRADIENTS.heatmap = gradient(['red', 'white', 'blue'])!;
}

// initialize gradients with default colors
initGradients();

export default {
  rgb,
  hex2rgb,
  setColorPalette,
  forceRGB,
  ColorOp,
  uniform,
  byElement,
  bySS,
  rainbow,
  ssSuccession,
  byChain,
  byAtomProp,
  byResidueProp,
  interpolateColor,
  gradient,
  initGradients,
};
