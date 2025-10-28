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

        describe('Complex JSONata expressions', () => {
            describe('Array operations', () => {
                test('should transform arrays with $map', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "doubled": $map(items, function($v) { $v * 2 }) }',
                    };

                    const result = await transformer.transform(
                        { items: [1, 2, 3, 4, 5] },
                        mapping
                    );

                    expect(result).toEqual({ doubled: [2, 4, 6, 8, 10] });
                });

                test('should filter arrays with predicates', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "filtered": items[$ > 5] }',
                    };

                    const result = await transformer.transform(
                        { items: [1, 10, 3, 15, 7] },
                        mapping
                    );

                    expect(result).toEqual({ filtered: [10, 15, 7] });
                });

                test('should sort arrays', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "sorted": $sort(items) }',
                    };

                    const result = await transformer.transform(
                        { items: [5, 2, 8, 1, 9] },
                        mapping
                    );

                    expect(result).toEqual({ sorted: [1, 2, 5, 8, 9] });
                });

                test('should sort objects by property', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "sorted": $sort(users, function($a, $b) { $a.age > $b.age }) }',
                    };

                    const result = await transformer.transform(
                        {
                            users: [
                                { name: 'Bob', age: 30 },
                                { name: 'Alice', age: 25 },
                                { name: 'Charlie', age: 35 },
                            ],
                        },
                        mapping
                    );

                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- JSONata result is untyped
                    expect((result.sorted as any)[0].name).toBe('Alice');
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- JSONata result is untyped
                    expect((result.sorted as any)[2].name).toBe('Charlie');
                });

                test('should reduce arrays', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "product": $reduce(numbers, function($acc, $val) { $acc * $val }, 1) }',
                    };

                    const result = await transformer.transform(
                        { numbers: [2, 3, 4] },
                        mapping
                    );

                    expect(result).toEqual({ product: 24 });
                });

                test('should handle array spread and construction', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "combined": $append(first, second) }',
                    };

                    const result = await transformer.transform(
                        {
                            first:  [1, 2, 3],
                            second: [4, 5, 6],
                        },
                        mapping
                    );

                    expect(result).toEqual({ combined: [1, 2, 3, 4, 5, 6] });
                });

                test('should access array elements by index', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "first": items[0], "last": items[-1] }',
                    };

                    const result = await transformer.transform(
                        { items: ['a', 'b', 'c', 'd'] },
                        mapping
                    );

                    expect(result).toEqual({ first: 'a', last: 'd' });
                });

                test('should flatten nested arrays', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "flat": $reduce(nested, function($acc, $val) { $append($acc, $val) }, []) }',
                    };

                    const result = await transformer.transform(
                        { nested: [[1, 2], [3, 4], [5, 6]] },
                        mapping
                    );

                    expect(result).toEqual({ flat: [1, 2, 3, 4, 5, 6] });
                });
            });

            describe('String functions', () => {
                test('should handle string case transformations', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "upper": $uppercase(name), "lower": $lowercase(name) }',
                    };

                    const result = await transformer.transform(
                        { name: 'John Doe' },
                        mapping
                    );

                    expect(result).toEqual({
                        upper: 'JOHN DOE',
                        lower: 'john doe',
                    });
                });

                test('should split and join strings', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "parts": $split(name, " "), "joined": $join($split(name, " "), "-") }',
                    };

                    const result = await transformer.transform(
                        { name: 'john doe smith' },
                        mapping
                    );

                    expect(result).toEqual({
                        parts:  ['john', 'doe', 'smith'],
                        joined: 'john-doe-smith',
                    });
                });

                test('should substring and trim strings', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "substr": $substring(text, 0, 5), "trimmed": $trim(text) }',
                    };

                    const result = await transformer.transform(
                        { text: '  Hello World  ' },
                        mapping
                    );

                    expect(result).toEqual({
                        substr:  '  Hel',
                        trimmed: 'Hello World',
                    });
                });

                test('should get string length', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "length": $length(text) }',
                    };

                    const result = await transformer.transform(
                        { text: 'Hello' },
                        mapping
                    );

                    expect(result).toEqual({ length: 5 });
                });

                test('should handle string concatenation', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "full": first & " " & last }',
                    };

                    const result = await transformer.transform(
                        { first: 'John', last: 'Doe' },
                        mapping
                    );

                    expect(result).toEqual({ full: 'John Doe' });
                });

                test('should match strings with regex', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "matches": $match(email, /^[a-z]+@[a-z]+\\.[a-z]+$/) != null }',
                    };

                    const result1 = await transformer.transform(
                        { email: 'test@example.com' },
                        mapping
                    );
                    expect(result1).toEqual({ matches: true });

                    const result2 = await transformer.transform(
                        { email: 'invalid-email' },
                        mapping
                    );
                    expect(result2).toEqual({ matches: false });
                });

                test('should replace strings', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "replaced": $replace(text, "world", "universe") }',
                    };

                    const result = await transformer.transform(
                        { text: 'hello world' },
                        mapping
                    );

                    expect(result).toEqual({ replaced: 'hello universe' });
                });
            });

            describe('Aggregation functions', () => {
                test('should sum numbers', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "total": $sum(prices) }',
                    };

                    const result = await transformer.transform(
                        { prices: [10, 20, 30, 40] },
                        mapping
                    );

                    expect(result).toEqual({ total: 100 });
                });

                test('should calculate average', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "avg": $average(scores) }',
                    };

                    const result = await transformer.transform(
                        { scores: [80, 90, 100, 70] },
                        mapping
                    );

                    expect(result).toEqual({ avg: 85 });
                });

                test('should find min and max', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "min": $min(values), "max": $max(values) }',
                    };

                    const result = await transformer.transform(
                        { values: [5, 2, 8, 1, 9, 3] },
                        mapping
                    );

                    expect(result).toEqual({ min: 1, max: 9 });
                });

                test('should count array items', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "count": $count(items) }',
                    };

                    const result = await transformer.transform(
                        { items: ['a', 'b', 'c', 'd', 'e'] },
                        mapping
                    );

                    expect(result).toEqual({ count: 5 });
                });

                test('should combine aggregations', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "stats": { "total": $sum(numbers), "avg": $average(numbers), "count": $count(numbers) } }',
                    };

                    const result = await transformer.transform(
                        { numbers: [10, 20, 30] },
                        mapping
                    );

                    expect(result).toEqual({
                        stats: {
                            total: 60,
                            avg:   20,
                            count: 3,
                        },
                    });
                });
            });

            describe('Conditional expressions', () => {
                test('should apply ternary conditionals', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "status": age >= 18 ? "adult" : "minor" }',
                    };

                    const result1 = await transformer.transform({ age: 20 }, mapping);
                    expect(result1).toEqual({ status: 'adult' });

                    const result2 = await transformer.transform({ age: 15 }, mapping);
                    expect(result2).toEqual({ status: 'minor' });
                });

                test('should handle nested conditionals', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "grade": score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : "F" }',
                    };

                    expect(await transformer.transform({ score: 95 }, mapping)).toEqual({ grade: 'A' });
                    expect(await transformer.transform({ score: 85 }, mapping)).toEqual({ grade: 'B' });
                    expect(await transformer.transform({ score: 75 }, mapping)).toEqual({ grade: 'C' });
                    expect(await transformer.transform({ score: 60 }, mapping)).toEqual({ grade: 'F' });
                });

                test('should use boolean logic', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "valid": age >= 18 and verified = true }',
                    };

                    const result1 = await transformer.transform(
                        { age: 20, verified: true },
                        mapping
                    );
                    expect(result1).toEqual({ valid: true });

                    const result2 = await transformer.transform(
                        { age: 20, verified: false },
                        mapping
                    );
                    expect(result2).toEqual({ valid: false });
                });

                test('should handle existence checks', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "hasEmail": $exists(email), "hasPhone": $exists(phone) }',
                    };

                    const result = await transformer.transform(
                        { email: 'test@example.com' },
                        mapping
                    );

                    expect(result).toEqual({ hasEmail: true, hasPhone: false });
                });
            });

            describe('Nested object access', () => {
                test('should handle nested property access', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "userName": user.profile.name, "userAge": user.profile.age }',
                    };

                    const result = await transformer.transform(
                        {
                            user: {
                                profile: {
                                    name: 'Alice',
                                    age:  30,
                                },
                            },
                        },
                        mapping
                    );

                    expect(result).toEqual({
                        userName: 'Alice',
                        userAge:  30,
                    });
                });

                test('should handle array of objects with property extraction', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "names": users.name, "totalAge": $sum(users.age) }',
                    };

                    const result = await transformer.transform(
                        {
                            users: [
                                { name: 'Alice', age: 30 },
                                { name: 'Bob', age: 25 },
                                { name: 'Charlie', age: 35 },
                            ],
                        },
                        mapping
                    );

                    expect(result).toEqual({
                        names:    ['Alice', 'Bob', 'Charlie'],
                        totalAge: 90,
                    });
                });

                test('should handle wildcard descent', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "allIds": $distinct(data.**.id) }',
                    };

                    const result = await transformer.transform(
                        {
                            data: {
                                id:    1,
                                items: [
                                    { id: 2 },
                                    { id: 3, nested: { id: 4 } },
                                ],
                            },
                        },
                        mapping
                    );

                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- JSONata result is untyped
                    expect((result as any).allIds).toContain(1);
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- JSONata result is untyped
                    expect((result as any).allIds).toContain(2);
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- JSONata result is untyped
                    expect((result as any).allIds).toContain(3);
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- JSONata result is untyped
                    expect((result as any).allIds).toContain(4);
                });

                test('should filter nested arrays', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "activeUsers": users[active = true].name }',
                    };

                    const result = await transformer.transform(
                        {
                            users: [
                                { name: 'Alice', active: true },
                                { name: 'Bob', active: false },
                                { name: 'Charlie', active: true },
                            ],
                        },
                        mapping
                    );

                    expect(result).toEqual({ activeUsers: ['Alice', 'Charlie'] });
                });
            });

            describe('Complex transformations', () => {
                test('should handle multi-level nested transformations', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: `{
                            "summary": {
                                "names": users.name,
                                "stats": {
                                    "total": $count(users),
                                    "avgAge": $average(users.age),
                                    "adults": $count(users[age >= 18])
                                }
                            }
                        }`,
                    };

                    const result = await transformer.transform(
                        {
                            users: [
                                { name: 'Alice', age: 30 },
                                { name: 'Bob', age: 25 },
                                { name: 'Charlie', age: 17 },
                            ],
                        },
                        mapping
                    );

                    expect(result).toEqual({
                        summary: {
                            names: ['Alice', 'Bob', 'Charlie'],
                            stats: {
                                total:  3,
                                avgAge: 24,
                                adults: 2,
                            },
                        },
                    });
                });

                test('should transform with multiple data sources', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: `{
                            "report": {
                                "user": username,
                                "itemCount": $count(items),
                                "totalValue": $sum(items.price),
                                "date": timestamp
                            }
                        }`,
                    };

                    const result = await transformer.transform(
                        {
                            username:  'john',
                            timestamp: '2024-01-01',
                            items:     [
                                { name: 'item1', price: 10 },
                                { name: 'item2', price: 20 },
                                { name: 'item3', price: 30 },
                            ],
                        },
                        mapping
                    );

                    expect(result).toEqual({
                        report: {
                            user:       'john',
                            itemCount:  3,
                            totalValue: 60,
                            date:       '2024-01-01',
                        },
                    });
                });

                test('should handle grouping operations', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: `{
                            "byCategory": items{category: [name]}
                        }`,
                    };

                    const result = await transformer.transform(
                        {
                            items: [
                                { name: 'apple', category: 'fruit' },
                                { name: 'carrot', category: 'vegetable' },
                                { name: 'banana', category: 'fruit' },
                            ],
                        },
                        mapping
                    );

                    expect(result.byCategory).toEqual({
                        fruit:     ['apple', 'banana'],
                        vegetable: ['carrot'],
                    });
                });
            });

            describe('Error handling', () => {
                test('should handle undefined variables gracefully', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "value": nonExistent }',
                    };

                    const result = await transformer.transform({}, mapping);

                    expect(result).toEqual({ value: undefined });
                });

                test('should handle null values', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "value": data.field }',
                    };

                    const result = await transformer.transform({ data: null }, mapping);

                    expect(result).toEqual({ value: undefined });
                });

                test('should throw on invalid syntax', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "value": [unclosed }',
                    };

                    expect(transformer.transform({}, mapping)).rejects.toThrow();
                });

                test('should handle division by zero', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "result": value / 0 }',
                    };

                    const result = await transformer.transform({ value: 10 }, mapping);

                    expect(result.result).toBe(Infinity);
                });

                test('should handle type coercion issues', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "sum": $sum(numbers), "stringLength": $length(text) }',
                    };

                    // JSONata functions are type-strict, demonstrating both numeric and string operations
                    const result = await transformer.transform(
                        { numbers: [1, 3, 5], text: 'hello' },
                        mapping
                    );

                    expect(result.sum).toBe(9); // 1 + 3 + 5
                    expect(result.stringLength).toBe(5);
                });

                test('should handle empty arrays gracefully', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "sum": $sum(items), "avg": $average(items), "count": $count(items) }',
                    };

                    const result = await transformer.transform({ items: [] }, mapping);

                    // JSONata returns 0 for $sum of empty array, undefined for $average
                    expect(result).toEqual({
                        sum:   0,
                        avg:   undefined,
                        count: 0,
                    });
                });

                test('should handle missing required fields with defaults', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "name": name ? name : "Unknown", "age": age ? age : 0 }',
                    };

                    const result = await transformer.transform({}, mapping);

                    expect(result).toEqual({
                        name: 'Unknown',
                        age:  0,
                    });
                });
            });

            describe('Edge cases', () => {
                test('should handle very large numbers', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "result": value * 1000000 }',
                    };

                    const result = await transformer.transform(
                        { value: 9007199254740 },
                        mapping
                    );

                    expect(typeof result.result).toBe('number');
                });

                test('should handle special characters in strings', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "escaped": text }',
                    };

                    const result = await transformer.transform(
                        { text: 'Special: \n\t\r"\'\\ chars' },
                        mapping
                    );

                    expect(result.escaped).toBe('Special: \n\t\r"\'\\ chars');
                });

                test('should handle unicode characters', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "emoji": text, "length": $length(text) }',
                    };

                    const result = await transformer.transform(
                        { text: '👋 Hello 世界' },
                        mapping
                    );

                    expect(result.emoji).toBe('👋 Hello 世界');
                    expect(result.length).toBe(10);
                });

                test('should handle deeply nested objects', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "value": a.b.c.d.e.f }',
                    };

                    const result = await transformer.transform(
                        {
                            a: {
                                b: {
                                    c: {
                                        d: {
                                            e: { f: 'deep' },
                                        },
                                    },
                                },
                            },
                        },
                        mapping
                    );

                    expect(result).toEqual({ value: 'deep' });
                });

                test('should handle circular reference detection gracefully', async () => {
                    const mapping: ArgumentMapping = {
                        type:       'jsonata',
                        expression: '{ "name": data.name, "value": data.value }',
                    };

                    // JSONata should handle this without infinite loops
                    const circular: Record<string, unknown> = { name: 'test', value: 42 };
                    circular.self = circular;

                    const result = await transformer.transform({ data: circular }, mapping);

                    expect(result).toEqual({ name: 'test', value: 42 });
                });
            });
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
