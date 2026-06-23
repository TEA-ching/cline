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

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/'

export interface PythonSandboxResult {
  output: string
  error?: string
  filesWritten: string[]
}

// biome-ignore lint/suspicious/noExplicitAny: Pyodide types are dynamic
type PyodideInterface = any

// Singleton per worker session — avoids re-downloading ~7 MB on every call.
let pyodidePromise: Promise<PyodideInterface> | null = null
// Tracks whether the user already approved network access for Python code this session.
let networkPermissionGranted = false

async function loadPyodideOnce(
  onAskQuestion: (q: string, opts: string[]) => Promise<string>,
): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    const answer = await onAskQuestion(
      `Pyodide (Python WASM) requires downloading ~7 MB from ${PYODIDE_CDN}. Authorize?`,
      ['Yes', 'No'],
    )
    if (answer !== 'Yes') throw new Error('Pyodide load refused by user.')

    const { loadPyodide } = await import('pyodide')
    pyodidePromise = loadPyodide({ indexURL: PYODIDE_CDN })
  }
  return pyodidePromise
}

function injectVfsBridge(pyodide: PyodideInterface, vfs: VirtualFS, filesWritten: string[]): void {
  pyodide.globals.set('_vfs_read', (path: string): string | null => vfs.read(path))
  pyodide.globals.set('_vfs_write', (path: string, content: string): void => {
    vfs.write(path, content)
    filesWritten.push(path)
  })
  pyodide.globals.set('_vfs_list', (prefix?: string): string[] => vfs.list(prefix ?? undefined))
  pyodide.globals.set('_vfs_delete', (path: string): boolean => vfs.delete(path))
  pyodide.globals.set('_vfs_exists', (path: string): boolean => vfs.read(path) !== null)

  // Install a minimal VFS module so Python code can do: from vfs import read, write, …
  pyodide.runPython(`
import sys, types as _types

_vfs_mod = _types.ModuleType('vfs')
_vfs_mod.read   = lambda path: _vfs_read(path)
_vfs_mod.write  = lambda path, content: _vfs_write(path, content)
_vfs_mod.list   = lambda prefix=None: list(_vfs_list(prefix))
_vfs_mod.delete = lambda path: _vfs_delete(path)
_vfs_mod.exists = lambda path: _vfs_exists(path)
sys.modules['vfs'] = _vfs_mod
del _vfs_mod, _types
`)
}

function installNetworkBlocker(pyodide: PyodideInterface): void {
  // Monkey-patch Python's network primitives so they raise a clear error.
  pyodide.runPython(`
import sys

class _NetworkDisabled(Exception):
    pass

try:
    import urllib.request as _ur
    _original_urlopen = _ur.urlopen
    def _blocked_urlopen(*a, **kw):
        raise _NetworkDisabled(
            "Network access is disabled. Pass allow_network=true to the tool."
        )
    _ur.urlopen = _blocked_urlopen
except Exception:
    pass

try:
    import socket as _sock
    _original_socket_connect = _sock.socket.connect
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
  if (!onAskQuestion) {
    return { output: '', error: 'Python sandbox requires interactive permission — onAskQuestion not available.', filesWritten: [] }
  }

  let pyodide: PyodideInterface
  try {
    pyodide = await loadPyodideOnce(onAskQuestion)
  } catch (err) {
    return { output: '', error: err instanceof Error ? err.message : String(err), filesWritten: [] }
  }

  if (allowNetwork && !networkPermissionGranted) {
    const answer = await onAskQuestion(
      'This Python code is requesting network access (urllib, requests, etc.). Authorize?',
      ['Yes', 'No'],
    )
    if (answer !== 'Yes') {
      return { output: '', error: 'Network access refused by user.', filesWritten: [] }
    }
    networkPermissionGranted = true
  }

  const filesWritten: string[] = []

  if (vfs) injectVfsBridge(pyodide, vfs, filesWritten)

  // Load requested packages (Pyodide bundled wheels)
  for (const pkg of packages) {
    try {
      await pyodide.loadPackage(pkg)
    } catch (err) {
      return {
        output: '',
        error: `Failed to load package "${pkg}": ${err instanceof Error ? err.message : String(err)}`,
        filesWritten,
      }
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
