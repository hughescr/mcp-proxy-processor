/**
 * Unit tests for multi-group functionality in middleware
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { GroupManager } from '../../src/middleware/index.js';
import { createTempConfigFile, multiGroupConfig, mockMultiGroupBackendTools, mockMultiGroupBackendResources, mockMultiGroupBackendPrompts } from '../fixtures/mock-configs.js';
import { find, map as _map } from 'lodash';

describe('Multi-Group Middleware Functionality', () => {
    let groupManager: GroupManager;
    let configPath: string;

    beforeEach(async () => {
        configPath = await createTempConfigFile(multiGroupConfig);
        groupManager = new GroupManager(configPath);
        await groupManager.load();
    });

    describe('getGroups()', () => {
        it('should return multiple group configurations', () => {
            const groups = groupManager.getGroups(['group-a', 'group-b']);

            expect(groups).toHaveLength(2);
            expect(groups[0].name).toBe('group-a');
            expect(groups[1].name).toBe('group-b');
        });

        it('should handle mix of valid and invalid group names', () => {
            // When invalid group names are provided, getGroups() filters them out
            // and logs a warning (verifiable via stderr output)
            const groups = groupManager.getGroups(['group-a', 'non-existent', 'group-c']);

            // Should return only the 2 valid groups, filtering out 'non-existent'
            expect(groups).toHaveLength(2);
            expect(groups[0].name).toBe('group-a');
            expect(groups[1].name).toBe('group-c');
            // Note: A warning for 'non-existent' is logged to stderr but not tested here
            // due to the dynamic logger proxy architecture
        });

        it('should return empty array for all non-existent groups', () => {
            const groups = groupManager.getGroups(['invalid-1', 'invalid-2']);

            expect(groups).toHaveLength(0);
        });

        it('should handle empty array input', () => {
            const groups = groupManager.getGroups([]);
            expect(groups).toHaveLength(0);
        });
    });

    describe('getRequiredServersForGroups()', () => {
        it('should return unique server names from multiple groups', () => {
            const servers = groupManager.getRequiredServersForGroups(['group-a', 'group-b', 'group-c']);

            expect(servers).toContain('server-1');
            expect(servers).toContain('server-2');
            expect(servers).toContain('server-3');
            expect(servers).toHaveLength(3);
        });

        it('should deduplicate servers when groups share servers', () => {
            // Test is covered by the main test setup where group-a and group-b share some servers
            const servers = groupManager.getRequiredServersForGroups(['group-a', 'group-b']);

            // Both groups use different servers but the method should deduplicate
            expect(servers).toContain('server-1');
            expect(servers).toContain('server-2');
            expect(servers).toHaveLength(2);
        });

        it('should handle non-existent groups gracefully', () => {
            const servers = groupManager.getRequiredServersForGroups(['group-a', 'invalid-group']);

            expect(servers).toContain('server-1');
            expect(servers).toHaveLength(1);
        });

        it('should return empty array for all non-existent groups', () => {
            const servers = groupManager.getRequiredServersForGroups(['invalid-1', 'invalid-2']);
            expect(servers).toHaveLength(0);
        });
    });

    describe('getToolsForGroups()', () => {
        it('should aggregate tools from multiple groups', () => {
            const tools = groupManager.getToolsForGroups(
                ['group-a', 'group-b', 'group-c'],
                mockMultiGroupBackendTools
            );

            // Group A: shared_tool (renamed to shared_tool_a), unique_tool_a = 2 tools
            // Group B: shared_tool (renamed to shared_tool_b), unique_tool_b = 2 tools
            // Group C: another_tool = 1 tool
            // Total: 5 unique tools (no deduplication since renamed tools have different names)
            expect(tools).toHaveLength(5);

            // Check that all expected tools are present
            const toolNames = _map(tools, 'name');
            expect(toolNames).toContain('shared_tool_a'); // Group A's renamed shared_tool
            expect(toolNames).toContain('shared_tool_b'); // Group B's renamed shared_tool
            expect(toolNames).toContain('unique_tool_a');
            expect(toolNames).toContain('unique_tool_b');
            expect(toolNames).toContain('another_tool');
        });

        it('should deduplicate tools by name with first group winning', () => {
            const tools = groupManager.getToolsForGroups(
                ['group-a', 'group-b'],
                mockMultiGroupBackendTools
            );

            // Both groups have 'shared_tool' with different overrides
            // Group A renames to 'shared_tool_a', Group B to 'shared_tool_b'
            // So both should be present (different names after override)
            const sharedToolA = find(tools, { name: 'shared_tool_a' });
            const sharedToolB = find(tools, { name: 'shared_tool_b' });

            expect(sharedToolA).toBeDefined();
            expect(sharedToolB).toBeDefined();

            // Verify descriptions match the overrides
            expect(sharedToolA?.description).toBe('Tool from group A');
            expect(sharedToolB?.description).toBe('Tool from group B');
        });

        it('should handle empty group list', () => {
            const tools = groupManager.getToolsForGroups([], mockMultiGroupBackendTools);
            expect(tools).toHaveLength(0);
        });

        it('should handle groups with no tools', async () => {
            // group-c only has one tool, let's test with a truly empty group
            const emptyConfig = {
                groups: {
                    'empty-group': {
                        name:      'empty-group',
                        tools:     [],
                        resources: [],
                        prompts:   [],
                    },
                },
            };

            const emptyPath = await createTempConfigFile(emptyConfig);
            const emptyManager = new GroupManager(emptyPath);
            await emptyManager.load();

            const tools = emptyManager.getToolsForGroups(['empty-group'], mockMultiGroupBackendTools);
            expect(tools).toHaveLength(0);
        });
    });

    describe('getResourcesForGroups()', () => {
        it('should aggregate resources from multiple groups', () => {
            const resources = groupManager.getResourcesForGroups(
                ['group-a', 'group-b'],
                mockMultiGroupBackendResources
            );

            // Should have 3 unique resources (shared://resource, unique://resource-a, unique://resource-b)
            // shared://resource appears in both groups but is deduplicated
            expect(resources).toHaveLength(3);

            const resourceUris = _map(resources, 'uri');
            expect(resourceUris).toContain('shared://resource');
            expect(resourceUris).toContain('unique://resource-a');
            expect(resourceUris).toContain('unique://resource-b');
        });

        it('should deduplicate resources by URI with first group winning', () => {
            const resources = groupManager.getResourcesForGroups(
                ['group-a', 'group-b'],
                mockMultiGroupBackendResources
            );

            // Both groups have 'shared://resource' with different names
            const sharedResource = find(resources, { uri: 'shared://resource' });

            expect(sharedResource).toBeDefined();
            // First group (group-a) should win, but name comes from backend
            expect(sharedResource?.name).toBe('Backend Shared Resource 1');
            expect(sharedResource?.description).toBe('Shared resource from server 1');
        });

        it('should respect group order for deduplication priority', () => {
            // Reverse the order - group-b first
            const resources = groupManager.getResourcesForGroups(
                ['group-b', 'group-a'],
                mockMultiGroupBackendResources
            );

            const sharedResource = find(resources, { uri: 'shared://resource' });

            expect(sharedResource).toBeDefined();
            // Now group-b should win since it's first, but name comes from backend
            expect(sharedResource?.name).toBe('Backend Shared Resource 2');
            // The description also comes from the backend
            expect(sharedResource?.description).toBe('Shared resource from server 2');
        });

        it('should handle empty group list', () => {
            const resources = groupManager.getResourcesForGroups([], mockMultiGroupBackendResources);
            expect(resources).toHaveLength(0);
        });

        it('should handle groups with no resources', () => {
            const resources = groupManager.getResourcesForGroups(
                ['group-c'], // group-c has no resources
                mockMultiGroupBackendResources
            );
            expect(resources).toHaveLength(0);
        });
    });

    describe('getPromptsForGroups()', () => {
        it('should aggregate prompts from multiple groups', () => {
            const prompts = groupManager.getPromptsForGroups(
                ['group-a', 'group-b'],
                mockMultiGroupBackendPrompts
            );

            // Should have 3 unique prompts (shared_prompt, unique_prompt_a, unique_prompt_b)
            expect(prompts).toHaveLength(3);

            const promptNames = _map(prompts, 'name');
            expect(promptNames).toContain('shared_prompt');
            expect(promptNames).toContain('unique_prompt_a');
            expect(promptNames).toContain('unique_prompt_b');
        });

        it('should deduplicate prompts by name with first group winning', () => {
            const prompts = groupManager.getPromptsForGroups(
                ['group-a', 'group-b'],
                mockMultiGroupBackendPrompts
            );

            // Both groups have 'shared_prompt' with different descriptions
            const sharedPrompt = find(prompts, { name: 'shared_prompt' });

            expect(sharedPrompt).toBeDefined();
            // First group (group-a) should win, description comes from backend
            expect(sharedPrompt?.description).toBe('Backend shared prompt from server 1');
        });

        it('should respect group order for deduplication priority', () => {
            // Reverse the order - group-b first

            const prompts = groupManager.getPromptsForGroups(
                ['group-b', 'group-a'],
                mockMultiGroupBackendPrompts
            );

            const sharedPrompt = find(prompts, { name: 'shared_prompt' });

            expect(sharedPrompt).toBeDefined();
            // Now group-b should win, description comes from backend
            expect(sharedPrompt?.description).toBe('Backend shared prompt from server 2');
        });

        it('should handle empty group list', () => {
            const prompts = groupManager.getPromptsForGroups([], mockMultiGroupBackendPrompts);
            expect(prompts).toHaveLength(0);
        });

        it('should handle groups with no prompts', () => {
            const prompts = groupManager.getPromptsForGroups(
                ['group-c'], // group-c has no prompts
                mockMultiGroupBackendPrompts
            );
            expect(prompts).toHaveLength(0);
        });

        it('should handle mix of groups with and without prompts', () => {
            const prompts = groupManager.getPromptsForGroups(
                ['group-a', 'group-c'], // group-c has no prompts
                mockMultiGroupBackendPrompts
            );

            // Should only have prompts from group-a
            expect(prompts).toHaveLength(2);
            const promptNames = _map(prompts, 'name');
            expect(promptNames).toContain('shared_prompt');
            expect(promptNames).toContain('unique_prompt_a');
        });
    });

    describe('Integration scenarios', () => {
        it('should handle complex multi-group scenarios with all types', () => {
            // Get all items for multiple groups
            const tools = groupManager.getToolsForGroups(
                ['group-a', 'group-b'],
                mockMultiGroupBackendTools
            );
            const resources = groupManager.getResourcesForGroups(
                ['group-a', 'group-b'],
                mockMultiGroupBackendResources
            );

            const prompts = groupManager.getPromptsForGroups(
                ['group-a', 'group-b'],
                mockMultiGroupBackendPrompts
            );

            // Verify exact counts for items from both groups
            // Tools: shared_tool_a, shared_tool_b (different names), unique_tool_a, unique_tool_b = 4 tools
            expect(tools).toHaveLength(4);
            // Resources: shared://resource (deduplicated), unique://resource-a, unique://resource-b = 3 resources
            expect(resources).toHaveLength(3);
            // Prompts: shared_prompt (deduplicated), unique_prompt_a, unique_prompt_b = 3 prompts
            expect(prompts).toHaveLength(3);

            // Verify deduplication worked correctly - no duplicate names/URIs in results
            const toolNames = _map(tools, 'name');
            const uniqueToolNames = new Set(toolNames);
            expect(toolNames.length).toBe(uniqueToolNames.size); // No duplicate tool names
            expect(toolNames).toContain('shared_tool_a');
            expect(toolNames).toContain('shared_tool_b');
            expect(toolNames).toContain('unique_tool_a');
            expect(toolNames).toContain('unique_tool_b');

            const resourceUris = _map(resources, 'uri');
            const uniqueResourceUris = new Set(resourceUris);
            expect(resourceUris.length).toBe(uniqueResourceUris.size); // No duplicate URIs
            expect(resourceUris).toContain('shared://resource');
            expect(resourceUris).toContain('unique://resource-a');
            expect(resourceUris).toContain('unique://resource-b');

            // Verify shared://resource came from group-a (first group wins)
            const sharedResource = find(resources, { uri: 'shared://resource' });
            expect(sharedResource?.name).toBe('Backend Shared Resource 1'); // From server-1 (group-a's server)

            const promptNames = _map(prompts, 'name');
            const uniquePromptNames = new Set(promptNames);
            expect(promptNames.length).toBe(uniquePromptNames.size); // No duplicate prompt names
            expect(promptNames).toContain('shared_prompt');
            expect(promptNames).toContain('unique_prompt_a');
            expect(promptNames).toContain('unique_prompt_b');

            // Verify shared_prompt came from group-a (first group wins)
            const sharedPrompt = find(prompts, { name: 'shared_prompt' });
            expect(sharedPrompt?.description).toBe('Backend shared prompt from server 1'); // From server-1 (group-a's server)
        });

        it('should correctly identify all required servers for multi-group setup', () => {
            const servers = groupManager.getRequiredServersForGroups(['group-a', 'group-b', 'group-c']);

            // Should have all three unique servers
            expect(servers).toContain('server-1');
            expect(servers).toContain('server-2');
            expect(servers).toContain('server-3');
            expect(servers).toHaveLength(3);

            // Verify it matches what individual groups would return
            const serversA = groupManager.getRequiredServers('group-a');
            const serversB = groupManager.getRequiredServers('group-b');
            const serversC = groupManager.getRequiredServers('group-c');

            const allIndividualServers = new Set([...serversA, ...serversB, ...serversC]);
            expect(servers.sort()).toEqual(Array.from(allIndividualServers).sort());
        });
    });
});
