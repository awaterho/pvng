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
import { vec3, mat4 } from 'gl-matrix';
import symmetry, { type Assembly, type SymGenerator } from './mol/symmetry';
import mol from './mol/all';
import { parseCIF, type CIFRow } from './cif';

const Mol = mol.Mol;
type Mol = InstanceType<typeof Mol>;
type Chain = ReturnType<Mol['addChain']>;
type Residue = ReturnType<Chain['addResidue']>;
type AtomT = ReturnType<Residue['addAtom']>;

interface PdbOptions {
  conectRecords?: boolean;
  loadAllModels?: boolean;
}

class Remark350Reader {
  private _assemblies: Record<string, Assembly>;
  private _current: unknown;
  private _currentAssembly!: Assembly;
  private _currentSymGen!: SymGenerator;
  private _currentMatrix!: mat4;

  constructor() {
    this._assemblies = {};
    this._current = null;
  }

  assemblies(): Assembly[] {
    const assemblies: Assembly[] = [];
    for (const c in this._assemblies) {
      if (Object.prototype.hasOwnProperty.call(this._assemblies, c)) {
        // We are sure that obj[key] belongs to the object and was not
        // inherited.
        assemblies.push(this._assemblies[c]!);
      }
    }
    return assemblies;
  }

  assembly(id: string): Assembly | undefined {
    return this._assemblies[id];
  }


  nextLine(fullLine: string): void {
    const line = fullLine.substr(11);
    if (line[0] === 'B' && line.substr(0, 12) === 'BIOMOLECULE:') {
      const name =  line.substr(13).trim();
      this._currentAssembly = new symmetry.Assembly(name);
      this._assemblies[name] =  this._currentAssembly;
      return;
    }
    if (line.substr(0, 30) === 'APPLY THE FOLLOWING TO CHAINS:' ||
        line.substr(0, 30) === '                   AND CHAINS:') {
      const chains = line.substr(30).split(',');
      if (line[0] === 'A') {
        this._currentSymGen = new symmetry.SymGenerator();
        this._currentAssembly.addGenerator(this._currentSymGen);
      }
      this._currentMatrix = mat4.create();
      for (let i = 0; i < chains.length; ++i) {
        const trimmedChainName = chains[i]!.trim();
        if (trimmedChainName.length) {
          this._currentSymGen.addChain(trimmedChainName);
        }
      }
      return;
    }
    if (line.substr(0, 7) === '  BIOMT') {
      const col = parseInt(line[7]!, 10) - 1;
      let offset = 0;
      // for PDB files with 100 or more BIOMT matrices, the columns are
      // shifted to the right by one digit (see PDB entry 1m4x, for
      // example). The offset increases by one for every additional
      // digit.
      while (line[12 + offset] !== ' ') {
        offset += 1;
      }
      const x = parseFloat(line.substr(13 + offset, 9));
      const y = parseFloat(line.substr(23 + offset, 9));
      const z = parseFloat(line.substr(33 + offset, 9));
      const w = parseFloat(line.substr(43 + offset, 14));
      this._currentMatrix[4*0+col] = x;
      this._currentMatrix[4*1+col] = y;
      this._currentMatrix[4*2+col] = z;
      this._currentMatrix[4*3+col] = w;
      if (col === 2) {
        this._currentSymGen.addMatrix(this._currentMatrix);
        this._currentMatrix = mat4.create();
      }
      return;
    }
  }
}

// Very simple heuristic to determine the element from the atom name.
// This at the very least assume that people have the decency to follow
// the standard naming conventions for atom names when they are too
// lazy to write down elements
function guessAtomElementFromName(fourLetterName: string): string {
  if (fourLetterName[0] !== ' ') {
    const trimmed = fourLetterName.trim();
    if (trimmed.length === 4) {
      // look for first character in range A-Z or a-z and use that
      // for the element.
      let i = 0;
      let charCode = trimmed.charCodeAt(i);
      while (i < 4 && (charCode < 65 || charCode > 122 ||
             (charCode > 90 && charCode < 97))) {
        ++i;
        charCode = trimmed.charCodeAt(i);
      }
      return trimmed[i]!;
    }
    // when first character is not empty and length is smaller than 4,
    // assume that it's either a heavy atom (CA, etc), or a hydrogen
    // name with a numeric prefix.  That's not always correct, though.
    const firstCharCode = trimmed.charCodeAt(0);
    if (firstCharCode >= 48 && firstCharCode <= 57) {
      // numeric prefix, so it's a hydrogen
      return trimmed[1]!;
    }
    return trimmed.substr(0, 2);
  }
  return fourLetterName[1]!;
}

