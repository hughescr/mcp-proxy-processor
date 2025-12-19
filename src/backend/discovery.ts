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
     * Generic helper for discovering items from a backend server
     */
    private async discoverItems<T>(
        serverName: string,
        cacheGetter: (serverName: string) => T[] | undefined,
        listMethod: (client: import('@modelcontextprotocol/sdk/client/index.js').Client) => Promise<T[]>,
        itemType: string,
        countKey: string
    ): Promise<T[]> {
        // Check cache first
        const cached = cacheGetter(serverName);
        if(cached) {
            logger.debug({ serverName, [countKey]: cached.length }, `Returning cached ${itemType}`);
            return cached;
        }

        logger.info({ serverName }, `Discovering ${itemType} from backend server`);

        try {
            const client = await this.clientManager.ensureConnected(serverName);
            const items = await listMethod(client);

            // Update cache
            this.updateCache(serverName, { [itemType]: items });

            logger.info({ serverName, [countKey]: items.length }, `Successfully discovered ${itemType}`);
            return items;
        } catch (error) {
            logger.error(
                { serverName, error: _.isError(error) ? error.message : String(error) },
                `Failed to discover ${itemType} from backend server`
            );
            throw new Error(`Failed to discover ${itemType} from ${serverName}: ${_.isError(error) ? error.message : String(error)}`);
        }
    }

    /**
     * Generic helper for discovering items from all backend servers
     */
    private async discoverAllItems<T>(
        discoverMethod: (serverName: string) => Promise<T[]>,
        itemType: string,
        countKey: string,
        totalKey: string,
        operationName: string
    ): Promise<Map<string, T[]>> {
        const serverNames = this.clientManager.getConnectedServerNames();

        logger.info({ serverCount: serverNames.length }, `Discovering ${itemType} from all backend servers`);

        const results = new Map<string, T[]>();
        const errors: { serverName: string, error: string }[] = [];

        const discoveryPromises = _.map(serverNames, async (serverName) => {
            try {
                const items = await discoverMethod(serverName);
                results.set(serverName, items);
                logger.debug({ serverName, [countKey]: items.length }, `Successfully discovered ${itemType} from server`);
            } catch (error) {
                const errorMessage = _.isError(error) ? error.message : String(error);
                errors.push({ serverName, error: errorMessage });
                logger.error(
                    { serverName, error: errorMessage },
                    `Failed to discover ${itemType} during ${operationName}`
                );
                // Still continue with other servers
                results.set(serverName, []);
            }
        });

        await Promise.all(discoveryPromises);

        const totalCount = _.reduce(Array.from(results.values()), (sum, items) => sum + items.length, 0);
        const successCount = results.size - errors.length;

        if(errors.length > 0) {
            logger.warn(
                {
                    serverCount:  results.size,
                    successCount,
                    failureCount: errors.length,
                    [totalKey]:   totalCount,
                    failures:     errors,
                },
                `Finished discovering ${itemType} with some failures`
            );
        } else {
            logger.info({ serverCount: results.size, [totalKey]: totalCount }, `Finished discovering ${itemType} from all servers`);
        }

        return results;
    }

    /**
     * Discover tools from a specific backend server
     */
    async discoverTools(serverName: string): Promise<Tool[]> {
        return this.discoverItems(
            serverName,
            name => this.getCachedTools(name),
            async client => (await client.listTools()).tools || [],
            'tools',
            'toolCount'
        );
    }

    /**
     * Discover tools from all connected backend servers
     */
    async discoverAllTools(): Promise<Map<string, Tool[]>> {
        return this.discoverAllItems(
            serverName => this.discoverTools(serverName),
            'tools',
            'toolCount',
            'totalTools',
            'discoverAllTools'
        );
    }

    /**
     * Discover resources from a specific backend server
     */
    async discoverResources(serverName: string): Promise<Resource[]> {
        return this.discoverItems(
            serverName,
            name => this.getCachedResources(name),
            async client => (await client.listResources()).resources || [],
            'resources',
            'resourceCount'
        );
    }

    /**
     * Discover resources from all connected backend servers
     */
    async discoverAllResources(): Promise<Map<string, Resource[]>> {
        return this.discoverAllItems(
            serverName => this.discoverResources(serverName),
            'resources',
            'resourceCount',
            'totalResources',
            'discoverAllResources'
        );
    }

    /**
     * Discover prompts from a specific backend server
     */
    async discoverPrompts(serverName: string): Promise<Prompt[]> {
        return this.discoverItems(
            serverName,
            name => this.getCachedPrompts(name),
            async client => (await client.listPrompts()).prompts || [],
            'prompts',
            'promptCount'
        );
    }

    /**
     * Discover prompts from all connected backend servers
     */
    async discoverAllPrompts(): Promise<Map<string, Prompt[]>> {
        return this.discoverAllItems(
            serverName => this.discoverPrompts(serverName),
            'prompts',
            'promptCount',
            'totalPrompts',
            'discoverAllPrompts'
        );
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
