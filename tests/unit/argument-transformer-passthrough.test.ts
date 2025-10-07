/**
 * Tests for ArgumentTransformer passthrough-by-default behavior
 */

import { describe, test, expect } from 'bun:test';
import { ArgumentTransformer } from '../../src/middleware/argument-transformer.js';
import type { ArgumentMapping } from '../../src/types/config.js';

describe('ArgumentTransformer - Passthrough by Default', () => {
    const transformer = new ArgumentTransformer();

    test('should pass through unmapped parameters', async () => {
        const mapping: ArgumentMapping = {
            type:     'template',
            mappings: {
                provider: { type: 'constant', value: 'perplexity' },
            },
        };

        const result = await transformer.transform(
            { query: 'test search', limit: 10 },
            mapping
        );

        expect(result).toEqual({
            query:    'test search',
            limit:    10,
            provider: 'perplexity',
        });
    });

    test('should override client value with constant and pass through others', async () => {
        const mapping: ArgumentMapping = {
            type:     'template',
            mappings: {
                mode: { type: 'constant', value: 'production' },
            },
        };

        const result = await transformer.transform(
            { mode: 'development', other: 'value', extra: 123 },
            mapping
        );

        expect(result).toEqual({
            mode:  'production',
            other: 'value',
            extra: 123,
        });
    });

    test('omit mapping should remove parameter while passing through others', async () => {
        const mapping: ArgumentMapping = {
            type:     'template',
            mappings: {
                secret: { type: 'omit' },
            },
        };

        const result = await transformer.transform(
            { query: 'test', secret: 'private', limit: 10 },
            mapping
        );

        expect(result).toEqual({ query: 'test', limit: 10 });
        expect(result).not.toHaveProperty('secret');
    });

    test('ai_search scenario - constant provider with passthrough query', async () => {
        const mapping: ArgumentMapping = {
            type:     'template',
            mappings: {
                provider: { type: 'constant', value: 'perplexity' },
            },
        };

        const result = await transformer.transform(
            { query: 'What is WIC that Trump is trying to fund without appropriations?' },
            mapping
        );

        expect(result).toEqual({
            query:    'What is WIC that Trump is trying to fund without appropriations?',
            provider: 'perplexity',
        });
    });

    test('web_search scenario - constant provider with optional limit passthrough', async () => {
        const mapping: ArgumentMapping = {
            type:     'template',
            mappings: {
                provider: { type: 'constant', value: 'brave' },
            },
        };

        // With limit - should pass through
        const result1 = await transformer.transform(
            { query: 'test search', limit: 15 },
            mapping
        );
        expect(result1).toEqual({
            query:    'test search',
            limit:    15,
            provider: 'brave',
        });

        // Without limit - query still passes through
        const result2 = await transformer.transform(
            { query: 'test search' },
            mapping
        );
        expect(result2).toEqual({
            query:    'test search',
            provider: 'brave',
        });
    });

    test('rename should remove source param and passthrough others', async () => {
        const mapping: ArgumentMapping = {
            type:     'template',
            mappings: {
                user_id: { type: 'rename', source: 'userId' },
            },
        };

        const result = await transformer.transform(
            { userId: '123', query: 'test', limit: 10 },
            mapping
        );

        expect(result).toEqual({
            user_id: '123',
            query:   'test',
            limit:   10,
        });
        expect(result).not.toHaveProperty('userId');
    });

    test('default mapping with passthrough for other params', async () => {
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

        // Client provides query which should pass through
        const result1 = await transformer.transform(
            { query: 'test', limit: 10 },
            mapping
        );
        expect(result1).toEqual({
            query:    'test',
            limit:    10,
            timezone: 'America/Los_Angeles',
        });

        // Client provides timezone and other params
        const result2 = await transformer.transform(
            { timezone: 'Europe/Paris', query: 'test' },
            mapping
        );
        expect(result2).toEqual({
            timezone: 'Europe/Paris',
            query:    'test',
        });
    });

    test('combined mappings with passthrough', async () => {
        const mapping: ArgumentMapping = {
            type:     'template',
            mappings: {
                provider: { type: 'constant', value: 'brave' },
                secret:   { type: 'omit' },
                user_id:  { type: 'rename', source: 'userId' },
            },
        };

        const result = await transformer.transform(
            {
                query:  'search term',
                limit:  20,
                userId: '456',
                secret: 'should-be-removed',
                extra:  'data',
            },
            mapping
        );

        expect(result).toEqual({
            query:    'search term',
            limit:    20,
            user_id:  '456',
            provider: 'brave',
            extra:    'data',
        });
        expect(result).not.toHaveProperty('secret');
        expect(result).not.toHaveProperty('userId');
    });

    test('empty mapping passes through all parameters', async () => {
        const mapping: ArgumentMapping = {
            type:     'template',
            mappings: {},
        };

        const result = await transformer.transform(
            { query: 'test', limit: 10, provider: 'original' },
            mapping
        );

        expect(result).toEqual({
            query:    'test',
            limit:    10,
            provider: 'original',
        });
    });
});
