import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        XMLHttpRequest: 'readonly',
        requestAnimationFrame: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Image: 'readonly',
        WebGL2RenderingContext: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
  {
    // *.test.js and tests/browser/fixtures/** are mechanically-ported QUnit
    // test bodies (kept byte-for-byte identical to the originals apart from
    // the module wrapper); their pre-existing quality issues are left for a
    // later pass rather than papered over here.
    ignores: [
      'dist/**',
      'dist-debug/**',
      'node_modules/**',
      'doc/**',
      'snippets/**',
      'src/tests/**/*.test.js',
      'tests/browser/fixtures/**',
    ],
  },
);
