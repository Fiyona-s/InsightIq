import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {ignores: ['node_modules/**','dist/**','test-results/**','playwright-report/**']},
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {parser:tseslint.parser, parserOptions:{ecmaVersion:'latest',sourceType:'module',ecmaFeatures:{jsx:true}}},
    plugins: {'@typescript-eslint':tseslint.plugin,'react-hooks':reactHooks},
    rules: {
      '@typescript-eslint/no-duplicate-enum-values':'error',
      '@typescript-eslint/no-misused-new':'error',
      'react-hooks/rules-of-hooks':'error',
      // Advisory on the legacy tree: changing effect lifecycles is outside visual cleanup.
      'react-hooks/exhaustive-deps':'warn',
    },
  },
];
