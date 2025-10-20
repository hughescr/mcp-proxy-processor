/**
 * Stub MCP server for integration testing
 * Implements minimal MCP protocol over stdio transport
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import type {
    CallToolResult,
    ListToolsResult
} from '@modelcontextprotocol/sdk/types.js';

// Create MCP server
const server = new Server(
    {
        name:    'stub-mcp-server',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// Register a simple test tool
server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
    tools: [
        {
            name:        'test_echo',
            description: 'A simple test tool that echoes back input',
            inputSchema: {
                type:       'object',
                properties: {
                    message: {
                        type:        'string',
                        description: 'Message to echo back',
                    },
                },
                required: ['message'],
            },
        },
    ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name: toolName, arguments: args } = request.params;
    if(toolName === 'test_echo') {
        const message = (args as { message?: string }).message ?? '';
        return {
            content: [
                {
                    type: 'text',
                    text: `Echo: ${message}`,
                },
            ],
        };
    }

    throw new Error(`Unknown tool: ${toolName}`);
});

// Start server with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

// Keep process alive
process.on('SIGINT', () => {
    void server.close().then(() => {
        throw new Error('SIGINT received');
    });
});
