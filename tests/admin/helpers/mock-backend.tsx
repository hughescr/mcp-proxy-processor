/**
 * Mock Backend Context for Testing Admin Components
 */

import type { Tool, Resource, Prompt } from '@modelcontextprotocol/sdk/types.js';

interface MockBackendContextValue {
    isInitialized:        boolean
    initializationError:  string | null
    discoverAllTools:     () => Promise<Map<string, Tool[]>>
    discoverAllResources: () => Promise<Map<string, Resource[]>>
    discoverAllPrompts:   () => Promise<Map<string, Prompt[]>>
    ensureServerReady:    (serverName: string) => Promise<void>
}

/**
 * Create a mock backend context with configurable discovery responses
 */
export function createMockBackendContext(overrides?: Partial<MockBackendContextValue>): MockBackendContextValue {
    return {
        isInitialized:        true,
        initializationError:  null,
        discoverAllTools:     async () => new Map(),
        discoverAllResources: async () => new Map(),
        discoverAllPrompts:   async () => new Map(),
        ensureServerReady:    async () => {
            // Mock implementation - does nothing
        },
        ...overrides,
    };
}

/**
 * Create mock tool data for testing
 */
export function createMockTools(serverName: string, count: number): Tool[] {
    return Array.from({ length: count }, (_, i) => ({
        name:        `tool_${i}`,
        description: `Description for tool ${i} from ${serverName}`,
        inputSchema: {
            type:       'object',
            properties: {
                param: { type: 'string', description: 'A parameter' },
            },
        },
    }));
}

/**
 * Create mock resource data for testing
 */
export function createMockResources(serverName: string, count: number): Resource[] {
    return Array.from({ length: count }, (_, i) => ({
        uri:         `test://${serverName}/resource_${i}`,
        name:        `Resource ${i}`,
        description: `Description for resource ${i} from ${serverName}`,
        mimeType:    'text/plain',
    }));
}

/**
 * Create mock prompt data for testing
 */
export function createMockPrompts(serverName: string, count: number): Prompt[] {
    return Array.from({ length: count }, (_, i) => ({
        name:        `prompt_${i}`,
        description: `Description for prompt ${i} from ${serverName}`,
    }));
}
