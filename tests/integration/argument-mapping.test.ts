/**
 * Integration test for argument mapping functionality
 */

import { describe, test, expect } from 'bun:test';
import { find } from 'lodash';
import { ArgumentTransformer } from '../../src/middleware/argument-transformer.js';
import { GroupManager } from '../../src/middleware/index.js';
import type { ArgumentMapping } from '../../src/types/config.js';

describe('Argument Mapping Integration', () => {
    test('should load group configuration with argument mapping', async () => {
        const groupManager = new GroupManager('config/groups.json');
        await groupManager.load();

        const group = groupManager.getGroup('standard_tools');
        expect(group).toBeDefined();

        // Find the get_current_time tool
        const timeTool = find(group?.tools, { originalName: 'get_current_time' });
        expect(timeTool).toBeDefined();
        expect(timeTool?.argumentMapping).toBeDefined();
        expect(timeTool?.argumentMapping?.type).toBe('template');
    });

    test('should transform timezone argument with default value', async () => {
        const transformer = new ArgumentTransformer();

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

        // Test with no timezone provided
        const result1 = await transformer.transform({}, mapping);
        expect(result1).toEqual({ timezone: 'America/Los_Angeles' });

        // Test with timezone provided
        const result2 = await transformer.transform({ timezone: 'Europe/Paris' }, mapping);
        expect(result2).toEqual({ timezone: 'Europe/Paris' });
    });

    test('should validate the configured argument mapping', async () => {
        const groupManager = new GroupManager('config/groups.json');
        await groupManager.load();

        const group = groupManager.getGroup('standard_tools');
        const timeTool = find(group?.tools, { originalName: 'get_current_time' });

        if(timeTool?.argumentMapping) {
            const transformer = new ArgumentTransformer();
            const validation = transformer.validate(timeTool.argumentMapping);

            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);
        }
    });

    test('end-to-end: group config → transformer → backend args', async () => {
        // Load the group config
        const groupManager = new GroupManager('config/groups.json');
        await groupManager.load();

        const group = groupManager.getGroup('standard_tools');
        const timeTool = find(group?.tools, { originalName: 'get_current_time' });

        expect(timeTool?.argumentMapping).toBeDefined();

        // Create transformer and apply the mapping
        const transformer = new ArgumentTransformer();

        // Simulate client calling without timezone
        const clientArgs = {};
        const backendArgs = await transformer.transform(clientArgs, timeTool!.argumentMapping!);

        // Backend should receive the default timezone
        expect(backendArgs).toEqual({ timezone: 'America/Los_Angeles' });

        // Simulate client calling with timezone
        const clientArgs2 = { timezone: 'Asia/Tokyo' };
        const backendArgs2 = await transformer.transform(clientArgs2, timeTool!.argumentMapping!);

        // Backend should receive the client's timezone
        expect(backendArgs2).toEqual({ timezone: 'Asia/Tokyo' });
    });
});
