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

// A small, dependency-free mmCIF/STAR tokenizer and document model. This
// module only knows about CIF *syntax* (loop_ tables, quoted/unquoted
// values, ;-delimited multi-line text fields); it has no notion of what an
// _atom_site or _pdbx_struct_assembly_gen row means -- that's io.ts's job.
//
// CIF tags are case-insensitive per spec, so category and item names are
// normalized to lowercase everywhere in this module's API: callers must
// query with lowercase category/item names (e.g. `getValue('cell', 'length_a')`,
// `row.get('cartn_x')`), regardless of how the source file capitalized them.

type TokenType = 'tag' | 'value' | 'loop' | 'data';

interface Token {
  type: TokenType;
  text: string;
}

// splits the raw text into a flat stream of tokens. Flat, rather than
// line-by-line, because loop_ values may wrap across lines and ;-delimited
// text fields are inherently multi-line -- neither can be parsed assuming
// one row per line.
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const n = text.length;
  let i = 0;

  function atLineStart(pos: number): boolean {
    return pos === 0 || text[pos - 1] === '\n';
  }

  while (i < n) {
    const c = text[i]!;

    // whitespace
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }

    // comment: runs to end of line
    if (c === '#') {
      while (i < n && text[i] !== '\n') {
        i++;
      }
      continue;
    }

    // ;-delimited multi-line text field: only recognized at the start of a
    // line (a ';' elsewhere is just a regular character in a bare value).
    if (c === ';' && atLineStart(i)) {
      let end = i + 1;
      let value = '';
      for (;;) {
        const lineEnd = text.indexOf('\n', end);
        const line = lineEnd === -1 ? text.substring(end) : text.substring(end, lineEnd);
        if (line.startsWith(';')) {
          // terminator line: everything after the leading ';' is discarded
          // per the CIF spec (it's only ever whitespace in practice).
          i = lineEnd === -1 ? n : lineEnd + 1;
          break;
        }
        value += (value.length ? '\n' : '') + line;
        if (lineEnd === -1) {
          i = n;
          break;
        }
        end = lineEnd + 1;
      }
      tokens.push({ type: 'value', text: value });
      continue;
    }

    // quoted value: closed by the same quote character followed by
    // whitespace/EOL/EOF -- this is what allows unquoted atom names like
    // O5' to coexist with quoted values like "O5' water".
    if (c === '\'' || c === '"') {
      const quote = c;
      let j = i + 1;
      for (;;) {
        const close = text.indexOf(quote, j);
        if (close === -1) {
          j = n;
          break;
        }
        const after = text[close + 1];
        if (after === undefined || after === ' ' || after === '\t' ||
            after === '\r' || after === '\n') {
          j = close;
          break;
        }
        j = close + 1;
      }
      tokens.push({ type: 'value', text: text.substring(i + 1, j) });
      i = j + 1;
      continue;
    }

    // bare token: runs to the next whitespace character.
    let j = i;
    while (j < n) {
      const cj = text[j]!;
      if (cj === ' ' || cj === '\t' || cj === '\r' || cj === '\n') {
        break;
      }
      j++;
    }
    const word = text.substring(i, j);
    i = j;

    const lower = word.toLowerCase();
    if (lower === 'loop_') {
      tokens.push({ type: 'loop', text: word });
    } else if (lower.startsWith('data_')) {
      tokens.push({ type: 'data', text: word });
    } else if (word[0] === '_') {
      tokens.push({ type: 'tag', text: word });
    } else {
      tokens.push({ type: 'value', text: word });
    }
  }
  return tokens;
}

function splitTag(tag: string): [category: string, item: string] {
  const dot = tag.indexOf('.');
  if (dot === -1) {
    return [tag.substring(1).toLowerCase(), ''];
  }
  return [tag.substring(1, dot).toLowerCase(), tag.substring(dot + 1).toLowerCase()];
}

