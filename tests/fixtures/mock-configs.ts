/**
 * Test fixtures for MCP Proxy Processor tests
 */

import type { BackendServersConfig, GroupsConfig, GroupConfig } from '../../src/types/config.js';
import type { Tool, Resource, Prompt } from '@modelcontextprotocol/sdk/types';

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
                    uri:        'test://resource1',
                    serverName: 'test-server-1',
                },
            ],
            prompts: [],
        },
        'minimal-group': {
            name:      'minimal-group',
            tools:     [],
            resources: [],
            prompts:   [],
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
    prompts:   [],
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
    prompts:   [],
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
    prompts:   [],
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

// Multi-group test configurations
export const multiGroupConfig: GroupsConfig = {
    groups: {
        'group-a': {
            name:        'group-a',
            description: 'First test group',
            tools:       [
                {
                    originalName: 'shared_tool',
                    serverName:   'server-1',
                    name:         'shared_tool_a',
                    description:  'Tool from group A',
                },
                {
                    originalName: 'unique_tool_a',
                    serverName:   'server-1',
                },
            ],
            resources: [
                {
                    uri:        'shared://resource',
                    serverName: 'server-1',
                },
                {
                    uri:        'unique://resource-a',
                    serverName: 'server-1',
                },
            ],
            prompts: [
                {
                    name:       'shared_prompt',
                    serverName: 'server-1',
                },
                {
                    name:       'unique_prompt_a',
                    serverName: 'server-1',
                },
            ],
        },
        'group-b': {
            name:        'group-b',
            description: 'Second test group',
            tools:       [
                {
                    originalName: 'shared_tool',
                    serverName:   'server-2',
                    name:         'shared_tool_b',
                    description:  'Tool from group B',
                },
                {
                    originalName: 'unique_tool_b',
                    serverName:   'server-2',
                },
            ],
            resources: [
                {
                    uri:        'shared://resource',
                    serverName: 'server-2',
                },
                {
                    uri:        'unique://resource-b',
                    serverName: 'server-2',
                },
            ],
            prompts: [
                {
                    name:       'shared_prompt',
                    serverName: 'server-2',
                },
                {
                    name:       'unique_prompt_b',
                    serverName: 'server-2',
                },
            ],
        },
        'group-c': {
            name:        'group-c',
            description: 'Third test group',
            tools:       [
                {
                    originalName: 'another_tool',
                    serverName:   'server-3',
                },
            ],
            resources: [],
            prompts:   [],
        },
    },
};

export const mockMultiGroupBackendTools = new Map<string, Tool[]>([
    [
        'server-1',
        [
            {
                name:        'shared_tool',
                description: 'Backend shared tool from server 1',
                inputSchema: { type: 'object' },
            },
            {
                name:        'unique_tool_a',
                description: 'Unique tool A',
                inputSchema: { type: 'object' },
            },
        ],
    ],
    [
        'server-2',
        [
            {
                name:        'shared_tool',
                description: 'Backend shared tool from server 2',
                inputSchema: { type: 'object' },
            },
            {
                name:        'unique_tool_b',
                description: 'Unique tool B',
                inputSchema: { type: 'object' },
            },
        ],
    ],
    [
        'server-3',
        [
            {
                name:        'another_tool',
                description: 'Another tool from server 3',
                inputSchema: { type: 'object' },
            },
        ],
    ],
]);

export const mockMultiGroupBackendResources = new Map<string, Resource[]>([
    [
        'server-1',
        [
            {
                uri:         'shared://resource',
                name:        'Backend Shared Resource 1',
                description: 'Shared resource from server 1',
            },
            {
                uri:         'unique://resource-a',
                name:        'Unique Resource A',
                description: 'Unique to server 1',
            },
        ],
    ],
    [
        'server-2',
        [
            {
                uri:         'shared://resource',
                name:        'Backend Shared Resource 2',
                description: 'Shared resource from server 2',
            },
            {
                uri:         'unique://resource-b',
                name:        'Unique Resource B',
                description: 'Unique to server 2',
            },
        ],
    ],
]);

// Properly typed mock prompts for multi-group tests
export const mockMultiGroupBackendPrompts = new Map<string, Prompt[]>([
    [
        'server-1',
        [
            {
                name:        'shared_prompt',
                description: 'Backend shared prompt from server 1',
                arguments:   [],
            },
            {
                name:        'unique_prompt_a',
                description: 'Unique prompt A',
                arguments:   [],
            },
        ],
    ],
    [
        'server-2',
        [
            {
                name:        'shared_prompt',
                description: 'Backend shared prompt from server 2',
                arguments:   [],
            },
            {
                name:        'unique_prompt_b',
                description: 'Unique prompt B',
                arguments:   [],
            },
        ],
    ],
]);

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