interface HelixSheetRecord {
  first: [number, string];
  last: [number, string];
  chainName: string;
}

interface ConectRecord {
  from: number;
  to: number[];
}

class PDBReader {
  // these are used as the return value of processLine()
  readonly CONTINUE = 1;
  readonly MODEL_COMPLETE = 2;
  readonly FILE_END = 3;
  readonly ERROR = 4;

  private _helices: HelixSheetRecord[];
  private _sheets: HelixSheetRecord[];
  private _conect: ConectRecord[];
  private _serialToAtomMap: Record<number, AtomT>;
  private _rosettaMode: boolean;
  private _structure: Mol;
  private _remark350Reader: Remark350Reader;
  private _currChain: Chain | null;
  private _currRes: Residue | null;
  private _currAtom: unknown;
  private _options: { conectRecords: boolean };

  constructor(options: PdbOptions) {
    this._helices = [];
    this._sheets = [];
    this._conect = [];
    this._serialToAtomMap = {};
    this._rosettaMode = false;
    this._structure = new Mol();
    this._remark350Reader = new Remark350Reader();
    this._currChain =  null;
    this._currRes = null;
    this._currAtom = null;
    this._options = { conectRecords: !!options.conectRecords };
  }

  parseHelixRecord(line: string): boolean {
    const frstNum = parseInt(line.substr(21, 4), 10);
    const frstInsCode = line[25] === ' ' ? '\0' : line[25]!;
    const lastNum = parseInt(line.substr(33, 4), 10);
    const lastInsCode = line[37] === ' ' ? '\0' : line[37]!;
    const chainName = line[19]!;
    this._helices.push({ first : [frstNum, frstInsCode],
            last : [lastNum, lastInsCode], chainName : chainName
    });
    return true;
  }

  parseRosettaAnnotation(line: string): number {
    // FIXME: for now this only works when there is one chain,
    // since the Rosetta format does not include any chain identifier.
    if (line.length < 5) {
      return this.CONTINUE;
    }
    const ss = line[5];
    const resNum = parseInt(line.substr(0, 5).trim(), 10);
    if (isNaN(resNum)) {
      console.error('could not parse residue number');
      return this.ERROR;
    }
    let secStructure = 'C';
    if (ss === 'H' || ss === 'E') {
      secStructure = ss;
    }
    if (this._structure.chains().length !== 1) {
      console.warn('multiple chains are present. arbitrarily',
                   'assigning secondary structure to the last chain.');
    }
    // for now just use the first chain
    const res = this._currChain!.residueByRnum(resNum);
    if (res === null) {
      console.warn('could not find residue', resNum, 'in last chain.',
                   'Skipping ROSETTA secondary structure annotation');
      return this.CONTINUE;
    }
    res.setSS(secStructure);
    return this.CONTINUE;

  }

  parseSheetRecord(line: string): boolean {
    const frstNum = parseInt(line.substr(22, 4), 10);
    const frstInsCode = line[26] === ' ' ? '\0' : line[26]!;
    const lastNum = parseInt(line.substr(33, 4), 10);
    const lastInsCode = line[37] === ' ' ? '\0' : line[37]!;
    const chainName = line[21]!;
    this._sheets.push({
      first : [frstNum, frstInsCode],
      last : [lastNum, lastInsCode],
      chainName : chainName
    });
    return true;
  }

