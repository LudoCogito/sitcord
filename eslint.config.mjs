import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Disable formatting-related rules that Prettier owns; keep this last.
  prettier,
  {
    rules: {
      // TypeScript already reports genuinely-undefined identifiers, and it knows
      // the platform globals (window, process, Buffer, …) that no-undef doesn't.
      'no-undef': 'off',
      // The RPC wire and a few Electron/DOM seams are inherently loose; flag new
      // `any` as a warning to discourage spread without failing the build.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  }
)
