import tseslint from 'typescript-eslint';

export default tseslint.config(
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': ['warn', { allowExpressions: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'warn',
    },
  },
);