import ts from 'typescript'
import { defineConfig } from 'vitest/config'

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

/** Let source-mode tests execute the same standard decorators lowered by the production build. */
export default defineConfig({
  plugins: [{
    name: 'evoforge-standard-decorators',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?', 1)[0] ?? id
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          ...(file.endsWith('x') ? { jsx: ts.JsxEmit.ReactJSX } : {}),
          sourceMap: true,
        },
      })
      const transformed = result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n')
      return result.sourceMapText === undefined
        ? { code: transformed }
        : { code: transformed, map: result.sourceMapText }
    },
  }],
})
