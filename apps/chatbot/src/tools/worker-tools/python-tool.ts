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
      'Execute Python code in a Pyodide WASM sandbox. ' +
      'Supports scientific packages available in Pyodide (numpy, pandas, sympy, scipy, etc.). ' +
      'VFS access is available via "import vfs; vfs.read(path), vfs.write(path, content), vfs.list(), vfs.delete(path), vfs.exists(path)". ' +
      'Network access (urllib, requests, httpx) is blocked by default; set allow_network=true to request user permission. ' +
      'First invocation downloads ~7 MB and requires user consent. Subsequent calls reuse the cached runtime.' +
      'Full list of included packages: astropy_iers_data, asttokens, async-timeout, atomicwrites, attrs, audioop-lts, awkward-cpp, b2d, bcrypt, beautifulsoup4, bilby.cython, biopython, bitarray, bitstring, bleach, blosc2, bokeh, boost-histogram, Bottleneck, brotli, cachetools, Cartopy, casadi, cbor-diag, certifi, cffi, cffi_example, cftime, charset-normalizer, clarabel, click, cligj, clingo, cloudpickle, cmyt, cobs, colorspacious, contourpy, coolprop, coverage, crc32c, crcmod, cryptography, cssselect, cvxpy-base, cycler, cysignals, cytoolz, decorator, demes, deprecated, deprecation, diskcache, distlib, distro, dnspython, docutils, donfig, duckdb, ewah_bool_utils, exceptiongroup, executing, fastapi, fastcan, fiona, fonttools, freesasa, frozenlist, fsspec, future, galpy, geopandas, gmpy2, google-crc32c, gsw, h11, h3, h5py, highspy, html5lib, httpcore, httpx, idna, igraph, imageio, iminuit, iniconfig, ipython, jedi, Jinja2, jiter, joblib, jsonpatch, jsonpointer, jsonschema, jsonschema_specifications, kiwisolver, lakers-python, lazy_loader, lazy-object-proxy, libcst, librt, lightgbm, logbook, lxml, lz4, MarkupSafe, matplotlib, matplotlib-inline, memory-allocator, micropip, ml_dtypes, mmh3, more-itertools, mpmath, msgpack, msgspec, msprime, multidict, munch, mypy, narwhals, ndindex, netcdf4, networkx, newick, nh3, nlopt, nltk, numcodecs, numpy, openai, opencv-python, optlang, orjson, packaging, pandas, parso, patsy, pcodec, peewee, phispy, pi-heif, Pillow, pillow-heif, pkgconfig, platformdirs, pluggy, ply, polars, prompt_toolkit, propcache, protobuf, pure-eval, py, pyarrow, pyclipper, pycparser, pycryptodome, pydantic, pydantic_core, pydoc_data, pyerfa, pygame-ce, Pygments, pyheif, pyiceberg, pyinstrument, pymongo, PyMuPDF, pynacl, pyodide-http, pyodide-unix-timezones, pyparsing, pyproj, pyroaring, pyrodigal, pyrsistent, pysam, pyshp, pytaglib, pytest, pytest-asyncio, pytest-benchmark, pytest_httpx, python-calamine, python-dateutil, python-flint, python-flirt, python-sat, python-solvespace, pytz, pywavelets, pyxirr, pyyaml, rasterio, rateslib, rebound, reboundx, referencing, regex, requests, retrying, rich, RobotRaconteur, rpds-py, ruamel.yaml, safetensors, scikit-image, scikit-learn, scipy, screed, sentencepiece, setuptools, shapely, simplejson, sisl, six, smart-open, sniffio, sortedcontainers, soundfile, soupsieve, sourmash, soxr, sparseqr, sqlalchemy, stack-data, starlette, statsmodels, strictyaml, svgwrite, swiglpk, sympy, tblib, termcolor, texttable, texture2ddecoder, threadpoolctl, tiktoken, tomli, tomli-w, toolz, tqdm, traitlets, traits, tree-sitter, tree-sitter-go, tree-sitter-java, tree-sitter-python, tskit, typing-extensions, typing-inspection, tzdata, ujson, uncertainties, unyt, urllib3, vega-datasets, vrplib, wcwidth, webencodings, wordcloud, wrapt, xarray, xgboost, xlrd, xxhash, xyzservices, yarl, yt, zarr, zengl, zfpy, zstandard',
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