  parseAndAddAtom(line: string): boolean {
    const alt_loc = line[16];
    if (alt_loc !== ' ' && alt_loc !== 'A') {
      return true;
    }
    const isHetatm = line[0] === 'H';
    const chainName = line[21]!;
    const resName = line.substr(17, 3).trim();
    const fullAtomName = line.substr(12, 4);
    const atomName = fullAtomName.trim();
    let rnumNum = parseInt(line.substr(22, 4), 10);
    // check for NaN
    if (rnumNum !== rnumNum) {
      rnumNum = 1;
    }
    const insCode = line[26] === ' ' ? '\0' : line[26]!;
    let updateResidue = false;
    let updateChain = false;
    if (!this._currChain || this._currChain.name() !== chainName) {
      updateChain = true;
      updateResidue = true;
    }
    if (!this._currRes || this._currRes.num() !== rnumNum ||
        this._currRes.insCode() !== insCode) {
      updateResidue = true;
    }
    if (updateChain) {
      // residues of one chain might appear interspersed with residues from
      // other chains.
      this._currChain = this._structure.chain(chainName) ||
                        this._structure.addChain(chainName);
    }
    if (updateResidue) {
      this._currRes = this._currChain!.addResidue(resName, rnumNum, insCode);
    }
    const pos = vec3.create();
    for (let i = 0; i < 3; ++i) {
      pos[i] = (parseFloat(line.substr(30 + i * 8, 8)));
    }
    let element = line.substr(76,2).trim();
    if (element === '') {
      element = guessAtomElementFromName(fullAtomName);
    }
    const occupancy = parseFloat(line.substr(54,6).trim());
    const tempFactor = parseFloat(line.substr(60,6).trim());
    const serial = parseInt(line.substr(6,5).trim(), 10);
    const atom = this._currRes!.addAtom(atomName, pos, element, isHetatm,
                                     isNaN(occupancy) ? undefined : occupancy,
                                     isNaN(tempFactor) ? undefined : tempFactor,
                                     serial);
    // in case parseConect records is set to true, store away the atom serial
    if (this._options.conectRecords) {
      this._serialToAtomMap[serial] = atom;
    }
    return true;
  }

  parseConectRecord(line: string): boolean {
    const atomSerial = parseInt(line.substr(6,5).trim(), 10);
    const bondPartnerIds: number[] = [];
    for (let i = 0; i < 4; ++i) {
      const partnerId = parseInt(line.substr(11 + i * 5, 6).trim(), 10);
      if (isNaN(partnerId)) {
        continue;
      }
      // bonds are listed twice, so to avoid duplicate bonds, only keep bonds
      // with the lower serials as the first atom.
      if (partnerId > atomSerial) {
        continue;
      }
      bondPartnerIds.push(partnerId);
    }
    this._conect.push( { from : atomSerial, to : bondPartnerIds });
    return true;
  }

  processLine(line: string): number {
    const recordName = line.substr(0, 6);
    if (recordName === 'ATOM  ' || recordName === 'HETATM') {
      return this.parseAndAddAtom(line) ? this.CONTINUE : this.ERROR;
    }
    if (recordName === 'REMARK') {
      // for now we are only interested in the biological assembly information
      // contained in remark 350.
      const remarkNumber = line.substr(7, 3);
      if (remarkNumber === '350') {
        this._remark350Reader.nextLine(line);
      }
      return this.CONTINUE;
    }
    if (recordName === 'HELIX ') {
      return this.parseHelixRecord(line) ? this.CONTINUE : this.ERROR;
    }
    if (recordName === 'SHEET ') {
      return this.parseSheetRecord(line) ? this.CONTINUE : this.ERROR;
    }
    if (this._options.conectRecords && recordName === 'CONECT') {
      return this.parseConectRecord(line) ? this.CONTINUE : this.ERROR;
    }
    if (recordName === 'END   ') {
      return this.FILE_END;
    }
    if (recordName === 'ENDMDL') {
      return this.MODEL_COMPLETE;
    }
    if (line.substr(0, 9) === 'complete:') {
      this._rosettaMode = true;
      return this.CONTINUE;
    }
    if (this._rosettaMode) {
      if (line.trim().length === 0) {
        // as soon as we hit an empty line, don't treat what comes after
        // as ROSETTA annotation
        this._rosettaMode = false;
        return this.CONTINUE;
      }
      return this.parseRosettaAnnotation(line);
    }
    return this.CONTINUE;
  }

