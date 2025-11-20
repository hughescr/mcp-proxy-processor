/**
 * Backend Server Discovery Service
 *
 * Discovers available tools, resources, and prompts from backend MCP servers:
 * - Calls listTools(), listResources(), and listPrompts() on backend clients
 * - Caches discovery results per server
 * - Supports refresh operations to update cache
 * - Provides efficient batch discovery across all servers
 */

import { dynamicLogger as logger } from '../utils/silent-logger.js';
import _ from 'lodash';
import type { Tool, Resource, Prompt } from '@modelcontextprotocol/sdk/types.js';
import type { ClientManager } from './client-manager.js';

interface DiscoveryCache {
    tools?:          Tool[]
    resources?:      Resource[]
    prompts?:        Prompt[]
    lastDiscovered?: number
}

/**
 * Service for discovering tools, resources, and prompts from backend servers
 */
export class DiscoveryService {
    private clientManager: ClientManager;
    private cache = new Map<string, DiscoveryCache>();
    private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    constructor(clientManager: ClientManager) {
        this.clientManager = clientManager;
    }

    /**
     * Discover tools from a specific backend server
     */
    async discoverTools(serverName: string): Promise<Tool[]> {
        // Check cache first
        const cached = this.getCachedTools(serverName);
        if(cached) {
            logger.debug({ serverName, toolCount: cached.length }, 'Returning cached tools');
            return cached;
        }

        logger.info({ serverName }, 'Discovering tools from backend server');

        try {
            const client = await this.clientManager.ensureConnected(serverName);
            const response = await client.listTools();
            const tools = response.tools || [];

            // Update cache
            this.updateCache(serverName, { tools });

            logger.info({ serverName, toolCount: tools.length }, 'Successfully discovered tools');
            return tools;
        } catch (error) {
            logger.error(
                { serverName, error: _.isError(error) ? error.message : String(error) },
                'Failed to discover tools from backend server'
            );
            throw new Error(`Failed to discover tools from ${serverName}: ${_.isError(error) ? error.message : String(error)}`);
        }
    }

    /**
     * Discover tools from all connected backend servers
     */
    async discoverAllTools(): Promise<Map<string, Tool[]>> {
        const serverNames = this.clientManager.getConnectedServerNames();

        logger.info({ serverCount: serverNames.length }, 'Discovering tools from all backend servers');

        const results = new Map<string, Tool[]>();
        const errors: { serverName: string, error: string }[] = [];

        const discoveryPromises = _.map(serverNames, async (serverName) => {
            try {
                const tools = await this.discoverTools(serverName);
                results.set(serverName, tools);
                logger.debug({ serverName, toolCount: tools.length }, 'Successfully discovered tools from server');
            } catch (error) {
                const errorMessage = _.isError(error) ? error.message : String(error);
                errors.push({ serverName, error: errorMessage });
                logger.error(
                    { serverName, error: errorMessage },
                    'Failed to discover tools during discoverAllTools'
                );
                // Still continue with other servers
                results.set(serverName, []);
            }
        });

        await Promise.all(discoveryPromises);

        const totalTools = _.reduce(Array.from(results.values()), (sum, tools) => sum + tools.length, 0);
        const successCount = results.size - errors.length;

        if(errors.length > 0) {
            logger.warn(
                {
                    serverCount:  results.size,
                    successCount,
                    failureCount: errors.length,
                    totalTools,
                    failures:     errors,
                },
                'Finished discovering tools with some failures'
            );
        } else {
            logger.info({ serverCount: results.size, totalTools }, 'Finished discovering tools from all servers');
        }

        return results;
    }

    /**
     * Discover resources from a specific backend server
     */
    async discoverResources(serverName: string): Promise<Resource[]> {
        // Check cache first
        const cached = this.getCachedResources(serverName);
        if(cached) {
            logger.debug({ serverName, resourceCount: cached.length }, 'Returning cached resources');
            return cached;
        }

        logger.info({ serverName }, 'Discovering resources from backend server');

        try {
            const client = await this.clientManager.ensureConnected(serverName);
            const response = await client.listResources();
            const resources = response.resources || [];

            // Update cache
            this.updateCache(serverName, { resources });

            logger.info({ serverName, resourceCount: resources.length }, 'Successfully discovered resources');
            return resources;
        } catch (error) {
            logger.error(
                { serverName, error: _.isError(error) ? error.message : String(error) },
                'Failed to discover resources from backend server'
            );
            throw new Error(`Failed to discover resources from ${serverName}: ${_.isError(error) ? error.message : String(error)}`);
        }
    }

