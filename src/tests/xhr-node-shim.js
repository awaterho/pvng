// Minimal XMLHttpRequest shim so io.js's fetch()-via-XHR helpers work
// under Vitest's Node test environment. Only supports what io.js actually
// uses: GET requests resolved against the repo root and read from disk
// (test fixtures live under pdbs/), reporting back through .response and
// firing onload asynchronously like a real XHR would.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

class NodeXMLHttpRequest {
  open(method, url) {
    this._url = url;
  }

  send() {
    const relativePath = this._url.replace(/^\/+/, '');
    const filePath = path.join(repoRoot, relativePath);
    setTimeout(() => {
      try {
        this.response = fs.readFileSync(filePath, 'utf8');
        this.responseText = this.response;
        if (this.onload) this.onload();
      } catch (err) {
        if (this.onerror) this.onerror(err);
      }
    }, 0);
  }
}

globalThis.XMLHttpRequest = NodeXMLHttpRequest;
