/**
 * Backend Server Discovery Service
 *
 * Discovers available tools and resources from backend MCP servers:
 * - Calls listTools() and listResources() on backend clients
 * - Caches discovery results per server
 * - Supports refresh operations to update cache
 * - Provides efficient batch discovery across all servers
 */

import { logger } from '@hughescr/logger';
import _ from 'lodash';
import type { Tool, Resource } from '@modelcontextprotocol/sdk/types';
import type { ClientManager } from './client-manager.js';

interface DiscoveryCache {
    tools?:          Tool[]
    resources?:      Resource[]
    lastDiscovered?: number
}

/**
 * Service for discovering tools and resources from backend servers
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

        const client = this.clientManager.getClient(serverName);
        if(!client) {
            throw new Error(`Not connected to backend server: ${serverName}`);
        }

        try {
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

        const discoveryPromises = _.map(serverNames, async (serverName) => {
            try {
                const tools = await this.discoverTools(serverName);
                results.set(serverName, tools);
            } catch (error) {
                logger.error(
                    { serverName, error: _.isError(error) ? error.message : String(error) },
                    'Failed to discover tools during discoverAllTools'
                );
                // Still continue with other servers
                results.set(serverName, []);
            }
        });

        await Promise.all(discoveryPromises);

        const totalTools = _.reduce(Array.from(results.values()), (sum, tools) => sum + tools.length, 0);
        logger.info({ serverCount: results.size, totalTools }, 'Finished discovering tools from all servers');

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

        const client = this.clientManager.getClient(serverName);
        if(!client) {
            throw new Error(`Not connected to backend server: ${serverName}`);
        }

        try {
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

        const discoveryPromises = _.map(serverNames, async (serverName) => {
            try {
                const resources = await this.discoverResources(serverName);
                results.set(serverName, resources);
            } catch (error) {
                logger.error(
                    { serverName, error: _.isError(error) ? error.message : String(error) },
                    'Failed to discover resources during discoverAllResources'
                );
                // Still continue with other servers
                results.set(serverName, []);
            }
        });

        await Promise.all(discoveryPromises);

        const totalResources = _.reduce(Array.from(results.values()), (sum, resources) => sum + resources.length, 0);
        logger.info({ serverCount: results.size, totalResources }, 'Finished discovering resources from all servers');

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

        // Type assertion needed because optional array properties are inferred as any[]

        return cached.resources;
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

export default DiscoveryService;