export interface CIFRow {
  // returns the raw column value, or undefined if the column doesn't exist
  // in this loop. Note this returns CIF's literal '.' (inapplicable) and
  // '?' (unknown) placeholders as-is -- their meaning is field-specific, so
  // interpreting them is left to the caller.
  get(item: string): string | undefined;
  // like get(), but parses the value as a float; returns undefined for a
  // missing column, '.', '?', or anything else that doesn't parse.
  getNumber(item: string): number | undefined;
}

class Loop {
  private _columnIndex: Map<string, number>;
  private _rows: string[][];

  constructor(columns: string[], rows: string[][]) {
    this._columnIndex = new Map();
    for (let i = 0; i < columns.length; ++i) {
      this._columnIndex.set(columns[i]!, i);
    }
    this._rows = rows;
  }

  get length(): number {
    return this._rows.length;
  }

  row(index: number): CIFRow {
    const values = this._rows[index]!;
    const columnIndex = this._columnIndex;
    return {
      get(item: string): string | undefined {
        const idx = columnIndex.get(item);
        return idx === undefined ? undefined : values[idx];
      },
      getNumber(item: string): number | undefined {
        const idx = columnIndex.get(item);
        if (idx === undefined) {
          return undefined;
        }
        const raw = values[idx]!;
        if (raw === '.' || raw === '?') {
          return undefined;
        }
        const num = parseFloat(raw);
        return isNaN(num) ? undefined : num;
      },
    };
  }
}

export interface CIFDocument {
  // returns the single value associated with `_category.item`, or
  // undefined if no such key-value pair (or loop column) exists.
  getValue(category: string, item: string): string | undefined;
  // returns every row of the `_category.*` table, or an empty array if the
  // document has no such category. A category written as key-value pairs
  // rather than a loop is a table with a single row (mmCIF does this e.g. for
  // entries with only one assembly or one helix).
  loopRows(category: string): CIFRow[];
}

export function parseCIF(text: string): CIFDocument {
  const tokens = tokenize(text);
  const loops = new Map<string, Loop>();
  const values = new Map<string, string>();
  // key-value pairs grouped by category, exposed as single row tables
  const pairs = new Map<string, { columns: string[]; row: string[] }>();

  let i = 0;
  const n = tokens.length;
  while (i < n) {
    const token = tokens[i]!;
    if (token.type === 'data') {
      i++;
      continue;
    }
    if (token.type === 'loop') {
      i++;
      const columns: string[] = [];
      let category: string | null = null;
      while (i < n && tokens[i]!.type === 'tag') {
        const [cat, item] = splitTag(tokens[i]!.text);
        if (category === null) {
          category = cat;
        }
        columns.push(item);
        i++;
      }
      const rows: string[][] = [];
      let row: string[] = [];
      while (i < n && tokens[i]!.type === 'value') {
        row.push(tokens[i]!.text);
        i++;
        if (row.length === columns.length) {
          rows.push(row);
          row = [];
        }
      }
      if (category !== null && columns.length > 0) {
        loops.set(category, new Loop(columns, rows));
      }
      continue;
    }
    if (token.type === 'tag') {
      const [category, item] = splitTag(token.text);
      i++;
      if (i < n && tokens[i]!.type === 'value') {
        values.set(category + '.' + item, tokens[i]!.text);
        let entry = pairs.get(category);
        if (entry === undefined) {
          entry = { columns: [], row: [] };
          pairs.set(category, entry);
        }
        entry.columns.push(item);
        entry.row.push(tokens[i]!.text);
        i++;
      }
      continue;
    }
    // stray value token outside of a loop/tag context: skip it.
    i++;
  }

  pairs.forEach(function(entry, category) {
    if (!loops.has(category)) {
      loops.set(category, new Loop(entry.columns, [entry.row]));
    }
  });

  return {
    getValue(category: string, item: string): string | undefined {
      return values.get(category.toLowerCase() + '.' + item.toLowerCase());
    },
    loopRows(category: string): CIFRow[] {
      const loop = loops.get(category.toLowerCase());
      if (loop === undefined) {
        return [];
      }
      const result: CIFRow[] = [];
      for (let r = 0; r < loop.length; ++r) {
        result.push(loop.row(r));
      }
      return result;
    },
  };
}
