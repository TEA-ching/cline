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
import { createTool } from '@cline/agents'
import { z } from 'zod'
import type { AgentTool } from '@cline/agents'
import type { VirtualFS } from '@/vfs/virtual-fs'
import { runPython } from '../python-sandbox'

interface PythonToolContext {
  vfs?: VirtualFS
  onFileCreated?: (path: string, content: string) => void
  onAskQuestion?: (question: string, options: string[]) => Promise<string>
}

export function createPythonTool(ctx?: PythonToolContext): AgentTool<any, any> {
  return createTool({
    name: 'execute_python_code',
    description:
      'Execute Python code in a Pyodide WASM sandbox (Python 3.14, Emscripten platform). ' +
      'First invocation downloads ~7 MB; subsequent calls reuse the cached runtime. ' +
      '\n\nPACKAGES: Scientific packages are NOT loaded by default — pass their names in the "packages" field (e.g. ["numpy", "pandas"]). ' +
      'micropip is also a loadable package but cannot install arbitrary PyPI packages; use the "packages" field instead. ' +
      '\n\nVFS (virtual filesystem): share files between tool calls via "import vfs" — ' +
      'vfs.read(path) → str|bytes|None, vfs.write(path, content), vfs.list(prefix?), vfs.delete(path), vfs.exists(path). ' +
      'Binary files are stored and returned as bytes transparently. ' +
      '\n\nNETWORK: blocked by default. Set allow_network=true to enable. When allowed: ' +
      '(1) urllib.request.urlopen() works synchronously for HTTP and HTTPS — preferred for simple GET/POST. ' +
      '(2) requests and httpx work if loaded via the "packages" field. ' +
      '(3) pyodide.http.open_url(url) works synchronously and returns a StringIO object — use .read() (no .decode() needed). ' +
      '(4) pyodide.http.pyfetch(url) is async — requires "await" and must be called inside an async function or at top level with runPythonAsync semantics. ' +
      'Raw socket calls (socket.socket) and ssl.wrap_socket are NOT supported in WASM. ' +
      'socket.gethostbyname() resolves DNS but the returned IP is emulated and cannot be used for TCP connections. ' +
      'Full list of loadable packages with micropip:' +
      '\n\tastropy_iers_data, asttokens, async-timeout, atomicwrites, attrs, audioop-lts, awkward-cpp, b2d, bcrypt, beautifulsoup4,'+
      '\n\tbilby.cython, biopython, bitarray, bitstring, bleach, blosc2, bokeh, boost-histogram, Bottleneck, brotli, cachetools,' + 
      '\n\tCartopy, casadi, cbor-diag, certifi, cffi, cffi_example, cftime, charset-normalizer, clarabel, click, cligj, clingo,' + 
      '\n\tcloudpickle, cmyt, cobs, colorspacious, contourpy, coolprop, coverage, crc32c, crcmod, cryptography, cssselect, cvxpy-base,' + 
      '\n\tcycler, cysignals, cytoolz, decorator, demes, deprecated, deprecation, diskcache, distlib, distro, dnspython, docutils,' + 
      '\n\tdonfig, duckdb, ewah_bool_utils, exceptiongroup, executing, fastapi, fastcan, fiona, fonttools, freesasa, frozenlist, fsspec,' + 
      '\n\tfuture, galpy, geopandas, gmpy2, google-crc32c, gsw, h11, h3, h5py, highspy, html5lib, httpcore, httpx, idna, igraph, imageio,' + 
      '\n\timinuit, iniconfig, ipython, jedi, Jinja2, jiter, joblib, jsonpatch, jsonpointer, jsonschema, jsonschema_specifications,' + 
      '\n\tkiwisolver, lakers-python, lazy_loader, lazy-object-proxy, libcst, librt, lightgbm, logbook, lxml, lz4, MarkupSafe, matplotlib,' + 
      '\n\tmatplotlib-inline, memory-allocator, micropip, ml_dtypes, mmh3, more-itertools, mpmath, msgpack, msgspec, msprime, multidict,' + 
      '\n\tmunch, mypy, narwhals, ndindex, netcdf4, networkx, newick, nh3, nlopt, nltk, numcodecs, numpy, openai, opencv-python, optlang,' + 
      '\n\torjson, packaging, pandas, parso, patsy, pcodec, peewee, phispy, pi-heif, Pillow, pillow-heif, pkgconfig, platformdirs,' + 
      '\n\tpluggy, ply, polars, prompt_toolkit, propcache, protobuf, pure-eval, py, pyarrow, pyclipper, pycparser, pycryptodome, pydantic,' + 
      '\n\tpydantic_core, pydoc_data, pyerfa, pygame-ce, Pygments, pyheif, pyiceberg, pyinstrument, pymongo, PyMuPDF, pynacl, pyodide-http,' + 
      '\n\tpyodide-unix-timezones, pyparsing, pyproj, pyroaring, pyrodigal, pyrsistent, pysam, pyshp, pytaglib, pytest, pytest-asyncio,' + 
      '\n\tpytest-benchmark, pytest_httpx, python-calamine, python-dateutil, python-flint, python-flirt, python-sat, python-solvespace,' + 
      '\n\tpytz, pywavelets, pyxirr, pyyaml, rasterio, rateslib, rebound, reboundx, referencing, regex, requests, retrying, rich,' + 
      '\n\tRobotRaconteur, rpds-py, ruamel.yaml, safetensors, scikit-image, scikit-learn, scipy, screed, sentencepiece, setuptools,' + 
      '\n\tshapely, simplejson, sisl, six, smart-open, sniffio, sortedcontainers, soundfile, soupsieve, sourmash, soxr, sparseqr,' + 
      '\n\tsqlalchemy, stack-data, starlette, statsmodels, strictyaml, svgwrite, swiglpk, sympy, tblib, termcolor, texttable,' + 
      '\n\ttexture2ddecoder, threadpoolctl, tiktoken, tomli, tomli-w, toolz, tqdm, traitlets, traits, tree-sitter, tree-sitter-go,' + 
      '\n\ttree-sitter-java, tree-sitter-python, tskit, typing-extensions, typing-inspection, tzdata, ujson, uncertainties, unyt, urllib3,' + 
      '\n\tvega-datasets, vrplib, wcwidth, webencodings, wordcloud, wrapt, xarray, xgboost, xlrd, xxhash, xyzservices, yarl, yt, zarr,' + 
      '\n\tzengl, zfpy, zstandard',
    inputSchema: z.object({
      code: z.string().describe('Python code to execute'),
      packages: z.array(z.string()).optional().default([])
        .describe('Pyodide packages to load before running (e.g. ["numpy", "pandas", "sympy"])'),
      allow_network: z.boolean().optional().default(false)
        .describe('Request user permission to allow network access from Python code'),
    }),
    timeoutMs: 120_000,
    execute: async ({ code, packages, allow_network }) => {
      const result = await runPython(code, packages ?? [], allow_network ?? false, ctx?.vfs, ctx?.onAskQuestion)
      if (ctx?.onFileCreated && ctx.vfs) {
        for (const path of result.filesWritten) {
          const content = ctx.vfs.read(path)
          if (content !== null) ctx.onFileCreated(path, content)
        }
      }
      return result
    },
  })
}
