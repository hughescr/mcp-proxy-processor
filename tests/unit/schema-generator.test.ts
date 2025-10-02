/**
 * Unit tests for SchemaGenerator
 */

import { describe, test, expect } from 'bun:test';
import { SchemaGenerator } from '../../src/middleware/schema-generator.js';
import type { TemplateMapping } from '../../src/types/config.js';

describe('SchemaGenerator', () => {
    const generator = new SchemaGenerator();

    describe('generateClientSchema', () => {
        test('should return minimal schema when backend schema is undefined', () => {
            const mapping: TemplateMapping = {
                type:     'template',
                mappings: {},
            };

            const result = generator.generateClientSchema(undefined, mapping);

            expect(result).toEqual({
                type:       'object',
                properties: {},
                required:   [],
            });
        });

        test('should hide constant parameters from client schema', () => {
            const backendSchema = {
                type:       'object',
                properties: {
                    api_key: { type: 'string', description: 'API key' },
                    query:   { type: 'string', description: 'Search query' },
                },
                required: ['api_key', 'query'],
            };

            const mapping: TemplateMapping = {
                type:     'template',
                mappings: {
                    api_key: { type: 'constant', value: 'secret123' },
                    query:   { type: 'passthrough', source: 'query' },
                },
            };

            const result = generator.generateClientSchema(backendSchema, mapping);

            // api_key should be hidden
            expect(result.properties).not.toHaveProperty('api_key');
            expect(result.properties).toHaveProperty('query');
            expect(result.required).not.toContain('api_key');
            expect(result.required).toContain('query');
        });

        test('should hide omit parameters from client schema', () => {
            const backendSchema = {
                type:       'object',
                properties: {
                    debug: { type: 'boolean', description: 'Debug mode' },
                    query: { type: 'string', description: 'Search query' },
                },
                required: ['query'],
            };

            const mapping: TemplateMapping = {
                type:     'template',
                mappings: {
                    debug: { type: 'omit' },
                    query: { type: 'passthrough', source: 'query' },
                },
            };

            const result = generator.generateClientSchema(backendSchema, mapping);

            // debug should be hidden
            expect(result.properties).not.toHaveProperty('debug');
            expect(result.properties).toHaveProperty('query');
        });

        test('should make default parameters optional in client schema', () => {
            const backendSchema = {
                type:       'object',
                properties: {
                    timezone: { type: 'string', description: 'Timezone' },
                    query:    { type: 'string', description: 'Search query' },
                },
                required: ['timezone', 'query'],
            };

            const mapping: TemplateMapping = {
                type:     'template',
                mappings: {
                    timezone: { type: 'default', source: 'timezone', 'default': 'America/Los_Angeles' },
                    query:    { type: 'passthrough', source: 'query' },
                },
            };

            const result = generator.generateClientSchema(backendSchema, mapping);

            // timezone should be optional (not required)
            expect(result.required).not.toContain('timezone');
            expect(result.required).toContain('query');
            // But timezone should still be in properties
            expect(result.properties).toHaveProperty('timezone');
        });

        test('should apply parameter name overrides', () => {
            const backendSchema = {
                type:       'object',
                properties: {
                    backend_query: { type: 'string', description: 'Backend query' },
                },
                required: ['backend_query'],
            };

            const mapping: TemplateMapping = {
                type:     'template',
                mappings: {
                    backend_query: {
                        type:   'passthrough',
                        source: 'q',
                        name:   'q',
                    },
                },
            };

            const result = generator.generateClientSchema(backendSchema, mapping);

            // Client should see parameter as 'q'
            expect(result.properties).toHaveProperty('q');
            expect(result.properties).not.toHaveProperty('backend_query');
            expect(result.required).toContain('q');
        });

        test('should apply parameter description overrides', () => {
            const backendSchema = {
                type:       'object',
                properties: {
                    query: { type: 'string', description: 'Complex backend description' },
                },
                required: ['query'],
            };

            const mapping: TemplateMapping = {
                type:     'template',
                mappings: {
                    query: {
                        type:        'passthrough',
                        source:      'query',
                        description: 'Simple search query',
                    },
                },
            };

            const result = generator.generateClientSchema(backendSchema, mapping);

            // Description should be overridden
            expect((result.properties as Record<string, unknown>)?.query).toHaveProperty('description', 'Simple search query');
        });

        test('should preserve required status for passthrough parameters', () => {
            const backendSchema = {
                type:       'object',
                properties: {
                    required_param: { type: 'string' },
                    optional_param: { type: 'string' },
                },
                required: ['required_param'],
            };

            const mapping: TemplateMapping = {
                type:     'template',
                mappings: {
                    required_param: { type: 'passthrough', source: 'required_param' },
                    optional_param: { type: 'passthrough', source: 'optional_param' },
                },
            };

            const result = generator.generateClientSchema(backendSchema, mapping);

            expect(result.required).toContain('required_param');
            expect(result.required).not.toContain('optional_param');
        });

        test('should passthrough unmapped parameters by default', () => {
            const backendSchema = {
                type:       'object',
                properties: {
                    mapped:   { type: 'string', description: 'Mapped param' },
                    unmapped: { type: 'string', description: 'Unmapped param' },
                },
                required: ['mapped', 'unmapped'],
            };

            const mapping: TemplateMapping = {
                type:     'template',
                mappings: {
                    mapped: { type: 'passthrough', source: 'mapped' },
                    // unmapped is not in mappings
                },
            };

            const result = generator.generateClientSchema(backendSchema, mapping);

            // Both should be in client schema
            expect(result.properties).toHaveProperty('mapped');
            expect(result.properties).toHaveProperty('unmapped');
            expect(result.required).toContain('mapped');
            expect(result.required).toContain('unmapped');
        });

        test('should handle rename parameters correctly', () => {
            const backendSchema = {
                type:       'object',
                properties: {
                    backend_name: { type: 'string', description: 'Backend parameter' },
                },
                required: ['backend_name'],
            };

            const mapping: TemplateMapping = {
                type:     'template',
                mappings: {
                    backend_name: {
                        type:   'rename',
                        source: 'client_name',
                        name:   'client_name',
                    },
                },
            };

            const result = generator.generateClientSchema(backendSchema, mapping);

            // Client should see parameter as 'client_name'
            expect(result.properties).toHaveProperty('client_name');
            expect(result.properties).not.toHaveProperty('backend_name');
            expect(result.required).toContain('client_name');
        });

        test('should handle complex scenario with multiple mapping types', () => {
            const backendSchema = {
                type:       'object',
                properties: {
                    api_key:  { type: 'string', description: 'API key' },
                    timezone: { type: 'string', description: 'Timezone' },
                    query:    { type: 'string', description: 'Search query' },
                    debug:    { type: 'boolean', description: 'Debug mode' },
                },
                required: ['api_key', 'query'],
            };

            const mapping: TemplateMapping = {
                type:     'template',
                mappings: {
                    api_key:  { type: 'constant', value: 'secret' },
                    timezone: { type: 'default', source: 'timezone', 'default': 'UTC' },
                    query:    { type: 'passthrough', source: 'query' },
                    debug:    { type: 'omit' },
                },
            };

            const result = generator.generateClientSchema(backendSchema, mapping);

            // api_key: hidden (constant)
            expect(result.properties).not.toHaveProperty('api_key');
            expect(result.required).not.toContain('api_key');

            // timezone: visible but optional (default)
            expect(result.properties).toHaveProperty('timezone');
            expect(result.required).not.toContain('timezone');

            // query: visible and required (passthrough)
            expect(result.properties).toHaveProperty('query');
            expect(result.required).toContain('query');

            // debug: hidden (omit)
            expect(result.properties).not.toHaveProperty('debug');
        });

        test('should preserve non-property fields from backend schema', () => {
            const backendSchema = {
                type:                 'object',
                properties:           { query: { type: 'string' } },
                required:             ['query'],
                additionalProperties: false,
                title:                'SearchRequest',
            };

            const mapping: TemplateMapping = {
                type:     'template',
                mappings: {
                    query: { type: 'passthrough', source: 'query' },
                },
            };

            const result = generator.generateClientSchema(backendSchema, mapping);

            expect(result).toHaveProperty('additionalProperties', false);
            expect(result).toHaveProperty('title', 'SearchRequest');
        });
    });
});
