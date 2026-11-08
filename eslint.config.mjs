import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'src/generated/**'],
  },
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
);
