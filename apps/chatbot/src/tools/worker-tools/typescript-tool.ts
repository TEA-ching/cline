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
import { createTool } from '@sctg/cline-agents'
import { z } from 'zod'
import type { AgentTool } from '@sctg/cline-agents'
import type * as TypeScript from 'typescript'

export function createTypescriptTool(): AgentTool<any, any> {
  return createTool({
    name: 'validate_typescript',
    description:
      'Validate TypeScript code compilation using the TypeScript compiler API. ' +
      'Supports basic compilation with various target and module options. ' +
      'Returns compilation success status, JavaScript output, and any diagnostics.',
    inputSchema: z.object({
      code: z.string().describe('TypeScript code to validate'),
      file_path: z.string().optional().default('src/index.ts').describe(
        'Virtual file path for the TypeScript source (e.g., "src/index.ts")'
      ),
      target: z.enum(['ES3', 'ES5', 'ES2015', 'ES2016', 'ES2017', 'ES2018', 'ES2019', 'ES2020', 'ES2021', 'ES2022', 'ES2023', 'ES2024', 'ES2025', 'ESNext'])
        .default('ES2015').describe('ECMAScript target version'),
      module: z.enum(['None', 'CommonJS', 'AMD', 'UMD', 'System', 'ES2015', 'ES2020', 'ES2022', 'ESNext', 'Node16', 'Node18', 'Node20', 'NodeNext'])
        .default('CommonJS').describe('Module system target'),
      strict: z.boolean().optional().default(true).describe('Enable strict type-checking options'),
    }),
    execute: async ({ code, file_path, target, module, strict }) => {
      try {
        // Import TypeScript compiler API
        const ts = await import('typescript')

        // Convert target and module strings to TypeScript enums
        const targetMap: Record<string, any> = {
          'ES3': ts.ScriptTarget.ES3,
          'ES5': ts.ScriptTarget.ES5,
          'ES2015': ts.ScriptTarget.ES2015,
          'ES2016': ts.ScriptTarget.ES2016,
          'ES2017': ts.ScriptTarget.ES2017,
          'ES2018': ts.ScriptTarget.ES2018,
          'ES2019': ts.ScriptTarget.ES2019,
          'ES2020': ts.ScriptTarget.ES2020,
          'ES2021': ts.ScriptTarget.ES2021,
          'ES2022': ts.ScriptTarget.ES2022,
          'ES2023': ts.ScriptTarget.ES2023,
          'ES2024': ts.ScriptTarget.ES2024,
          'ES2025': ts.ScriptTarget.ES2025,
          'ESNext': ts.ScriptTarget.ESNext,
        }

        const moduleMap: Record<string, any> = {
          'None': ts.ModuleKind.None,
          'CommonJS': ts.ModuleKind.CommonJS,
          'AMD': ts.ModuleKind.AMD,
          'UMD': ts.ModuleKind.UMD,
          'System': ts.ModuleKind.System,
          'ES2015': ts.ModuleKind.ES2015,
          'ES2020': ts.ModuleKind.ES2020,
          'ES2022': ts.ModuleKind.ES2022,
          'ESNext': ts.ModuleKind.ESNext,
          'Node16': ts.ModuleKind.Node16,
          'Node18': ts.ModuleKind.Node18,
          'Node20': ts.ModuleKind.Node20,
          'NodeNext': ts.ModuleKind.NodeNext,
        }

        // Create compiler configuration
        const compilerOptions: TypeScript.CompilerOptions = {
          target: targetMap[target] || ts.ScriptTarget.ES2015,
          module: moduleMap[module] || ts.ModuleKind.CommonJS,
          strict: strict ?? true,
          esModuleInterop: true,
          skipLibCheck: false,
          allowJs: false,
        }

        // ts.sys is undefined in edge/worker environments (no filesystem access).
        // Use transpileModule (syntactic check + JS output, no semantic type-checking)
        // when sys is unavailable; fall back to full type-checking via createProgram
        // when sys is present (Node.js / Bun with real filesystem).
        if (!ts.sys) {
          const result = ts.transpileModule(code, {
            compilerOptions,
            fileName: file_path,
            reportDiagnostics: true,
          })
          const diags = result.diagnostics ?? []
          if (diags.length > 0) {
            return {
              success: false,
              diagnostics: diags.map(d => ({
                message: typeof d.messageText === 'string'
                  ? d.messageText
                  : d.messageText.messageText,
                line: 0,
                character: 0,
                severity: ts.DiagnosticCategory[d.category].toLowerCase(),
              })),
              error: 'TypeScript compilation failed',
              message: 'Compilation failed with diagnostics (syntactic check only)',
            }
          }
          return {
            success: true,
            compiled_code: result.outputText,
            diagnostics: [],
            message: 'TypeScript transpilation successful (syntactic check only — no semantic type-checking in this environment)',
          }
        }

        // Full type-checking path: ts.sys is available, use real TypeScript lib files.
        // Spread is intentionally avoided: createCompilerHost returns prototype-based
        // methods that are not own-enumerable and would be lost by object spread.
        const sourceFile = ts.createSourceFile(file_path, code, ts.ScriptTarget.Latest, true)
        const defaultHost = ts.createCompilerHost(compilerOptions)
        const compilerHost: TypeScript.CompilerHost = {
          getSourceFile: (fileName: string, languageVersion: TypeScript.ScriptTarget | TypeScript.CreateSourceFileOptions) =>
            fileName === file_path
              ? sourceFile
              : defaultHost.getSourceFile(fileName, languageVersion),
          writeFile: () => {},
          getDefaultLibFileName: (opts: TypeScript.CompilerOptions) => defaultHost.getDefaultLibFileName(opts),
          useCaseSensitiveFileNames: () => defaultHost.useCaseSensitiveFileNames(),
          getCanonicalFileName: (fileName: string) => defaultHost.getCanonicalFileName(fileName),
          getCurrentDirectory: () => defaultHost.getCurrentDirectory(),
          getNewLine: () => defaultHost.getNewLine(),
          fileExists: (fileName: string) => defaultHost.fileExists(fileName),
          readFile: (fileName: string) => defaultHost.readFile(fileName),
          directoryExists: defaultHost.directoryExists
            ? (dirName: string) => defaultHost.directoryExists!(dirName)
            : undefined,
          getDirectories: defaultHost.getDirectories
            ? (p: string) => defaultHost.getDirectories!(p)
            : undefined,
        }

        const program = ts.createProgram({ rootNames: [file_path], options: compilerOptions, host: compilerHost })
        const diagnostics = ts.getPreEmitDiagnostics(program)

        if (diagnostics.length > 0) {
          return {
            success: false,
            diagnostics: diagnostics.map(d => ({
              message: d.messageText.toString(),
              line: d.start ? sourceFile.getLineAndCharacterOfPosition(d.start).line + 1 : 0,
              character: d.start ? sourceFile.getLineAndCharacterOfPosition(d.start).character + 1 : 0,
              severity: ts.DiagnosticCategory[d.category].toLowerCase(),
            })),
            error: 'TypeScript compilation failed',
            message: 'Compilation failed with diagnostics'
          }
        }

        let compiledCode = ''
        const emitResult = program.emit(undefined, (fileName, data) => {
          if (fileName.endsWith('.js')) compiledCode = data
        })

        if (emitResult.emitSkipped || emitResult.diagnostics.length > 0) {
          return {
            success: false,
            diagnostics: emitResult.diagnostics.map(d => ({
              message: d.messageText.toString(),
              line: d.start ? sourceFile.getLineAndCharacterOfPosition(d.start).line + 1 : 0,
              character: d.start ? sourceFile.getLineAndCharacterOfPosition(d.start).character + 1 : 0,
              severity: ts.DiagnosticCategory[d.category].toLowerCase(),
            })),
            error: 'TypeScript emission failed',
            message: 'Emission failed with diagnostics'
          }
        }

        return {
          success: true,
          compiled_code: compiledCode,
          diagnostics: [],
          message: 'TypeScript compilation successful'
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to validate TypeScript code',
          message: 'TypeScript validation error'
        }
      }
    },
  })
}
