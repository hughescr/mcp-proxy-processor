import { defineConfig } from 'eslint/config';
import defaultConfig from '@hughescr/eslint-config-default';

export default defineConfig(
    {
        name:    'local-project-ignores',
        ignores: ['coverage', '*.md'],
    },

    defaultConfig,

    {
        name:  'local-project-overrides',
        rules: {
            // Disable n/no-missing-import for @modelcontextprotocol/sdk as the rule doesn't understand package exports
            'n/no-missing-import': ['error', {
                allowModules: ['@modelcontextprotocol/sdk'],
            }],
        },
    },

    {
        name:  'jsx-files-overrides',
        files: ['**/*.tsx', '**/*.jsx'],
        rules: {
            // Disable @stylistic/indent for JSX files as it conflicts with @stylistic/jsx-indent-props
            '@stylistic/indent': 'off',
        },
    },

    {
        name:  'test-files-overrides',
        files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
        rules: {
            // Can't exclude 'bun:test' from n/no-missing-import as it is needed in test files
            'n/no-missing-import': 'off',
        },
    },

    {
        name:  'package-json-overrides',
        files: ['**/package.json'],
        rules: {
            // Allow link: protocol for local package linking
            'package-json/valid-dependencies': 'off',
        },
    }
);