  // called after parsing to perform any work that requires the complete
  // structure to be present:
  // (a) assigns the secondary structure information found in the helix
  // sheet records, (b) derives connectivity and (c) assigns assembly
  // information.
  finish(): Mol | null {
    // check if we have at least one atom, if not return null
    if (this._currChain === null) {
      return null;
    }
    let chain: Chain | null = null;
    let i;
    for (i = 0; i < this._sheets.length; ++i) {
      const sheet = this._sheets[i]!;
      chain = this._structure.chain(sheet.chainName);
      if (chain) {
        chain.assignSS(sheet.first, sheet.last, 'E');
      }
    }
    for (i = 0; i < this._helices.length; ++i) {
      const helix = this._helices[i]!;
      chain = this._structure.chain(helix.chainName);
      if (chain) {
        chain.assignSS(helix.first, helix.last, 'H');
      }
    }
    this._structure.setAssemblies(this._remark350Reader.assemblies());
    if (this._options.conectRecords) {
      this._assignBondsFromConectRecords(this._structure);
    }
    this._structure.deriveConnectivity();
    console.log('imported', this._structure.chains().length, 'chain(s),',
                this._structure.residueCount(), 'residue(s)');
    const result = this._structure;
    this._structure = new Mol();
    this._currChain =  null;
    this._currRes = null;
    this._currAtom = null;
    this._rosettaMode = false;
    return result;
  }

  _assignBondsFromConectRecords(structure: Mol): void {
    for (let i = 0; i < this._conect.length; ++i) {
      const record = this._conect[i]!;
      const fromAtom = this._serialToAtomMap[record.from]!;
      for (let j = 0; j < record.to.length; ++j) {
        const toAtom = this._serialToAtomMap[record.to[j]!]!;
        structure.connect(fromAtom as never, toAtom as never);
      }
    }
  }
}

function getLines(data: string): string[] {
  return data.split(/\r\n|\r|\n/g);
}

// a truly minimalistic PDB parser. It will die as soon as the input is
// not well-formed. it only reads ATOM, HETATM, HELIX, SHEET and REMARK
// 350 records, everything else is ignored. in case of multi-model
// files, only the first model is read.
//
// FIXME: load PDB currently spends a substantial amount of time creating
// the vec3 instances for the atom positions. it's possible that it's
// cheaper to initialize a bulk buffer once and create buffer views to
// that data for each atom position. since the atom's lifetime is bound to
// the parent structure, the buffer could be managed on that level and
// released once the structure is deleted.
function pdb(text: string, options?: PdbOptions): Mol | (Mol | null)[] | undefined {
  console.time('pdb');
  const opts = options || {};
  const lines = getLines(text);
  const reader = new PDBReader(opts);
  const structures: (Mol | null)[] = [];
  // depending on whether the loadAllModels flag is set process all models
  // in the PDB file
  for (let i = 0; i < lines.length; i++) {
    const result = reader.processLine(lines[i]!);
    if (result === reader.ERROR) {
      console.timeEnd('pdb');
      return undefined;
    }
    if (result === reader.CONTINUE) {
      continue;
    }
    const struct = reader.finish();
    if (struct !== null) {
      structures.push(struct);
    }
    if (result === reader.MODEL_COMPLETE && opts.loadAllModels) {
      continue;
    }
    break;
  }
  const structure = reader.finish();
  if (structure !== null) {
    structures.push(structure);
  }
  console.timeEnd('pdb');
  if (opts.loadAllModels) {
    return structures;
  }
  return structures[0] ?? undefined;
}


class SDFReader {
  private _structure: Mol;
  private _sawEnd: boolean;
  private _state!: number;
  private _currentResidue!: Residue | null;
  private _currentChain!: Chain | null;
  private _expectedAtomCount!: number | null;
  private _expectedBondCount!: number | null;
  private _atomCount!: number;
  private _bondCount!: number;
  private _title!: string;

  constructor() {
    this._structure = new Mol();
    this._reset();
    this._sawEnd = false;
  }