    /**
     * Discover resources from all connected backend servers
     */
    async discoverAllResources(): Promise<Map<string, Resource[]>> {
        const serverNames = this.clientManager.getConnectedServerNames();

        logger.info({ serverCount: serverNames.length }, 'Discovering resources from all backend servers');

        const results = new Map<string, Resource[]>();
        const errors: { serverName: string, error: string }[] = [];

        const discoveryPromises = _.map(serverNames, async (serverName) => {
            try {
                const resources = await this.discoverResources(serverName);
                results.set(serverName, resources);
                logger.debug({ serverName, resourceCount: resources.length }, 'Successfully discovered resources from server');
            } catch (error) {
                const errorMessage = _.isError(error) ? error.message : String(error);
                errors.push({ serverName, error: errorMessage });
                logger.error(
                    { serverName, error: errorMessage },
                    'Failed to discover resources during discoverAllResources'
                );
                // Still continue with other servers
                results.set(serverName, []);
            }
        });

        await Promise.all(discoveryPromises);

        const totalResources = _.reduce(Array.from(results.values()), (sum, resources) => sum + resources.length, 0);
        const successCount = results.size - errors.length;

        if(errors.length > 0) {
            logger.warn(
                {
                    serverCount:  results.size,
                    successCount,
                    failureCount: errors.length,
                    totalResources,
                    failures:     errors,
                },
                'Finished discovering resources with some failures'
            );
        } else {
            logger.info({ serverCount: results.size, totalResources }, 'Finished discovering resources from all servers');
        }

        return results;
    }

    /**
     * Discover prompts from a specific backend server
     */
    async discoverPrompts(serverName: string): Promise<Prompt[]> {
        // Check cache first
        const cached = this.getCachedPrompts(serverName);
        if(cached) {
            logger.debug({ serverName, promptCount: cached.length }, 'Returning cached prompts');
            return cached;
        }

        logger.info({ serverName }, 'Discovering prompts from backend server');

        try {
            const client = await this.clientManager.ensureConnected(serverName);
            const response = await client.listPrompts();
            const prompts = response.prompts || [];

            // Update cache
            this.updateCache(serverName, { prompts });

            logger.info({ serverName, promptCount: prompts.length }, 'Successfully discovered prompts');
            return prompts;
        } catch (error) {
            logger.error(
                { serverName, error: _.isError(error) ? error.message : String(error) },
                'Failed to discover prompts from backend server'
            );
            throw new Error(`Failed to discover prompts from ${serverName}: ${_.isError(error) ? error.message : String(error)}`);
        }
    }

    /**
     * Discover prompts from all connected backend servers
     */
    async discoverAllPrompts(): Promise<Map<string, Prompt[]>> {
        const serverNames = this.clientManager.getConnectedServerNames();

        logger.info({ serverCount: serverNames.length }, 'Discovering prompts from all backend servers');

        const results = new Map<string, Prompt[]>();
        const errors: { serverName: string, error: string }[] = [];

        const discoveryPromises = _.map(serverNames, async (serverName) => {
            try {
                const prompts = await this.discoverPrompts(serverName);
                results.set(serverName, prompts);
                logger.debug({ serverName, promptCount: prompts.length }, 'Successfully discovered prompts from server');
            } catch (error) {
                const errorMessage = _.isError(error) ? error.message : String(error);
                errors.push({ serverName, error: errorMessage });
                logger.error(
                    { serverName, error: errorMessage },
                    'Failed to discover prompts during discoverAllPrompts'
                );
                // Still continue with other servers
                results.set(serverName, []);
            }
        });

        await Promise.all(discoveryPromises);

        const totalPrompts = _.reduce(Array.from(results.values()), (sum, prompts) => sum + prompts.length, 0);
        const successCount = results.size - errors.length;

        if(errors.length > 0) {
            logger.warn(
                {
                    serverCount:  results.size,
                    successCount,
                    failureCount: errors.length,
                    totalPrompts,
                    failures:     errors,
                },
                'Finished discovering prompts with some failures'
            );
        } else {
            logger.info({ serverCount: results.size, totalPrompts }, 'Finished discovering prompts from all servers');
        }

        return results;
    }

