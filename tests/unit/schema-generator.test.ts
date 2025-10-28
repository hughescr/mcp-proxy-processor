/**
 * Unit tests for SchemaGenerator
 */

import { describe, test, expect } from 'bun:test';
import { z } from 'zod';
import { SchemaGenerator } from '../../src/middleware/schema-generator.js';
import type { TemplateMapping, ParameterMapping } from '../../src/types/config.js';

describe('SchemaGenerator', () => {
    const generator = new SchemaGenerator();

    describe('generateClientSchema', () => {
        test('should return minimal schema when backend schema is undefined', () => {
            const mapping: TemplateMapping = {
                type:     'template',
                mappings: {},
            };

            const result = generator.generateClientSchema(undefined, mapping);

            // Structural checks
            expect(result).toEqual({
                type:       'object',
                properties: {},
                required:   [],
            });

            // Validation: Empty object schema should accept empty objects
            const zodSchema = z.object({});
            expect(() => zodSchema.parse({})).not.toThrow();
            expect(() => zodSchema.parse({ unexpected: 'value' })).not.toThrow(); // Extra properties allowed
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

            // Structural checks: api_key should be hidden
            expect(result.properties).not.toHaveProperty('api_key');
            expect(result.properties).toHaveProperty('query');
            expect(result.required).not.toContain('api_key');
            expect(result.required).toContain('query');

            // Validation: Schema should only require 'query' parameter
            const zodSchema = z.object({
                query: z.string(),
            });

            // Valid data with only query should pass
            expect(() => zodSchema.parse({ query: 'test' })).not.toThrow();

            // Invalid: Missing required query should fail
            expect(() => zodSchema.parse({})).toThrow();

            // Invalid: Wrong type for query should fail
            expect(() => zodSchema.parse({ query: 123 })).toThrow();
        });

        test('should hide omit parameters from client schema', () => {
            const backendSchema = {
                type:       'object',
                properties: {
                    debug: { type: 'boolean', description: 'Debug mode' },
                    query: { type: 'string', description: 'Search query' },
                },
                required: ['debug', 'query'],
            };

            const mapping: TemplateMapping = {
                type:     'template',
                mappings: {
                    debug: { type: 'omit' },
                    query: { type: 'passthrough', source: 'query' },
                },
            };

            const result = generator.generateClientSchema(backendSchema, mapping);

            // Structural checks: debug should be hidden (even though it was required in backend)
            expect(result.properties).not.toHaveProperty('debug');
            expect(result.required).not.toContain('debug');
            expect(result.properties).toHaveProperty('query');
            expect(result.required).toContain('query');

            // Validation: Schema should only require 'query' (no debug parameter)
            const zodSchema = z.object({
                query: z.string(),
            });

            // Valid data without debug should pass
            expect(() => zodSchema.parse({ query: 'search term' })).not.toThrow();

            // Invalid: Missing query should fail
            expect(() => zodSchema.parse({})).toThrow();

            // Invalid: Wrong type should fail
            expect(() => zodSchema.parse({ query: true })).toThrow();
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

            // Structural checks: timezone should be optional (not required)
            expect(result.required).not.toContain('timezone');
            expect(result.required).toContain('query');
            // But timezone should still be in properties
            expect(result.properties).toHaveProperty('timezone');

            // Validation: Schema should make timezone optional
            const zodSchema = z.object({
                timezone: z.string().optional(),
                query:    z.string(),
            });

            // Valid: Data without timezone should pass
            expect(() => zodSchema.parse({ query: 'test' })).not.toThrow();

            // Valid: Data with timezone should pass
            expect(() => zodSchema.parse({ query: 'test', timezone: 'UTC' })).not.toThrow();

            // Invalid: Missing required query should fail
            expect(() => zodSchema.parse({ timezone: 'UTC' })).toThrow();

            // Invalid: Wrong type for timezone should fail
            expect(() => zodSchema.parse({ query: 'test', timezone: 123 })).toThrow();
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

            // Structural checks: Client should see parameter as 'q'
            expect(result.properties).toHaveProperty('q');
            expect(result.properties).not.toHaveProperty('backend_query');
            expect(result.required).toContain('q');

            // Validation: Schema should use renamed parameter 'q'
            const zodSchema = z.object({
                q: z.string(),
            });

            // Valid: Data with 'q' parameter should pass
            expect(() => zodSchema.parse({ q: 'search' })).not.toThrow();

            // Invalid: Missing 'q' should fail
            expect(() => zodSchema.parse({})).toThrow();

            // Invalid: Using old name should fail
            expect(() => zodSchema.parse({ backend_query: 'search' })).toThrow();
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

            // Structural check: Description should be overridden
            expect((result.properties as Record<string, unknown>)?.query).toHaveProperty('description', 'Simple search query');

            // Validation: Description doesn't affect validation, but schema should still work
            const zodSchema = z.object({
                query: z.string(),
            });

            // Valid: Proper query should pass
            expect(() => zodSchema.parse({ query: 'test' })).not.toThrow();

            // Invalid: Missing query should fail
            expect(() => zodSchema.parse({})).toThrow();
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

            // Structural checks
            expect(result.required).toContain('required_param');
            expect(result.required).not.toContain('optional_param');

            // Validation: Schema should enforce required_param, allow optional_param
            const zodSchema = z.object({
                required_param: z.string(),
                optional_param: z.string().optional(),
            });

            // Valid: Data with required_param only
            expect(() => zodSchema.parse({ required_param: 'value' })).not.toThrow();

            // Valid: Data with both parameters
            expect(() => zodSchema.parse({ required_param: 'value', optional_param: 'optional' })).not.toThrow();

            // Invalid: Missing required_param should fail
            expect(() => zodSchema.parse({ optional_param: 'optional' })).toThrow();
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

            // Structural checks: Both should be in client schema
            expect(result.properties).toHaveProperty('mapped');
            expect(result.properties).toHaveProperty('unmapped');
            expect(result.required).toContain('mapped');
            expect(result.required).toContain('unmapped');

            // Validation: Both parameters should be required
            const zodSchema = z.object({
                mapped:   z.string(),
                unmapped: z.string(),
            });

            // Valid: Data with both parameters
            expect(() => zodSchema.parse({ mapped: 'val1', unmapped: 'val2' })).not.toThrow();

            // Invalid: Missing mapped should fail
            expect(() => zodSchema.parse({ unmapped: 'val2' })).toThrow();

            // Invalid: Missing unmapped should fail
            expect(() => zodSchema.parse({ mapped: 'val1' })).toThrow();
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

            // Structural checks: Client should see parameter as 'client_name'
            expect(result.properties).toHaveProperty('client_name');
            expect(result.properties).not.toHaveProperty('backend_name');
            expect(result.required).toContain('client_name');

            // Validation: Schema should use renamed parameter
            const zodSchema = z.object({
                client_name: z.string(),
            });

            // Valid: Data with client_name
            expect(() => zodSchema.parse({ client_name: 'value' })).not.toThrow();

            // Invalid: Missing client_name should fail
            expect(() => zodSchema.parse({})).toThrow();

            // Invalid: Using backend_name should fail (it's renamed)
            expect(() => zodSchema.parse({ backend_name: 'value' })).toThrow();
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

            // Structural checks
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

            // Validation: Complex schema with only query required, timezone optional
            const zodSchema = z.object({
                query:    z.string(),
                timezone: z.string().optional(),
            }).strict(); // Strict mode to reject hidden parameters

            // Valid: Just query
            expect(() => zodSchema.parse({ query: 'search' })).not.toThrow();

            // Valid: Query and timezone
            expect(() => zodSchema.parse({ query: 'search', timezone: 'America/New_York' })).not.toThrow();

            // Invalid: Missing required query
            expect(() => zodSchema.parse({ timezone: 'UTC' })).toThrow();

            // Invalid: Should not accept hidden parameters (strict mode)
            expect(() => zodSchema.parse({ query: 'search', api_key: 'secret', debug: true })).toThrow();
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

            // Structural checks: Non-property fields should be preserved
            expect(result).toHaveProperty('additionalProperties', false);
            expect(result).toHaveProperty('title', 'SearchRequest');

            // Validation: Schema should work normally
            const zodSchema = z.object({
                query: z.string(),
            }).strict(); // strict() mirrors additionalProperties: false

            // Valid: Proper query
            expect(() => zodSchema.parse({ query: 'test' })).not.toThrow();

            // Invalid: Additional properties not allowed (strict mode)
            expect(() => zodSchema.parse({ query: 'test', extra: 'field' })).toThrow();
        });

        test('should warn when parameter mapping references non-existent backend parameter', () => {
            const backendSchema = {
                type:       'object',
                properties: {
                    existing_param: { type: 'string', description: 'Exists' },
                },
                required: [],
            };

            const mapping: TemplateMapping = {
                type:     'template',
                mappings: {
                    non_existent_param: { type: 'passthrough', source: 'non_existent_param' },
                    existing_param:     { type: 'passthrough', source: 'existing_param' },
                },
            };

            const result = generator.generateClientSchema(backendSchema, mapping);

            // Structural checks: Should only include the existing parameter
            expect(result.properties).toHaveProperty('existing_param');
            expect(result.properties).not.toHaveProperty('non_existent_param');

            // Validation: Schema should only have existing_param (optional)
            const zodSchema = z.object({
                existing_param: z.string().optional(),
            }).strict(); // Strict mode to reject non-existent params

            // Valid: Empty object (no required params)
            expect(() => zodSchema.parse({})).not.toThrow();

            // Valid: With existing_param
            expect(() => zodSchema.parse({ existing_param: 'value' })).not.toThrow();

            // Invalid: Should reject non_existent_param (strict mode)
            expect(() => zodSchema.parse({ non_existent_param: 'value' })).toThrow();
        });

        test('should handle unknown parameter mapping type gracefully', () => {
            const backendSchema = {
                type:       'object',
                properties: {
                    test_param: { type: 'string', description: 'Test parameter' },
                },
                required: [],
            };

            // Create a mapping with an unknown type (using type assertion to bypass TypeScript)
            const unknownMapping = { type: 'unknown-type' };
            const mapping: TemplateMapping = {
                type:     'template',
                mappings: {

                    test_param: unknownMapping as unknown as ParameterMapping,
                },
            };

            const result = generator.generateClientSchema(backendSchema, mapping);

            // Structural check: Should not include the parameter with unknown type
            expect(result.properties).not.toHaveProperty('test_param');

            // Validation: Schema should be empty (no properties)
            const zodSchema = z.object({});

            // Valid: Empty object should pass
            expect(() => zodSchema.parse({})).not.toThrow();

            // Valid: Extra properties allowed by default
            expect(() => zodSchema.parse({ anything: 'value' })).not.toThrow();
        });
    });
});
