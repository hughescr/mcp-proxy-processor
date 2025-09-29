import defaultConfig from '@hughescr/eslint-config-default';
import packageJson from 'eslint-plugin-package-json';
import tseslint from 'typescript-eslint';

export default
[
    {
        name: 'ignores',
        ignores: ['coverage', 'node_modules', 'dist', '*.md'],
    },

    defaultConfig.configs.recommended,

    ...tseslint.configs.recommended,
    ...tseslint.configs.stylistic,

    {
        rules: {
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            '@stylistic/operator-linebreak': 'off',
            'n/no-missing-import': 'off',
        },
    },

    {
        ...packageJson.configs.recommended,
        rules: {
            ...packageJson.configs.recommended.rules,
            strict: 'off',
        }
    },

    {
        files: ['**/*.js', '**/*.mjs'],
        ...tseslint.configs.disableTypeChecked,
    },
];