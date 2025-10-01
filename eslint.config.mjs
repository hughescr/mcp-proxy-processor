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
    }
);