  processLine(line: string): boolean {
    const state = this._state;
    if (state < 3) {
      if (state === 0) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          return false;
        }
        this._title = trimmed;
      }
      this._sawEnd = false;
      // header line
      this._state++;
      return true;
    }
    if (state === 3) {
      // atom/bond count
      this._expectedAtomCount = parseInt(line.substr(0, 3).trim(), 10);
      this._expectedBondCount = parseInt(line.substr(3, 3).trim(), 10);
      if (isNaN(this._expectedAtomCount) || isNaN(this._expectedBondCount)) {
        console.error('invalid bond definition');
        return false;
      }
      this._state++;
      // is there a better way to convert an int to a string?
      const chainName = '' + (this._structure.chains().length + 1);
      this._currentChain = this._structure.addChain(chainName);
      this._currentResidue = this._currentChain.addResidue(this._title, 1);
    }
    if (state === 4) {
      const pos = vec3.create();
      for (let i = 0; i < 3; ++i) {
        pos[i] = parseFloat(line.substr(i*10, 10).trim());
        if (isNaN(pos[i]!)) {
          console.error('invalid atom position');
          return false;
        }
      }
      const element = line.substr(31, 3).trim();
      this._currentResidue!.addAtom(element, pos, element, false);
      this._atomCount++;
      if (this._atomCount === this._expectedAtomCount) {
        this._state++;
      }
    }
    if (state === 5) {
      const firstAtomIndex = parseInt(line.substr(0, 3).trim(), 10) - 1;
      const secondAtomIndex = parseInt(line.substr(3, 3).trim(), 10) - 1;
      if (isNaN(firstAtomIndex) || isNaN(secondAtomIndex)) {
        console.error('invalid bond definition');
        return false;
      }
      const atoms = this._currentResidue!.atoms();
      this._structure.connect(atoms[firstAtomIndex] as never, atoms[secondAtomIndex] as never);
      this._bondCount++;
      if (this._bondCount === this._expectedBondCount) {
        this._state++;
      }
    }
    if (line.substr(0, 6) === 'M  END') {
      this._sawEnd = true;
      this._state++;
    }
    if (line.substr(0, 4) === '$$$$') {
      this._reset();
    }
    return true;
  }

  _reset(): void {
    this._state = 0;
    this._currentResidue = null;
    this._currentChain = null;
    this._expectedAtomCount = null;
    this._expectedBondCount = null;
    this._atomCount = 0;
    this._bondCount = 0;
    this._title = '';
  }

  finish(): Mol | null {
    if (!this._sawEnd) {
      console.error('truncated SDF file');
      return null;
    }
    return this._structure;
  }
}

class CRDReader {
  private _structure: Mol;
  private _sawEnd: boolean;
  private _currentResidue!: Residue | null;
  private _currentChain!: Chain | null;

  constructor() {
    this._structure = new Mol();
    this._reset();
    this._sawEnd = false;
  }

  processLine(line: string): boolean {
    if (line.length === 0 || line[0] === '*') {
      return true;
    }
    if (line.length < 52) {
      return true;
    }

    const aName = line.substr(16, 5);
    const rNum =  parseInt(line.substr(6, 4).trim(), 10);
    const rName = line.substr(11, 3).trim();
    const pos = vec3.create();
    for (let i = 0; i < 3; ++i) {
      pos[i] = parseFloat(line.substr(20 + i * 10, 10).trim());
    }
    const cName =  line[51]!;
    if (this._currentChain === null || this._currentChain.name() !== cName) {
      this._currentResidue = null;
      this._currentChain = this._structure.chain(cName);
      if (this._currentChain === null) {
        this._currentChain = this._structure.addChain(cName);
      }
    }
    if (this._currentResidue === null || this._currentResidue.num() !== rNum) {
      this._currentResidue = this._currentChain.addResidue(rName, rNum);
    }
    this._currentResidue.addAtom(aName.trim(), pos,
                                 aName[0]!, false,
                                 1.00, 0.00);
    return true;
  }

  _reset(): void {
    this._currentResidue = null;
    this._currentChain = null;
  }

  finish(): Mol {
    this._structure.deriveConnectivity();
    return this._structure;
  }
}

function sdf(text: string): Mol | null {
  console.time('sdf');
  const reader = new SDFReader();
  const lines = getLines(text);
  for (let i = 0; i < lines.length; i++) {
    if (!reader.processLine(lines[i]!)) {
      break;
    }
  }
  const structure = reader.finish();
  console.timeEnd('sdf');
  return structure;
}

function crd(text: string): Mol {
  console.time('crd');
  const reader = new CRDReader();
  const lines = getLines(text);
  for (let i = 0; i < lines.length; i++) {
    if (!reader.processLine(lines[i]!)) {
      break;
    }
  }
  const structure = reader.finish();
  console.timeEnd('crd');
  return structure;
}

interface CifOptions {
  loadAllModels?: boolean;
}

