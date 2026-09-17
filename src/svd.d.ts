// Type declaration for svd.js, kept as plain JS (see mol/superpose.ts for
// why: dense, externally-sourced numerical code where mechanical
// type-annotation under noUncheckedIndexedAccess isn't worth the
// transcription risk). This just describes its public shape for consumers.
export interface SvdResult {
  U: number[][];
  S: number[];
  V: number[][];
}

declare function svd(a: number[][]): SvdResult;

export default svd;
