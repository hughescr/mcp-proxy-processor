import defaultConfig from '@hughescr/eslint-config-default';
import packageJson from 'eslint-plugin-package-json';

import tseslint from 'typescript-eslint';

export default
[
    {
        name: 'local-project-ignores',
        ignores: ['coverage', '*.md'],
    },

    defaultConfig.configs.recommended,

    ...tseslint.configs.recommended,
    ...tseslint.configs.stylistic,

    {
        name: 'TypeScript overrides',
        rules: {
            '@typescript-eslint/triple-slash-reference': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            '@stylistic/operator-linebreak': 'off',
            'n/no-missing-import': 'off',
            'n/no-sync': 'off',
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
        files: ['**/*.js', '**/*.mjs', ...packageJson.configs.recommended.files],
        ...tseslint.configs.disableTypeChecked,
    },
];