// builds a gl-matrix mat4 from one _pdbx_struct_oper_list row's matrix[i][j]/
// vector[i] columns. Mirrors Remark350Reader's BIOMT layout above: column c
// (0-indexed) of the resulting matrix holds CIF matrix column c+1, i.e.
// m[c*4+r] = row's matrix[r+1][c+1] -- the standard column-major encoding of
// `newPos = M*pos + t`.
function operatorMatrixFromRow(row: CIFRow): mat4 {
  const m = mat4.create();
  m[0] = row.getNumber('matrix[1][1]') ?? 1;
  m[1] = row.getNumber('matrix[2][1]') ?? 0;
  m[2] = row.getNumber('matrix[3][1]') ?? 0;
  m[4] = row.getNumber('matrix[1][2]') ?? 0;
  m[5] = row.getNumber('matrix[2][2]') ?? 1;
  m[6] = row.getNumber('matrix[3][2]') ?? 0;
  m[8] = row.getNumber('matrix[1][3]') ?? 0;
  m[9] = row.getNumber('matrix[2][3]') ?? 0;
  m[10] = row.getNumber('matrix[3][3]') ?? 1;
  m[12] = row.getNumber('vector[1]') ?? 0;
  m[13] = row.getNumber('vector[2]') ?? 0;
  m[14] = row.getNumber('vector[3]') ?? 0;
  return m;
}

// expands one comma-separated, possibly range-containing operator id list
// (e.g. "1,2,5-7") into individual id strings ["1","2","5","6","7"].
function expandOperatorIds(list: string): string[] {
  const ids: string[] = [];
  const parts = list.split(',');
  for (let i = 0; i < parts.length; ++i) {
    const part = parts[i]!.trim();
    if (part.length === 0) {
      continue;
    }
    // operator ids are non-negative integers, so a '-' here is always a
    // range separator, never a negative sign.
    const dash = part.indexOf('-');
    if (dash > 0) {
      const from = parseInt(part.substring(0, dash), 10);
      const to = parseInt(part.substring(dash + 1), 10);
      if (!isNaN(from) && !isNaN(to)) {
        for (let v = from; v <= to; ++v) {
          ids.push(String(v));
        }
        continue;
      }
    }
    ids.push(part);
  }
  return ids;
}

// splits a _pdbx_struct_assembly_gen.oper_expression like "(1-60)(61-88)"
// into its parenthesized groups, each expanded to a list of operator ids. An
// expression with no parentheses at all (e.g. "1,2") is treated as a single
// group.
function parseOperExpression(expression: string): string[][] {
  const trimmed = expression.trim();
  if (trimmed.indexOf('(') === -1) {
    return [ expandOperatorIds(trimmed) ];
  }
  const groups: string[][] = [];
  let i = 0;
  const n = trimmed.length;
  while (i < n) {
    if (trimmed[i] === '(') {
      let depth = 1;
      let j = i + 1;
      while (j < n && depth > 0) {
        if (trimmed[j] === '(') {
          depth++;
        } else if (trimmed[j] === ')') {
          depth--;
        }
        j++;
      }
      groups.push(expandOperatorIds(trimmed.substring(i + 1, j - 1)));
      i = j;
    } else {
      i++;
    }
  }
  return groups;
}

// expands an oper_expression into its final, literal list of transforms:
// the Cartesian product of every parenthesized group, composed so that the
// left-most group's operator is applied first (e.g. for "(A)(B)", each
// resulting matrix is M(b) * M(a), i.e. "apply a, then b").
function composeOperExpression(expression: string, operators: Map<string, mat4>): mat4[] {
  const groups = parseOperExpression(expression);
  let combos: mat4[] | null = null;
  for (let g = 0; g < groups.length; ++g) {
    const groupMatrices: mat4[] = [];
    const ids = groups[g]!;
    for (let i = 0; i < ids.length; ++i) {
      const m = operators.get(ids[i]!);
      if (m !== undefined) {
        groupMatrices.push(m);
      }
    }
    if (combos === null) {
      combos = groupMatrices.map(function(m) { return mat4.clone(m); });
      continue;
    }
    const next: mat4[] = [];
    for (let a = 0; a < combos.length; ++a) {
      for (let b = 0; b < groupMatrices.length; ++b) {
        const result = mat4.create();
        mat4.multiply(result, groupMatrices[b]!, combos[a]!);
        next.push(result);
      }
    }
    combos = next;
  }
  return combos ?? [];
}

