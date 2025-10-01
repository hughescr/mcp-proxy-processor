/**
 * Test fixtures for MCP Proxy Processor tests
 */

import type { BackendServersConfig, GroupsConfig, GroupConfig } from '../../src/types/config.js';
import type { Tool, Resource } from '@modelcontextprotocol/sdk/types';

// Valid configurations
export const validBackendConfig: BackendServersConfig = {
    mcpServers: {
        'test-server-1': {
            command: 'node',
            args:    ['server1.js'],
            env:     {
                API_KEY: 'test-key-1',
            },
        },
        'test-server-2': {
            command: 'npx',
            args:    ['-y', '@example/mcp-server'],
        },
        'minimal-server': {
            command: 'python',
        },
    },
};

export const validGroupConfig: GroupsConfig = {
    groups: {
        'test-group': {
            name:        'test-group',
            description: 'Test group for unit tests',
            tools:       [
                {
                    originalName: 'original_tool',
                    serverName:   'test-server-1',
                    name:         'renamed_tool',
                    description:  'Overridden description',
                },
                {
                    originalName: 'another_tool',
                    serverName:   'test-server-2',
                },
            ],
            resources: [
                {
                    originalUri: 'test://resource1',
                    serverName:  'test-server-1',
                    name:        'Custom Resource Name',
                },
            ],
        },
        'minimal-group': {
            name:      'minimal-group',
            tools:     [],
            resources: [],
        },
    },
};

// Invalid configurations
export const invalidBackendConfig = {
    mcpServers: {
        'invalid-server': {
            // Missing required 'command' field
            args: ['test'],
        },
    },
};

export const invalidGroupConfig = {
    groups: {
        'invalid-group': {
            // Missing required 'name' field
            tools: [
                {
                    // Missing required 'originalName' and 'serverName'
                    description: 'Some tool',
                },
            ],
        },
    },
};

// Mock backend tools and resources
export const mockBackendTools = new Map<string, Tool[]>([
    [
        'test-server-1',
        [
            {
                name:        'original_tool',
                description: 'Original tool description',
                inputSchema: {
                    type:       'object',
                    properties: {
                        param1: {
                            type:        'string',
                            description: 'First parameter',
                        },
                    },
                    required: ['param1'],
                },
            },
            {
                name:        'unused_tool',
                description: 'This tool is not used by any group',
                inputSchema: {
                    type: 'object',
                },
            },
        ],
    ],
    [
        'test-server-2',
        [
            {
                name:        'another_tool',
                description: 'Another tool from server 2',
                inputSchema: {
                    type:       'object',
                    properties: {
                        value: {
                            type: 'number',
                        },
                    },
                },
            },
        ],
    ],
]);

export const mockBackendResources = new Map<string, Resource[]>([
    [
        'test-server-1',
        [
            {
                uri:         'test://resource1',
                name:        'Original Resource',
                description: 'Original resource description',
                mimeType:    'text/plain',
            },
            {
                uri:         'test://resource2',
                name:        'Unused Resource',
                description: 'This resource is not used by any group',
                mimeType:    'application/json',
            },
        ],
    ],
    [
        'test-server-2',
        [
            {
                uri:         'test://resource3',
                name:        'Server 2 Resource',
                description: 'Resource from server 2',
                mimeType:    'text/html',
            },
        ],
    ],
]);

// Edge case configurations
export const emptyBackendConfig: BackendServersConfig = {
    mcpServers: {},
};

export const emptyGroupConfig: GroupsConfig = {
    groups: {},
};

export const groupWithSchemaOverride: GroupConfig = {
    name:        'schema-override-group',
    description: 'Group with schema overrides',
    tools:       [
        {
            originalName: 'original_tool',
            serverName:   'test-server-1',
            name:         'tool_with_override',
            description:  'Tool with complete override',
            inputSchema:  {
                type:       'object',
                properties: {
                    newParam: {
                        type:        'string',
                        description: 'New parameter',
                    },
                },
                required: ['newParam'],
            },
        },
    ],
    resources: [],
};

export const groupWithDuplicateTools: GroupConfig = {
    name:  'duplicate-tools-group',
    tools: [
        {
            originalName: 'original_tool',
            serverName:   'test-server-1',
            name:         'renamed_tool_1',
        },
        {
            originalName: 'original_tool',
            serverName:   'test-server-1',
            name:         'renamed_tool_2',
        },
    ],
    resources: [],
};

export const groupWithMissingBackendTool: GroupConfig = {
    name:  'missing-backend-group',
    tools: [
        {
            originalName: 'non_existent_tool',
            serverName:   'test-server-1',
        },
    ],
    resources: [],
};

// Helper function to create temporary config files
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

export async function createTempConfigFile(config: unknown): Promise<string> {
    const tempDir = tmpdir();
    const fileName = `test-config-${randomBytes(8).toString('hex')}.json`;
    const filePath = join(tempDir, fileName);
    await writeFile(filePath, JSON.stringify(config, null, 2));
    return filePath;
}

// Mock MCP client responses for integration tests
export const mockToolCallResponse = {
    content: [
        {
            type: 'text',
            text: 'Tool executed successfully',
        },
    ],
    isError: false,
};

export const mockResourceReadResponse = {
    contents: [
        {
            uri:      'test://resource1',
            mimeType: 'text/plain',
            text:     'Resource content',
        },
    ],
};

export const mockToolCallError = {
    content: [
        {
            type: 'text',
            text: 'Tool execution failed',
        },
    ],
    isError: true,
};
