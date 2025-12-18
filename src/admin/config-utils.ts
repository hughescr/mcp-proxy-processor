/**
 * Configuration utilities for the admin interface
 */

import { writeFile } from 'node:fs/promises';
import _ from 'lodash';
import { dynamicLogger as logger } from '../utils/silent-logger.js';
import { GroupsConfigSchema, BackendServersConfigSchema, type GroupsConfig, type BackendServersConfig } from '../types/config.js';
import { getGroupsConfigPath, getBackendServersConfigPath } from '../utils/config-paths.js';

// Config file paths
export const GROUPS_CONFIG_PATH = getGroupsConfigPath();
export const BACKEND_SERVERS_CONFIG_PATH = getBackendServersConfigPath();

/**
 * Load groups configuration from disk
 */
export async function loadGroupsConfig(): Promise<GroupsConfig> {
    const { loadJsonConfig } = await import('../utils/config-loader.js');

    try {
        const config = await loadJsonConfig({
            path:              GROUPS_CONFIG_PATH,
            schema:            GroupsConfigSchema,
            fallbackOnMissing: true,
            defaultValue:      { groups: {} },
        });
        logger.debug({ groupCount: _.keys(config.groups).length }, 'Loaded groups configuration');
        return config;
    } catch (error) {
        logger.error({ error }, 'Failed to load groups configuration');
        // Return empty config if file doesn't exist or is invalid
        return { groups: {} };
    }
}

/**
 * Save groups configuration to disk
 */
export async function saveGroupsConfig(config: GroupsConfig): Promise<void> {
    try {
        // Validate before saving
        const result = GroupsConfigSchema.safeParse(config);
        if(!result.success) {
            const errorMessages = _(result.error.issues)
                .map(issue => `${_.join(issue.path, '.')}: ${issue.message}`)
                .join(', ');
            throw new Error(`Invalid groups configuration: ${errorMessages}`);
        }
        const content = JSON.stringify(result.data, null, 2);
        await writeFile(GROUPS_CONFIG_PATH, content + '\n', 'utf-8');
        logger.info({ groupCount: _.keys(result.data.groups).length }, 'Saved groups configuration');
    } catch (error) {
        logger.error({ error }, 'Failed to save groups configuration');
        throw new Error(`Failed to save groups configuration: ${_.isError(error) ? error.message : String(error)}`);
    }
}

/**
 * Load backend servers configuration from disk
 */
export async function loadBackendServersConfig(): Promise<BackendServersConfig> {
    const { loadJsonConfig } = await import('../utils/config-loader.js');

    try {
        const config = await loadJsonConfig({
            path:   BACKEND_SERVERS_CONFIG_PATH,
            schema: BackendServersConfigSchema,
        });
        logger.debug({ serverCount: _.keys(config.mcpServers).length }, 'Loaded backend servers configuration');
        return config;
    } catch (error) {
        logger.error({ error }, 'Failed to load backend servers configuration');
        throw new Error(`Failed to load backend servers configuration: ${_.isError(error) ? error.message : String(error)}`);
    }
}

/**
 * Save backend servers configuration to disk
 */
export async function saveBackendServersConfig(config: BackendServersConfig): Promise<void> {
    try {
        // Validate before saving
        const result = BackendServersConfigSchema.safeParse(config);
        if(!result.success) {
            const errorMessages = _(result.error.issues)
                .map(issue => `${_.join(issue.path, '.')}: ${issue.message}`)
                .join(', ');
            throw new Error(`Invalid backend servers configuration: ${errorMessages}`);
        }
        const content = JSON.stringify(result.data, null, 2);
        await writeFile(BACKEND_SERVERS_CONFIG_PATH, content + '\n', 'utf-8');
        logger.info({ serverCount: _.keys(result.data.mcpServers).length }, 'Saved backend servers configuration');
    } catch (error) {
        logger.error({ error }, 'Failed to save backend servers configuration');
        throw new Error(`Failed to save backend servers configuration: ${_.isError(error) ? error.message : String(error)}`);
    }
}
