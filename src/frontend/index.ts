/**
 * Frontend MCP Server Implementation
 *
 * This module is responsible for:
 * - Starting an MCP server using stdio transport
 * - Exposing tools/resources for a specific group
 * - Routing tool calls to appropriate backend servers
 * - Returning responses to the MCP client
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { reduce, find } from 'lodash';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from '@hughescr/logger';
import { GroupManager } from '../middleware/index.js';
import { ClientManager } from '../backend/client-manager.js';
import { DiscoveryService } from '../backend/discovery.js';
import { ProxyService } from '../backend/proxy.js';
import type { BackendServersConfig, BackendServerConfig } from '../types/config.js';
import { BackendServersConfigSchema } from '../types/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Start the MCP server for a specific group
 * @param groupName - Name of the group to serve
 */
export async function startServer(groupName: string): Promise<void> {
    logger.info({ groupName }, 'Starting MCP proxy server');

    // Configuration paths
    const configDir = join(__dirname, '../../config');
    const backendConfigPath = join(configDir, 'backend-servers.json');
    const groupsConfigPath = join(configDir, 'groups.json');

    try {
        // 1. Load group configuration
        logger.info('Loading group configuration');
        const groupManager = new GroupManager(groupsConfigPath);
        await groupManager.load();

        const group = groupManager.getGroup(groupName);
        if(!group) {
            throw new Error(`Group not found: ${groupName}`);
        }

        logger.info({ groupName, toolCount: group.tools.length, resourceCount: group.resources?.length ?? 0 }, 'Group loaded');

        // 2. Load backend server configuration
        logger.info('Loading backend server configuration');
        const backendConfigContent = await readFile(backendConfigPath, 'utf-8');
        const backendConfig: BackendServersConfig = BackendServersConfigSchema.parse(JSON.parse(backendConfigContent));

        // 3. Determine required backend servers
        const requiredServers = groupManager.getRequiredServers(groupName);
        logger.info({ requiredServers }, 'Required backend servers identified');

        if(requiredServers.length === 0) {
            throw new Error(`No backend servers required for group: ${groupName}`);
        }

        // 4. Create server configs map for required servers only
        const serverConfigs = new Map<string, BackendServerConfig>();
        for(const serverName of requiredServers) {
            const serverConfig = backendConfig.mcpServers[serverName];
            if(!serverConfig) {
                throw new Error(`Backend server config not found: ${serverName}`);
            }
            serverConfigs.set(serverName, serverConfig);
        }

        // 5. Connect to backend servers
        logger.info('Connecting to backend servers');

        const clientManager = new ClientManager(serverConfigs);
        await clientManager.connectAll();

        const connectedServers = clientManager.getConnectedServerNames();
        logger.info({ connectedServers }, 'Connected to backend servers');

        // 6. Discover tools and resources from backends
        logger.info('Discovering tools and resources from backend servers');
        const discoveryService = new DiscoveryService(clientManager);
        const backendTools = await discoveryService.discoverAllTools();
        const backendResources = await discoveryService.discoverAllResources();

        const totalBackendTools = reduce(Array.from(backendTools.values()), (sum, tools) => sum + tools.length, 0);
        const totalBackendResources = reduce(Array.from(backendResources.values()), (sum, resources) => sum + resources.length, 0);
        logger.info({ totalBackendTools, totalBackendResources }, 'Discovery completed');

        // 7. Create proxy service
        const proxyService = new ProxyService(clientManager);

        // 8. Get tools and resources for this group (with overrides applied)
        const groupTools = groupManager.getToolsForGroup(groupName, backendTools);
        const groupResources = groupManager.getResourcesForGroup(groupName, backendResources);

        logger.info({ toolCount: groupTools.length, resourceCount: groupResources.length }, 'Group tools and resources prepared');

        // 9. Create MCP server instance
        const server = new Server(
            {
                name:    `mcp-proxy-${groupName}`,
                version: '0.1.0',
            },
            {
                capabilities: {
                    tools:     {},
                    resources: {},
                },
            }
        );

        // 10. Register handlers

        // tools/list handler
        server.setRequestHandler(ListToolsRequestSchema, async () => {
            logger.debug({ toolCount: groupTools.length }, 'Handling tools/list request');
            return { tools: groupTools };
        });

        // tools/call handler
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name: toolName, arguments: args } = request.params;
            logger.info({ toolName }, 'Handling tools/call request');

            // Find the tool in the group to determine which backend server to call
            const toolOverride = find(group.tools, t => (t.name ?? t.originalName) === toolName);
            if(!toolOverride) {
                throw new Error(`Tool not found in group: ${toolName}`);
            }

            // Proxy to the backend server using the original tool name
            const result = await proxyService.callTool(
                toolOverride.serverName,
                toolOverride.originalName,
                args
            );

            // Return the result directly (it already has content and isError fields)
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- CallToolResult type incompatibility with ServerResult
            return result as any;
        });

        // resources/list handler
        server.setRequestHandler(ListResourcesRequestSchema, async () => {
            logger.debug({ resourceCount: groupResources.length }, 'Handling resources/list request');
            return { resources: groupResources };
        });

        // resources/read handler
        server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            const { uri } = request.params;
            logger.info({ uri }, 'Handling resources/read request');

            // Find the resource in the group to determine which backend server to call
            const resourceOverride = find(group.resources, { originalUri: uri });
            if(!resourceOverride) {
                throw new Error(`Resource not found in group: ${uri}`);
            }

            // Proxy to the backend server using the original URI
            const result = await proxyService.readResource(
                resourceOverride.serverName,
                resourceOverride.originalUri
            );

            // Return the result directly (it already has contents field)
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- ReadResourceResult type incompatibility with ServerResult
            return result as any;
        });

        // 11. Create stdio transport and connect
        const transport = new StdioServerTransport();
        await server.connect(transport);

        logger.info({ groupName }, 'MCP proxy server started and connected');

        // 12. Handle shutdown signals
        const shutdown = () => {
            logger.info('Shutting down MCP proxy server');
            void (async () => {
                try {
                    await server.close();
                    await clientManager.disconnectAll();
                    logger.info('MCP proxy server shutdown complete');
                } catch (error) {
                    logger.error({ error }, 'Error during shutdown');
                    throw error;
                }
            })();
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        // Keep the process running
        // The server will handle requests via stdio transport
    } catch (error) {
        logger.error({ error, groupName }, 'Failed to start MCP proxy server');
        throw error;
    }
}
