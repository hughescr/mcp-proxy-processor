/**
 * Frontend MCP Server Implementation
 *
 * This module is responsible for:
 * - Starting an MCP server using stdio transport
 * - Loading configuration for a specific group
 * - Routing tool calls to appropriate backend servers
 * - Returning responses to the MCP client
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import _ from 'lodash';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getBackendServersConfigPath, getGroupsConfigPath } from '../utils/config-paths.js';
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema,
    type ServerResult
} from '@modelcontextprotocol/sdk/types.js';
import { dynamicLogger as logger } from '../utils/silent-logger.js';
import { GroupManager } from '../middleware/index.js';
import { ArgumentTransformer } from '../middleware/argument-transformer.js';
import { deduplicateResources, deduplicatePrompts, findMatchingResourceRefs, findMatchingPromptRefs } from '../utils/conflict-detection.js';
import { ClientManager } from '../backend/client-manager.js';
import { DiscoveryService } from '../backend/discovery.js';
import { ProxyService } from '../backend/proxy.js';
import type { BackendServersConfig, BackendServerConfig, ToolOverride, ResourceRef, PromptRef } from '../types/config.js';
import { BackendServersConfigSchema } from '../types/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Start the MCP server for one or more groups
 * @param groupNames - Name(s) of the group(s) to serve (single string or array)
 */
