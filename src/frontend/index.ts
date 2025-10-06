/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- logger is typed as any */
/**
 * Frontend MCP Server Implementation
 *
 * This module is responsible for:
 * - Starting an MCP server using stdio transport
 * - Loading configuration for a specific group
 * - Routing tool calls to appropriate backend servers
 * - Returning responses to the MCP client
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import _ from 'lodash';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from '@hughescr/logger';
import { GroupManager } from '../middleware/index.js';
import { ArgumentTransformer } from '../middleware/argument-transformer.js';
import { deduplicateResources, deduplicatePrompts, findMatchingResourceRefs, findMatchingPromptRefs } from '../middleware/resource-prompt-utils.js';
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

        logger.info({ groupName, toolCount: group.tools.length, resourceCount: group.resources?.length ?? 0, promptCount: group.prompts?.length ?? 0 }, 'Group loaded');

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

        // 6. Discover tools, resources, and prompts from backends
        logger.info('Discovering tools, resources, and prompts from backend servers');
        const discoveryService = new DiscoveryService(clientManager);
        const backendTools = await discoveryService.discoverAllTools();
        const backendResources = await discoveryService.discoverAllResources();
        const backendPrompts = await discoveryService.discoverAllPrompts();

        const totalBackendTools = _.reduce(Array.from(backendTools.values()), (sum, tools) => sum + tools.length, 0);
        const totalBackendResources = _.reduce(Array.from(backendResources.values()), (sum, resources) => sum + resources.length, 0);
        const totalBackendPrompts = _.reduce(Array.from(backendPrompts.values()), (sum, prompts) => sum + prompts.length, 0);
        logger.info({ totalBackendTools, totalBackendResources, totalBackendPrompts }, 'Discovery completed');

        // 7. Create argument transformer
        const argumentTransformer = new ArgumentTransformer();

        // 8. Create proxy service
        const proxyService = new ProxyService(clientManager);

        // 9. Get tools, resources, and prompts for this group (with overrides applied)
        const groupTools = groupManager.getToolsForGroup(groupName, backendTools);
        const groupResources = groupManager.getResourcesForGroup(groupName, backendResources);
        const groupPrompts = groupManager.getPromptsForGroup(groupName, backendPrompts);

        logger.info({ toolCount: groupTools.length, resourceCount: groupResources.length, promptCount: groupPrompts.length }, 'Group tools, resources, and prompts prepared');

        // 10. Create MCP server instance
        const server = new Server(
            {
                name:    `mcp-proxy-${groupName}`,
                version: '0.1.0',
            },
            {
                capabilities: {
                    tools:     {},
                    resources: {},
                    prompts:   {},
                },
            }
        );

        // 11. Register handlers

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
            const toolOverride = _.find(group.tools, t => (t.name ?? t.originalName) === toolName);
            if(!toolOverride) {
                throw new Error(`Tool not found in group: ${toolName}`);
            }
            // Transform arguments if mapping is configured
            let backendArgs = args;
            if(toolOverride.argumentMapping) {
                logger.debug({ clientArgs: args, mapping: toolOverride.argumentMapping }, 'Transforming arguments');
                backendArgs = await argumentTransformer.transform(args, toolOverride.argumentMapping);
                logger.debug({ backendArgs }, 'Arguments transformed');
            }

            // Proxy to the backend server using the original tool name
            const result = await proxyService.callTool(
                toolOverride.serverName,
                toolOverride.originalName,
                backendArgs
            );

            // Return the result directly (it already has content and isError fields)
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- CallToolResult type incompatibility with ServerResult
            return result as any;
        });

        // resources/list handler - with deduplication
        server.setRequestHandler(ListResourcesRequestSchema, async () => {
            logger.debug({ resourceCount: groupResources.length }, 'Handling resources/list request');
            // Deduplicate resources by URI (keeps first occurrence = highest priority)
            const deduplicated = deduplicateResources(groupResources);
            logger.debug({ originalCount: groupResources.length, deduplicatedCount: deduplicated.length }, 'Resources deduplicated');
            return { resources: deduplicated };
        });

        // resources/read handler - with fallback chain
        server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            const { uri } = request.params;
            logger.info({ uri }, 'Handling resources/read request');

            // Find all matching resource references in priority order
            const matchingRefs = findMatchingResourceRefs(uri, group.resources ?? []);
            if(matchingRefs.length === 0) {
                throw new Error(`Resource not found in group: ${uri}`);
            }

            logger.debug({ uri, matchingServers: _.map(matchingRefs, 'serverName') }, 'Found matching resource refs, will try in priority order');

            // Try each matching resource in priority order until one succeeds
            let lastError: Error | undefined;
            for(const resourceRef of matchingRefs) {
                try {
                    logger.debug({ uri, serverName: resourceRef.serverName }, 'Attempting to read resource from backend');
                    const result = await proxyService.readResource(
                        resourceRef.serverName,
                        uri
                    );

                    logger.info({ uri, serverName: resourceRef.serverName }, 'Resource read successful');
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- ReadResourceResult type incompatibility with ServerResult
                    return result as any;
                } catch (error) {
                    lastError = _.isError(error) ? error : new Error(String(error));
                    logger.warn({ uri, serverName: resourceRef.serverName, error: lastError.message }, 'Resource read failed, trying next backend');
                    // Continue to next backend in priority order
                }
            }

            // All backends failed
            logger.error({ uri, attemptedServers: _.map(matchingRefs, 'serverName'), lastError: lastError?.message }, 'All resource read attempts failed');
            throw new Error(`Failed to read resource ${uri} from all backends: ${lastError?.message ?? 'unknown error'}`);
        });

        // prompts/list handler - with deduplication
        server.setRequestHandler(ListPromptsRequestSchema, async () => {
            logger.debug({ promptCount: groupPrompts.length }, 'Handling prompts/list request');
            // Deduplicate prompts by name (keeps first occurrence = highest priority)
            const deduplicated = deduplicatePrompts(groupPrompts);
            logger.debug({ originalCount: groupPrompts.length, deduplicatedCount: deduplicated.length }, 'Prompts deduplicated');
            return { prompts: deduplicated };
        });

        // prompts/get handler - with fallback chain
        server.setRequestHandler(GetPromptRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            logger.info({ name }, 'Handling prompts/get request');

            // Find all matching prompt references in priority order
            const matchingRefs = findMatchingPromptRefs(name, group.prompts ?? []);
            if(matchingRefs.length === 0) {
                throw new Error(`Prompt not found in group: ${name}`);
            }

            logger.debug({ name, matchingServers: _.map(matchingRefs, 'serverName') }, 'Found matching prompt refs, will try in priority order');

            // Try each matching prompt in priority order until one succeeds
            let lastError: Error | undefined;
            for(const promptRef of matchingRefs) {
                try {
                    logger.debug({ name, serverName: promptRef.serverName }, 'Attempting to get prompt from backend');
                    const result = await proxyService.getPrompt(
                        promptRef.serverName,
                        name,
                        args
                    );

                    logger.info({ name, serverName: promptRef.serverName }, 'Prompt get successful');
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- GetPromptResult type incompatibility with ServerResult
                    return result as any;
                } catch (error) {
                    lastError = _.isError(error) ? error : new Error(String(error));
                    logger.warn({ name, serverName: promptRef.serverName, error: lastError.message }, 'Prompt get failed, trying next backend');
                    // Continue to next backend in priority order
                }
            }

            // All backends failed
            logger.error({ name, attemptedServers: _.map(matchingRefs, 'serverName'), lastError: lastError?.message }, 'All prompt get attempts failed');
            throw new Error(`Failed to get prompt ${name} from all backends: ${lastError?.message ?? 'unknown error'}`);
        });

        // 12. Create stdio transport and connect
        const transport = new StdioServerTransport();
        await server.connect(transport);

        logger.info({ groupName }, 'MCP proxy server started and connected');

        // 13. Handle shutdown signals
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
