/**
 * Mock MCP client and server utilities for testing
 */

import type { Tool, Resource } from '@modelcontextprotocol/sdk/types.js';

/**
 * Mock tool definition for testing
 */
export interface MockTool extends Tool {
    name:         string
    description?: string
    inputSchema: {
        type:          'object'
        properties?:   Record<string, unknown>
        required?:     string[]
        [key: string]: unknown
    }
}

/**
 * Mock resource definition for testing
 */
export interface MockResource extends Resource {
    uri:          string
    name:         string
    description?: string
    mimeType?:    string
}

/**
 * Mock MCP client implementation for testing
 */
export class MockMCPClient {
    private _tools:     MockTool[] = [];
    private _resources: MockResource[] = [];
    private _connected = false;
    private _toolHandlers = new Map<string, (args: Record<string, unknown>) => unknown>();

    constructor(
        public serverName: string,
        tools: MockTool[] = [],
        resources: MockResource[] = []
    ) {
        this._tools = tools;
        this._resources = resources;
    }

    /**
     * Simulate connecting to the backend server
     */
    async connect(): Promise<void> {
        this._connected = true;
    }

    /**
     * Simulate disconnecting from the backend server
     */
    async disconnect(): Promise<void> {
        this._connected = false;
    }

    /**
     * Check if client is connected
     */
    isConnected(): boolean {
        return this._connected;
    }

    /**
     * Get list of tools
     */
    async listTools(): Promise<{ tools: MockTool[] }> {
        if(!this._connected) {
            throw new Error('Client not connected');
        }
        return { tools: this._tools };
    }

    /**
     * Get list of resources
     */
    async listResources(): Promise<{ resources: MockResource[] }> {
        if(!this._connected) {
            throw new Error('Client not connected');
        }
        return { resources: this._resources };
    }

    /**
     * Call a tool
     */
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        if(!this._connected) {
            throw new Error('Client not connected');
        }
        const handler = this._toolHandlers.get(name);
        if(!handler) {
            throw new Error(`Tool "${name}" not found`);
        }
        return handler(args);
    }

    /**
     * Register a tool handler (for testing tool calls)
     */
    registerToolHandler(name: string, handler: (args: Record<string, unknown>) => unknown): void {
        this._toolHandlers.set(name, handler);
    }

    /**
     * Add a tool to the mock client
     */
    addTool(tool: MockTool): void {
        this._tools.push(tool);
    }

    /**
     * Add a resource to the mock client
     */
    addResource(resource: MockResource): void {
        this._resources.push(resource);
    }
}

/**
 * Create a mock MCP client for testing
 */
export function createMockClient(
    serverName: string,
    tools: MockTool[] = [],
    resources: MockResource[] = []
): MockMCPClient {
    return new MockMCPClient(serverName, tools, resources);
}

/**
 * Create a mock tool definition
 */
export function createMockTool(overrides: Partial<MockTool> = {}): MockTool {
    return {
        name:        'mock_tool',
        description: 'Mock tool for testing',
        inputSchema: {
            type:       'object',
            properties: {
                arg1: { type: 'string' },
            },
            required: ['arg1'],
        },
        ...overrides,
    };
}

/**
 * Create a mock resource definition
 */
export function createMockResource(overrides: Partial<MockResource> = {}): MockResource {
    return {
        uri:         'mock://resource',
        name:        'Mock Resource',
        description: 'Mock resource for testing',
        mimeType:    'text/plain',
        ...overrides,
    };
}

/**
 * Create a collection of mock tools for common test scenarios
 */
export function createMockToolCollection(): Record<string, MockTool> {
    return {
        calculate: {
            name:        'calculate',
            description: 'Perform mathematical calculations',
            inputSchema: {
                type:       'object',
                properties: {
                    expression: {
                        type:        'string',
                        description: 'Mathematical expression to evaluate',
                    },
                },
                required: ['expression'],
            },
        },
        getCurrentTime: {
            name:        'get_current_time',
            description: 'Get the current time',
            inputSchema: {
                type:       'object',
                properties: {
                    timezone: {
                        type:        'string',
                        description: 'Timezone for the time',
                    },
                },
            },
        },
        solve: {
            name:        'solve',
            description: 'Solve algebraic equations',
            inputSchema: {
                type:       'object',
                properties: {
                    equation: {
                        type:        'string',
                        description: 'Equation to solve',
                    },
                },
                required: ['equation'],
            },
        },
    };
}

/**
 * Create a collection of mock resources for common test scenarios
 */
export function createMockResourceCollection(): Record<string, MockResource> {
    return {
        config: {
            uri:         'config://app',
            name:        'Application Configuration',
            description: 'Current application configuration',
            mimeType:    'application/json',
        },
        docs: {
            uri:         'docs://readme',
            name:        'Documentation',
            description: 'Application documentation',
            mimeType:    'text/markdown',
        },
    };
}
