/**
 * Tests for ArgumentTransformer
 */

import { describe, test, expect } from 'bun:test';
import { ArgumentTransformer } from '../../src/middleware/argument-transformer.js';
import type { ArgumentMapping } from '../../src/types/config.js';

describe('ArgumentTransformer', () => {
    const transformer = new ArgumentTransformer();

    describe('Template Mappings', () => {
        describe('Passthrough mapping', () => {
            test('should pass through client arguments unchanged', async () => {
                const mapping: ArgumentMapping = {
                    type:     'template',
                    mappings: {
                        query: { type: 'passthrough', source: 'query' },
                        limit: { type: 'passthrough', source: 'limit' },
                    },
                };

                const result = await transformer.transform(
                    { query: 'test search', limit: 10 },
                    mapping
                );

                expect(result).toEqual({ query: 'test search', limit: 10 });
            });

            test('should omit undefined values', async () => {
                const mapping: ArgumentMapping = {
                    type:     'template',
                    mappings: {
                        query:    { type: 'passthrough', source: 'query' },
                        optional: { type: 'passthrough', source: 'optional' },
                    },
                };

                const result = await transformer.transform({ query: 'test' }, mapping);

                expect(result).toEqual({ query: 'test' });
                expect(result).not.toHaveProperty('optional');
            });
        });

        describe('Constant mapping', () => {
            test('should always use constant value', async () => {
                const mapping: ArgumentMapping = {
                    type:     'template',
                    mappings: {
                        apiKey: { type: 'constant', value: 'secret-key-123' },
                        mode:   { type: 'constant', value: 'production' },
                    },
                };

                const result = await transformer.transform({}, mapping);

                expect(result).toEqual({
                    apiKey: 'secret-key-123',
                    mode:   'production',
                });
            });

            test('should ignore client values when using constant', async () => {
                const mapping: ArgumentMapping = {
                    type:     'template',
                    mappings: {
                        mode: { type: 'constant', value: 'production' },
                    },
                };

                const result = await transformer.transform({ mode: 'development' }, mapping);

                expect(result).toEqual({ mode: 'production' });
            });
        });

        describe('Default mapping', () => {
            test('should use client value when provided', async () => {
                const mapping: ArgumentMapping = {
                    type:     'template',
                    mappings: {
                        timezone: {
                            type:      'default',
                            source:    'timezone',
                            'default': 'America/Los_Angeles',
                        },
                    },
                };

                const result = await transformer.transform(
                    { timezone: 'Europe/London' },
                    mapping
                );

                expect(result).toEqual({ timezone: 'Europe/London' });
            });

            test('should use default value when client value not provided', async () => {
                const mapping: ArgumentMapping = {
                    type:     'template',
                    mappings: {
                        timezone: {
                            type:      'default',
                            source:    'timezone',
                            'default': 'America/Los_Angeles',
                        },
                    },
                };

                const result = await transformer.transform({}, mapping);

                expect(result).toEqual({ timezone: 'America/Los_Angeles' });
            });

            test('should use default for various types', async () => {
                const mapping: ArgumentMapping = {
                    type:     'template',
                    mappings: {
                        count:   { type: 'default', source: 'count', 'default': 10 },
                        enabled: { type: 'default', source: 'enabled', 'default': true },
                        tags:    { type: 'default', source: 'tags', 'default': ['default'] },
                    },
                };

                const result = await transformer.transform({}, mapping);

                expect(result).toEqual({
                    count:   10,
                    enabled: true,
                    tags:    ['default'],
                });
            });
        });

        describe('Rename mapping', () => {
            test('should rename parameter from client to backend', async () => {
                const mapping: ArgumentMapping = {
                    type:     'template',
                    mappings: {
                        search_query: { type: 'rename', source: 'query' },
                    },
                };

                const result = await transformer.transform({ query: 'test' }, mapping);

                expect(result).toEqual({ search_query: 'test' });
                expect(result).not.toHaveProperty('query');
            });
        });

        describe('Combined mappings', () => {
            test('should handle multiple mapping types together', async () => {
                const mapping: ArgumentMapping = {
                    type:     'template',
                    mappings: {
                        query:    { type: 'passthrough', source: 'query' },
                        timezone: { type: 'default', source: 'timezone', 'default': 'UTC' },
                        apiKey:   { type: 'constant', value: 'secret' },
                        user_id:  { type: 'rename', source: 'userId' },
                    },
                };

                const result = await transformer.transform(
                    {
                        query:  'search term',
                        userId: '123',
                    },
                    mapping
                );

                expect(result).toEqual({
                    query:    'search term',
                    timezone: 'UTC',
                    apiKey:   'secret',
                    user_id:  '123',
                });
            });
        });
    });

    describe('Omit mapping', () => {
        test('should remove parameter from backend args', async () => {
            const mapping = {
                type:     'template' as const,
                mappings: {
                    // This will be removed from the output
                    internalField: { type: 'omit' },
                },
            };

            const result = await transformer.transform(
                { internalField: 'should be removed', otherField: 'should remain' },
                mapping as ArgumentMapping
            );

            expect(result).toEqual({ otherField: 'should remain' });
            expect(result).not.toHaveProperty('internalField');
        });

        test('should handle omit for non-existent fields', async () => {
            const mapping = {
                type:     'template' as const,
                mappings: {
                    nonExistent: { type: 'omit' },
                },
            };

            const result = await transformer.transform(
                { actualField: 'value' },
                mapping as ArgumentMapping
            );

            expect(result).toEqual({ actualField: 'value' });
        });
    });

    describe('Default mapping with consumed sources', () => {
        test('should consume source when default mapping has different backend param name', async () => {
            const mapping: ArgumentMapping = {
                type:     'template',
                mappings: {
                    backend_timezone: {
                        type:      'default',
                        source:    'timezone',
                        'default': 'UTC',
                    },
                },
            };

            // When client provides the value
            const result1 = await transformer.transform(
                { timezone: 'America/New_York', other: 'value' },
                mapping
            );

            // Source 'timezone' should be consumed (removed) and renamed to 'backend_timezone'
            expect(result1).toEqual({
                backend_timezone: 'America/New_York',
                other:            'value',
            });
            expect(result1).not.toHaveProperty('timezone');

            // When client doesn't provide the value
            const result2 = await transformer.transform(
                { other: 'value' },
                mapping
            );

            // Default value should be used
            expect(result2).toEqual({
                backend_timezone: 'UTC',
                other:            'value',
            });
        });

        test('should not consume source when default mapping uses same name', async () => {
            const mapping: ArgumentMapping = {
                type:     'template',
                mappings: {
                    timezone: {
                        type:      'default',
                        source:    'timezone',
                        'default': 'UTC',
                    },
                },
            };

            // When client provides the value
            const result = await transformer.transform(
                { timezone: 'America/New_York' },
                mapping
            );

            // Source should NOT be consumed since backendParam === source
            expect(result).toEqual({ timezone: 'America/New_York' });
        });
    });

    describe('JSONata Mappings', () => {
        test('should transform using simple JSONata expression', async () => {
            const mapping: ArgumentMapping = {
                type:       'jsonata',
                expression: '{ "query": query, "limit": limit }',
            };

            const result = await transformer.transform(
                { query: 'test', limit: 10 },
                mapping
            );

            expect(result).toEqual({ query: 'test', limit: 10 });
        });

        test('should apply default value in JSONata expression', async () => {
            const mapping: ArgumentMapping = {
                type:       'jsonata',
                expression: '{ "timezone": timezone ? timezone : "America/Los_Angeles" }',
            };

            const result = await transformer.transform({}, mapping);

            expect(result).toEqual({ timezone: 'America/Los_Angeles' });
        });

        test('should transform complex structure', async () => {
            const mapping: ArgumentMapping = {
                type:       'jsonata',
                expression: '{ "search": { "query": q, "filters": filters }, "page": page ? page : 1 }',
            };

            const result = await transformer.transform(
                { q: 'test', filters: ['active'] },
                mapping
            );

            expect(result).toEqual({
                search: { query: 'test', filters: ['active'] },
                page:   1,
            });
        });

        test('should throw error if expression returns non-object', async () => {
            const mapping: ArgumentMapping = {
                type:       'jsonata',
                expression: '"string value"',
            };

            expect(transformer.transform({}, mapping)).rejects.toThrow(
                /must return an object/
            );
        });

        test('should throw error if expression returns array', async () => {
            const mapping: ArgumentMapping = {
                type:       'jsonata',
                expression: '[1, 2, 3]',
            };

            expect(transformer.transform({}, mapping)).rejects.toThrow(
                /must return an object/
            );
        });
    });

    describe('Unknown mapping type handling', () => {
        test('should throw error for unknown mapping type in template', () => {
            const mapping = {
                type:     'template' as const,
                mappings: {
                    field: { type: 'unknown-type' },
                },
            };

            expect(transformer.transform({}, mapping as ArgumentMapping)).rejects.toThrow(
                'Unknown parameter mapping type: unknown-type'
            );
        });

        test('should throw error for unknown top-level mapping type', () => {
            const mapping = {
                type: 'unknown-mapping-type',
            };

            expect(transformer.transform({}, mapping as ArgumentMapping)).rejects.toThrow(
                'Unknown mapping type: unknown-mapping-type'
            );
        });
    });

    describe('Error Handling', () => {
        test('should handle non-object client args gracefully', async () => {
            const mapping: ArgumentMapping = {
                type:     'template',
                mappings: {
                    value: { type: 'constant', value: 'default' },
                },
            };

            expect(await transformer.transform(null, mapping)).toEqual({ value: 'default' });
            expect(await transformer.transform(undefined, mapping)).toEqual({ value: 'default' });
            expect(await transformer.transform('string', mapping)).toEqual({ value: 'default' });
            expect(await transformer.transform(123, mapping)).toEqual({ value: 'default' });
        });

        test('should throw error for invalid JSONata expression', async () => {
            const mapping: ArgumentMapping = {
                type:       'jsonata',
                expression: '{ invalid syntax }',
            };

            expect(transformer.transform({}, mapping)).rejects.toThrow();
        });
    });

    describe('Validation', () => {
        test('should validate template mapping successfully', () => {
            const mapping: ArgumentMapping = {
                type:     'template',
                mappings: {
                    query: { type: 'passthrough', source: 'query' },
                },
            };

            const result = transformer.validate(mapping);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test('should validate JSONata mapping successfully', () => {
            const mapping: ArgumentMapping = {
                type:       'jsonata',
                expression: '{ "key": value }',
            };

            const result = transformer.validate(mapping);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test('should report error for invalid JSONata syntax', () => {
            const mapping: ArgumentMapping = {
                type:       'jsonata',
                expression: '{ invalid }',
            };

            const result = transformer.validate(mapping);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        test('should report error for empty backend parameter name', () => {
            const mapping: ArgumentMapping = {
                type:     'template',
                mappings: {
                    '': { type: 'constant', value: 'test' },
                },
            };

            const result = transformer.validate(mapping);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Backend parameter name cannot be empty');
        });

        test('should report error for empty source parameter name', () => {
            const mapping: ArgumentMapping = {
                type:     'template',
                mappings: {
                    output: { type: 'passthrough', source: '' },
                },
            };

            const result = transformer.validate(mapping);

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe('Test method', () => {
        test('should return successful result for valid transformation', async () => {
            const mapping: ArgumentMapping = {
                type:     'template',
                mappings: {
                    query: { type: 'passthrough', source: 'q' },
                },
            };

            const result = await transformer.test({ q: 'test' }, mapping);

            expect(result.success).toBe(true);
            if(result.success) {
                expect(result.output).toEqual({ query: 'test' });
            }
        });

        test('should return error result for failed transformation', async () => {
            const mapping: ArgumentMapping = {
                type:       'jsonata',
                expression: '{ invalid }',
            };

            const result = await transformer.test({}, mapping);

            expect(result.success).toBe(false);
            if(!result.success) {
                expect(result.error).toBeDefined();
            }
        });
    });

    describe('Real-world scenarios', () => {
        test('timezone example from user requirements', async () => {
            const mapping: ArgumentMapping = {
                type:     'template',
                mappings: {
                    timezone: {
                        type:      'default',
                        source:    'timezone',
                        'default': 'America/Los_Angeles',
                    },
                },
            };

            // Client doesn't provide timezone
            const result1 = await transformer.transform({}, mapping);
            expect(result1).toEqual({ timezone: 'America/Los_Angeles' });

            // Client provides timezone
            const result2 = await transformer.transform({ timezone: 'Europe/Paris' }, mapping);
            expect(result2).toEqual({ timezone: 'Europe/Paris' });
        });

        test('adding authentication credentials', async () => {
            const mapping: ArgumentMapping = {
                type:     'template',
                mappings: {
                    query:  { type: 'passthrough', source: 'query' },
                    apiKey: { type: 'constant', value: 'backend-secret-key' },
                },
            };

            const result = await transformer.transform({ query: 'search' }, mapping);

            expect(result).toEqual({
                query:  'search',
                apiKey: 'backend-secret-key',
            });
        });

        test('parameter renaming and restructuring', async () => {
            const mapping: ArgumentMapping = {
                type:       'jsonata',
                expression: `{
                    "search_params": {
                        "q": query,
                        "max_results": limit ? limit : 10,
                        "tz": timezone ? timezone : "UTC"
                    }
                }`,
            };

            const result = await transformer.transform(
                { query: 'test search', limit: 25 },
                mapping
            );

            expect(result).toEqual({
                search_params: {
                    q:           'test search',
                    max_results: 25,
                    tz:          'UTC',
                },
            });
        });
    });
});