class CIFReader {
  private _doc: ReturnType<typeof parseCIF>;
  private _loadAllModels: boolean;

  constructor(doc: ReturnType<typeof parseCIF>, options: CifOptions) {
    this._doc = doc;
    this._loadAllModels = !!options.loadAllModels;
  }

  read(): Mol | (Mol | null)[] | undefined {
    const atomRows = this._doc.loopRows('atom_site');
    if (atomRows.length === 0) {
      return undefined;
    }
    const modelNums = this._collectModelNumbers(atomRows);
    if (!this._loadAllModels) {
      return this._buildModel(atomRows, modelNums[0]!) ?? undefined;
    }
    return modelNums.map((modelNum) => this._buildModel(atomRows, modelNum));
  }

  private _collectModelNumbers(rows: CIFRow[]): (number | null)[] {
    const order: (number | null)[] = [];
    for (let i = 0; i < rows.length; ++i) {
      const modelNum = rows[i]!.getNumber('pdbx_pdb_model_num') ?? null;
      if (order.indexOf(modelNum) === -1) {
        order.push(modelNum);
      }
    }
    return order;
  }

  private _buildModel(rows: CIFRow[], modelNum: number | null): Mol | null {
    const structure = new Mol();
    let currChain: Chain | null = null;
    let currChainName: string | null = null;
    let currRes: Residue | null = null;
    let currResKey: string | null = null;
    let hetCounter = 0;
    let sawAtom = false;

    for (let i = 0; i < rows.length; ++i) {
      const row = rows[i]!;
      const rowModelNum = row.getNumber('pdbx_pdb_model_num') ?? null;
      if (rowModelNum !== modelNum) {
        continue;
      }
      const altId = row.get('label_alt_id');
      if (altId !== undefined && altId !== '.' && altId !== 'A') {
        continue;
      }
      const chainName = row.get('label_asym_id');
      if (chainName === undefined) {
        continue;
      }
      const compId = row.get('label_comp_id') || '';
      const seqIdRaw = row.get('label_seq_id');
      const isHetSeq = seqIdRaw === undefined || seqIdRaw === '.';

      const updateChain = currChainName !== chainName;
      if (updateChain) {
        currChain = structure.chain(chainName) || structure.addChain(chainName);
        currChainName = chainName;
        currResKey = null;
        hetCounter = 0;
      }
      const resKey = isHetSeq ? ('het:' + compId) : ('seq:' + seqIdRaw);
      if (updateChain || currResKey !== resKey) {
        let resNum: number;
        if (isHetSeq) {
          hetCounter += 1;
          resNum = hetCounter;
        } else {
          resNum = parseInt(seqIdRaw!, 10);
          if (isNaN(resNum)) {
            resNum = 1;
          }
        }
        currRes = currChain!.addResidue(compId, resNum);
        currResKey = resKey;
      }

      const pos = vec3.create();
      pos[0] = row.getNumber('cartn_x') ?? 0;
      pos[1] = row.getNumber('cartn_y') ?? 0;
      pos[2] = row.getNumber('cartn_z') ?? 0;
      const element = row.get('type_symbol') || '';
      const atomName = row.get('label_atom_id') || '';
      const isHetatm = row.get('group_pdb') === 'HETATM';
      const occupancy = row.getNumber('occupancy');
      const tempFactor = row.getNumber('b_iso_or_equiv');
      const serial = row.getNumber('id');
      currRes!.addAtom(atomName, pos, element, isHetatm, occupancy, tempFactor, serial);
      sawAtom = true;
    }

    if (!sawAtom) {
      return null;
    }
    this._assignSecondaryStructure(structure);
    this._assignAssemblies(structure);
    structure.deriveConnectivity();
    console.log('imported', structure.chains().length, 'chain(s),',
                structure.residueCount(), 'residue(s)');
    return structure;
  }

  private _assignSecondaryStructure(structure: Mol): void {
    const helixRows = this._doc.loopRows('struct_conf');
    for (let i = 0; i < helixRows.length; ++i) {
      const row = helixRows[i]!;
      const confType = row.get('conf_type_id');
      if (confType === undefined || confType.toUpperCase().indexOf('HELX') !== 0) {
        continue;
      }
      this._applySSRange(structure, row, 'H');
    }
    const sheetRows = this._doc.loopRows('struct_sheet_range');
    for (let i = 0; i < sheetRows.length; ++i) {
      this._applySSRange(structure, sheetRows[i]!, 'E');
    }
  }