export async function startServer(groupNames: string | string[]): Promise<void> {
    // Normalize to array for consistent handling
    const groupNamesArray = _.isArray(groupNames) ? groupNames : [groupNames];

    logger.info({ groupNames: groupNamesArray }, 'Starting MCP proxy server');

    // Migrate config files from old location if needed
    const { migrateConfigFiles } = await import('../utils/config-migration.js');
    await migrateConfigFiles();

    // Configuration paths
    const backendConfigPath = getBackendServersConfigPath();
    const groupsConfigPath = getGroupsConfigPath();

    try {
        // 1. Load group configuration
        logger.info('Loading group configuration');
        const groupManager = new GroupManager(groupsConfigPath);
        await groupManager.load();

        // Validate all groups exist
        const groups = groupManager.getGroups(groupNamesArray);
        const missingGroups = _.difference(groupNamesArray, _.map(groups, 'name'));
        if(missingGroups.length > 0) {
            throw new Error(`Groups not found: ${missingGroups.join(', ')}`);
        }

        // Collect all tool overrides, resources, and prompts from all groups
        const allToolOverrides: ToolOverride[] = groups.flatMap(g => g.tools ?? []);
        const allResourceRefs: ResourceRef[] = groups.flatMap(g => g.resources ?? []);
        const allPromptRefs: PromptRef[] = groups.flatMap(g => g.prompts ?? []);

        logger.info({
            groupNames:    groupNamesArray,
            toolCount:     allToolOverrides.length,
            resourceCount: allResourceRefs.length,
            promptCount:   allPromptRefs.length
        }, 'Groups loaded');

        // 2. Load backend server configuration
        logger.info('Loading backend server configuration');
        const { loadJsonConfig } = await import('../utils/config-loader.js');
        const backendConfig: BackendServersConfig = await loadJsonConfig({
            path:   backendConfigPath,
            schema: BackendServersConfigSchema,
        });

        // 3. Determine required backend servers from all groups
        const requiredServers = groupManager.getRequiredServersForGroups(groupNamesArray);
        logger.info({ requiredServers }, 'Required backend servers identified');

        if(requiredServers.length === 0) {
            logger.info({ groupNames: groupNamesArray }, 'No backend servers required for groups - will serve empty lists');
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

        // 9. Get tools, resources, and prompts for all groups (with overrides applied and deduplicated)
        const groupTools = groupManager.getToolsForGroups(groupNamesArray, backendTools);
        const groupResources = groupManager.getResourcesForGroups(groupNamesArray, backendResources);
        const groupPrompts = groupManager.getPromptsForGroups(groupNamesArray, backendPrompts);

        logger.info({ toolCount: groupTools.length, resourceCount: groupResources.length, promptCount: groupPrompts.length }, 'Group tools, resources, and prompts prepared');

        // 10. Create MCP server instance
        const serverName = groupNamesArray.length === 1 ? `mcp-proxy-${groupNamesArray[0]}` : `mcp-proxy-${groupNamesArray.join('-')}`;
        const server = new Server(
            {
                name:    serverName,
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

            // Find the tool in the merged groups to determine which backend server to call
            const toolOverride = _.find(allToolOverrides, t => (t.name ?? t.originalName) === toolName);
            if(!toolOverride) {
                throw new Error(`Tool not found in groups: ${toolName}`);
            }
            // Transform arguments if mapping is configured
            let backendArgs = args;
            if(toolOverride.argumentMapping) {
                logger.debug({ clientArgs: args, mapping: toolOverride.argumentMapping }, 'Transforming arguments');
                backendArgs = await argumentTransformer.transform(args, toolOverride.argumentMapping);
                logger.debug({ backendArgs }, 'Arguments transformed');
            }

            // Validate transformed arguments against backend schema
            const backendToolKey = `${toolOverride.serverName}:${toolOverride.originalName}`;
            const backendTool = backendTools.get(backendToolKey);
            const schema = backendTool && 'inputSchema' in backendTool ? backendTool.inputSchema : undefined;
            if(!schema) {
                logger.debug({ toolName, serverName: toolOverride.serverName }, 'Backend tool has no inputSchema, skipping validation');
            } else {
                // Use JSON Schema validation
                const Ajv = (await import('ajv')).default;
                const ajv = new Ajv({ allErrors: true });
                const validate = ajv.compile(schema as object);
                if(!validate(backendArgs)) {
                    const errors = _.map(validate.errors ?? [], (e: { instancePath?: string, message?: string }) => `${e.instancePath ?? ''} ${e.message ?? ''}`).join(', ') || 'Unknown validation error';
                    logger.error({ toolName, serverName: toolOverride.serverName, backendArgs, errors }, 'Backend argument validation failed');
                    return {
                        content: [{ type: 'text', text: `Argument validation failed for tool '${toolName}' on server '${toolOverride.serverName}': ${errors}` }],
                        isError: true,
                    };
                }
            }

            // Proxy to the backend server using the original tool name
            const result = await proxyService.callTool(
                toolOverride.serverName,
                toolOverride.originalName,
                backendArgs
            );

            // Check if the result indicates an error
            if(result.isError) {
                // Extract error message from content
                const errorMessage = _(result.content)
                    .map(c => ('text' in c ? c.text : ''))
                    .compact()
                    .join('\n') || 'Tool execution failed';

                logger.error({ toolName, serverName: toolOverride.serverName, errorMessage }, 'Tool execution returned error');
                throw new Error(errorMessage);
            }

            // Return the result directly (it already has content and isError fields)
            return result as ServerResult;
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
            const matchingRefs = findMatchingResourceRefs(uri, allResourceRefs);
            if(matchingRefs.length === 0) {
                throw new Error(`Resource not found in groups: ${uri}`);
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
                    return result as ServerResult;
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
            const matchingRefs = findMatchingPromptRefs(name, allPromptRefs);
            if(matchingRefs.length === 0) {
                throw new Error(`Prompt not found in groups: ${name}`);
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
                    return result as ServerResult;
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

        logger.info({ groupNames: groupNamesArray }, 'MCP proxy server started and connected');

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
        // Check for missing config files and provide helpful message
        if(_.isError(error) && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
            const { getConfigDir } = await import('../utils/config-paths.js');
            // eslint-disable-next-line no-console -- User-facing error message to stderr
            console.error('\nError: Configuration files not found.');
            // eslint-disable-next-line no-console -- User-facing error message to stderr
            console.error(`Expected location: ${getConfigDir()}`);
            // eslint-disable-next-line no-console -- User-facing error message to stderr
            console.error(`\nRun 'mcp-proxy admin' to create configuration.\n`);
            // eslint-disable-next-line n/no-process-exit -- Fatal error, must exit
            process.exit(1);
        }
        logger.error({ error, groupNames }, 'Failed to start MCP proxy server');
        throw error;
    }
}