    /**
     * Refresh discovery cache for a specific server
     */
    async refresh(serverName: string): Promise<void> {
        logger.info({ serverName }, 'Refreshing discovery cache');

        // Clear cache
        this.cache.delete(serverName);

        // Re-discover
        await Promise.all([
            this.discoverTools(serverName),
            this.discoverResources(serverName),
            this.discoverPrompts(serverName),
        ]);

        logger.info({ serverName }, 'Discovery cache refreshed');
    }

    /**
     * Refresh discovery cache for all servers
     */
    async refreshAll(): Promise<void> {
        const serverNames = this.clientManager.getConnectedServerNames();

        logger.info({ serverCount: serverNames.length }, 'Refreshing discovery cache for all servers');

        // Clear all cache
        this.cache.clear();

        // Re-discover all
        await Promise.all([
            this.discoverAllTools(),
            this.discoverAllResources(),
            this.discoverAllPrompts(),
        ]);

        logger.info('Discovery cache refreshed for all servers');
    }

    /**
     * Get cached tools if available and not expired
     */
    private getCachedTools(serverName: string): Tool[] | undefined {
        const cached = this.cache.get(serverName);
        if(!cached?.tools || !cached.lastDiscovered) {
            return undefined;
        }

        const age = Date.now() - cached.lastDiscovered;
        if(age > this.CACHE_TTL_MS) {
            logger.debug({ serverName, ageMs: age }, 'Cache expired');
            return undefined;
        }

        // Type assertion needed because optional array properties are inferred as any[]

        return cached.tools;
    }

    /**
     * Get cached resources if available and not expired
     */
    private getCachedResources(serverName: string): Resource[] | undefined {
        const cached = this.cache.get(serverName);
        if(!cached?.resources || !cached.lastDiscovered) {
            return undefined;
        }

        const age = Date.now() - cached.lastDiscovered;
        if(age > this.CACHE_TTL_MS) {
            logger.debug({ serverName, ageMs: age }, 'Cache expired');
            return undefined;
        }

        return cached.resources;
    }

    /**
     * Get cached prompts if available and not expired
     */
    private getCachedPrompts(serverName: string): Prompt[] | undefined {
        const cached = this.cache.get(serverName);
        if(!cached?.prompts || !cached.lastDiscovered) {
            return undefined;
        }

        const age = Date.now() - cached.lastDiscovered;
        if(age > this.CACHE_TTL_MS) {
            logger.debug({ serverName, ageMs: age }, 'Cache expired');
            return undefined;
        }

        return cached.prompts;
    }

    /**
     * Update cache for a server
     */
    private updateCache(serverName: string, updates: Partial<DiscoveryCache>): void {
        const existing = this.cache.get(serverName) ?? {};
        this.cache.set(serverName, {
            ...existing,
            ...updates,
            lastDiscovered: Date.now(),
        });
    }

    /**
     * Clear cache for a specific server
     */
    clearCache(serverName: string): void {
        this.cache.delete(serverName);
        logger.debug({ serverName }, 'Discovery cache cleared');
    }

    /**
     * Clear all discovery caches
     */
    clearAllCache(): void {
        this.cache.clear();
        logger.debug('All discovery caches cleared');
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { serverCount: number, cachedServers: string[], oldestCacheAge: number | null } {
        const cachedServers = Array.from(this.cache.keys());
        let oldestAge: number | null = null;

        for(const cached of this.cache.values()) {
            if(cached.lastDiscovered) {
                const age = Date.now() - cached.lastDiscovered;
                if(oldestAge === null || age > oldestAge) {
                    oldestAge = age;
                }
            }
        }

        return {
            serverCount:    this.cache.size,
            cachedServers,
            oldestCacheAge: oldestAge,
        };
    }
}