  private _applySSRange(structure: Mol, row: CIFRow, ss: string): void {
    const chainName = row.get('beg_label_asym_id');
    const begNum = row.getNumber('beg_label_seq_id');
    const endNum = row.getNumber('end_label_seq_id');
    if (chainName === undefined || begNum === undefined || endNum === undefined) {
      return;
    }
    const chain = structure.chain(chainName);
    if (chain === null) {
      return;
    }
    chain.assignSS([begNum, '\0'], [endNum, '\0'], ss);
  }

  private _assignAssemblies(structure: Mol): void {
    const operRows = this._doc.loopRows('pdbx_struct_oper_list');
    if (operRows.length === 0) {
      return;
    }
    const operators = new Map<string, mat4>();
    for (let i = 0; i < operRows.length; ++i) {
      const id = operRows[i]!.get('id');
      if (id !== undefined) {
        operators.set(id, operatorMatrixFromRow(operRows[i]!));
      }
    }
    const genRows = this._doc.loopRows('pdbx_struct_assembly_gen');
    const assemblies = new Map<string, Assembly>();
    for (let i = 0; i < genRows.length; ++i) {
      const row = genRows[i]!;
      const assemblyId = row.get('assembly_id');
      const asymIdList = row.get('asym_id_list');
      const operExpression = row.get('oper_expression');
      if (assemblyId === undefined || asymIdList === undefined || operExpression === undefined) {
        continue;
      }
      const chainNames = asymIdList.split(',').map(function(s) { return s.trim(); })
          .filter(function(s) { return s.length > 0; });
      const matrices = composeOperExpression(operExpression, operators);
      if (matrices.length === 0) {
        continue;
      }
      let assembly = assemblies.get(assemblyId);
      if (assembly === undefined) {
        assembly = new symmetry.Assembly(assemblyId);
        assemblies.set(assemblyId, assembly);
      }
      assembly.addGenerator(new symmetry.SymGenerator(chainNames, matrices));
    }
    if (assemblies.size > 0) {
      structure.setAssemblies(Array.from(assemblies.values()));
    }
  }
}

// reads a structure from mmCIF text. Uses mmCIF's label_* identifiers
// (label_asym_id/label_seq_id/label_atom_id/label_comp_id) to build chains/
// residues/atoms, not auth_* -- see src/cif.ts for the underlying tokenizer.
function cif(text: string, options?: CifOptions): Mol | (Mol | null)[] | undefined {
  console.time('cif');
  const doc = parseCIF(text);
  const reader = new CIFReader(doc, options || {});
  const result = reader.read();
  console.timeEnd('cif');
  return result;
}


function fetch(url: string, callback: (data: string) => void): void {
  const oReq = new XMLHttpRequest();
  oReq.open("GET", url, true);
  oReq.onload = function() {
    if (oReq.response) {
      callback(oReq.response);
    }
  };
  oReq.send(null);
}

function fetchPdb(
  url: string, callback: (structure: Mol | (Mol | null)[] | undefined) => void, options?: PdbOptions
): void {
  fetch(url, function(data) {
    const structure = pdb(data, options);
    callback(structure);
  });
}

function fetchSdf(url: string, callback: (structure: Mol | null) => void): void {
  fetch(url, function(data) {
    const structure = sdf(data);
    callback(structure);
  });
}

function fetchCrd(url: string, callback: (structure: Mol) => void): void {
  fetch(url, function(data) {
    const structure = crd(data);
    callback(structure);
  });
}

function fetchCif(
  url: string, callback: (structure: Mol | (Mol | null)[] | undefined) => void, options?: CifOptions
): void {
  fetch(url, function(data) {
    const structure = cif(data, options);
    callback(structure);
  });
}

export default {
  pdb : pdb,
  sdf : sdf,
  crd : crd,
  cif : cif,
  Remark350Reader : Remark350Reader,
  fetchPdb : fetchPdb,
  fetchSdf : fetchSdf,
  fetchCrd : fetchCrd,
  fetchCif : fetchCif,
  guessAtomElementFromName : guessAtomElementFromName
};
