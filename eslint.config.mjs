import { defineConfig } from 'eslint/config';
import defaultConfig from '@hughescr/eslint-config-default';

export default defineConfig(
    {
        name:    'local-project-ignores',
        ignores: ['coverage', '*.md'],
    },

    defaultConfig
);
