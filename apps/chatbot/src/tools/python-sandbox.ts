/*
 * MIT License
 *
 * Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { VirtualFS } from '@/vfs/virtual-fs'

// CDN used only for package wheels (numpy, pandas…) — the core WASM is served locally.
const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v314.0.0/full/'

export interface PythonSandboxResult {
  output: string
  error?: string
  filesWritten: string[]
}

// biome-ignore lint/suspicious/noExplicitAny: Pyodide types are dynamic
type PyodideInterface = any

// Resolve the local indexURL from the worker's origin so that pyodide.asm.wasm,
// python_stdlib.zip, and pyodide-lock.json are served from the Vite asset pipeline
// instead of the CDN.
function getLocalIndexURL(): string {
  return `${globalThis.location.origin}/pyodide/`
}

// Singleton per worker session — avoids re-loading ~12 MB on every call.
let pyodidePromise: Promise<PyodideInterface> | null = null

async function loadPyodideOnce(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    const { loadPyodide } = await import('pyodide')
    pyodidePromise = loadPyodide({ indexURL: getLocalIndexURL() })
  }
  return pyodidePromise
}

// Load requested packages by reading the locally-served lock file and constructing
// explicit CDN URLs for the wheel files (which are not included in the npm package).
// biome-ignore lint/suspicious/noExplicitAny: lock file shape is untyped JSON
async function loadPackagesFromCDN(pyodide: PyodideInterface, packages: string[]): Promise<void> {
  if (!packages.length) return
  const indexURL = getLocalIndexURL()
  const lock: { packages: Record<string, { file_name: string }> } =
    await fetch(`${indexURL}pyodide-lock.json`).then(r => r.json())
  for (const pkg of packages) {
    const info = lock.packages[pkg]
    if (!info) {
      throw new Error(`Package "${pkg}" not found in pyodide-lock.json v314.0.0. Check the package name or use micropip for PyPI packages.`)
    }
    await pyodide.loadPackage([`${PYODIDE_CDN}${info.file_name}`])
  }
}

const BINARY_DATA_PREFIX = 'data:application/octet-stream;base64,'

// Python bytes/bytearray arrive as a Pyodide PyProxy. Convert to a plain base64
// data-URL string so the VFS (string-only) and postMessage (structured clone) can
// handle the content without errors.
// biome-ignore lint/suspicious/noExplicitAny: Pyodide PyProxy is untyped
function encodeVfsContent(raw: unknown): string {
  if (typeof raw === 'string') return raw
  // biome-ignore lint/suspicious/noExplicitAny: PyProxy.toJs() returns JS value
  const js = (raw as any)?.toJs?.() ?? raw
  let arr: Uint8Array | null = null
  if (js instanceof Uint8Array) arr = js
  else if (js instanceof ArrayBuffer) arr = new Uint8Array(js)
  if (arr) {
    // btoa on large buffers: build the binary string in chunks to avoid stack overflows.
    let binary = ''
    const chunkSize = 8192
    for (let i = 0; i < arr.length; i += chunkSize) {
      binary += String.fromCharCode(...arr.subarray(i, i + chunkSize))
    }
    return BINARY_DATA_PREFIX + btoa(binary)
  }
  return String(raw)
}

function injectVfsBridge(pyodide: PyodideInterface, vfs: VirtualFS, filesWritten: string[]): void {
  pyodide.globals.set('_vfs_read', (path: string): string | null => vfs.read(path))
  pyodide.globals.set('_vfs_write', (path: string, content: unknown): void => {
    vfs.write(path, encodeVfsContent(content))
    filesWritten.push(path)
  })
  pyodide.globals.set('_vfs_list', (prefix?: string): string[] => vfs.list(prefix ?? undefined))
  pyodide.globals.set('_vfs_delete', (path: string): boolean => vfs.delete(path))
  pyodide.globals.set('_vfs_exists', (path: string): boolean => vfs.read(path) !== null)

  // Install a vfs Python module. Binary files are stored as base64 data URLs;
  // vfs.read() decodes them back to bytes transparently so round-trips work.
  pyodide.runPython(`
import sys, types as _types, base64 as _b64

_BINARY_PREFIX = '${BINARY_DATA_PREFIX}'

def _vfs_smart_read(path):
    raw = _vfs_read(path)
    if raw is None:
        return None
    s = str(raw)
    if s.startswith(_BINARY_PREFIX):
        return _b64.b64decode(s[len(_BINARY_PREFIX):])
    return s

_vfs_mod = _types.ModuleType('vfs')
_vfs_mod.read   = _vfs_smart_read
_vfs_mod.write  = lambda path, content: _vfs_write(path, content)
_vfs_mod.list   = lambda prefix=None: list(_vfs_list(prefix))
_vfs_mod.delete = lambda path: _vfs_delete(path)
_vfs_mod.exists = lambda path: _vfs_exists(path)
sys.modules['vfs'] = _vfs_mod
del _vfs_mod, _types, _b64, _vfs_smart_read, _BINARY_PREFIX
`)
}

function installNetworkBlocker(pyodide: PyodideInterface): void {
  pyodide.runPython(`
import sys

class _NetworkDisabled(Exception):
    pass

try:
    import urllib.request as _ur
    def _blocked_urlopen(*a, **kw):
        raise _NetworkDisabled(
            "Network access is disabled. Pass allow_network=true to the tool."
        )
    _ur.urlopen = _blocked_urlopen
except Exception:
    pass

try:
    import socket as _sock
    def _blocked_connect(self, *a, **kw):
        raise _NetworkDisabled(
            "Network access is disabled. Pass allow_network=true to the tool."
        )
    _sock.socket.connect = _blocked_connect
except Exception:
    pass
`)
}

export async function runPython(
  code: string,
  packages: string[],
  allowNetwork: boolean,
  vfs?: VirtualFS,
  onAskQuestion?: (q: string, opts: string[]) => Promise<string>,
): Promise<PythonSandboxResult> {
  let pyodide: PyodideInterface
  try {
    pyodide = await loadPyodideOnce()
  } catch (err) {
    return { output: '', error: `Failed to initialize Python runtime: ${err instanceof Error ? err.message : String(err)}`, filesWritten: [] }
  }

  if (allowNetwork && onAskQuestion) {
    const answer = await onAskQuestion(
      'This Python code is requesting network access (urllib, requests, etc.). Authorize?',
      ['Yes', 'No'],
    )
    if (answer !== 'Yes') {
      return { output: '', error: 'Network access refused by user.', filesWritten: [] }
    }
  }

  const filesWritten: string[] = []

  if (vfs) injectVfsBridge(pyodide, vfs, filesWritten)

  try {
    await loadPackagesFromCDN(pyodide, packages)
  } catch (err) {
    return {
      output: '',
      error: err instanceof Error ? err.message : String(err),
      filesWritten,
    }
  }

  if (!allowNetwork) installNetworkBlocker(pyodide)

  // Redirect stdout/stderr and execute
  pyodide.runPython(`
import sys
from io import StringIO as _StringIO
_capture = _StringIO()
sys.stdout = _capture
sys.stderr = _capture
`)

  let output = ''
  let error: string | undefined

  try {
    await pyodide.runPythonAsync(code)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  try {
    output = pyodide.runPython('_capture.getvalue()') as string
  } catch {
    // ignore — capture may have failed if there was a very early error
  }

  // Restore stdout/stderr for next run
  try {
    pyodide.runPython('sys.stdout = sys.__stdout__; sys.stderr = sys.__stderr__')
  } catch {
    // ignore
  }

  return { output: output || (error ? '' : '(no output)'), error, filesWritten }
}
