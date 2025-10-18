/**
 * Configuration utilities for the admin interface
 */

import { readFile, writeFile } from 'node:fs/promises';
import { keys, isError } from 'lodash';
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
    try {
        const content = await readFile(GROUPS_CONFIG_PATH, 'utf-8');
        const rawConfig: unknown = JSON.parse(content);
        const config = GroupsConfigSchema.parse(rawConfig);
        logger.debug({ groupCount: keys(config.groups).length }, 'Loaded groups configuration');
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
        const validated = GroupsConfigSchema.parse(config);
        const content = JSON.stringify(validated, null, 2);
        await writeFile(GROUPS_CONFIG_PATH, content + '\n', 'utf-8');
        logger.info({ groupCount: keys(validated.groups).length }, 'Saved groups configuration');
    } catch (error) {
        logger.error({ error }, 'Failed to save groups configuration');
        throw new Error(`Failed to save groups configuration: ${isError(error) ? error.message : String(error)}`);
    }
}

/**
 * Load backend servers configuration from disk
 */
export async function loadBackendServersConfig(): Promise<BackendServersConfig> {
    try {
        const content = await readFile(BACKEND_SERVERS_CONFIG_PATH, 'utf-8');
        const rawConfig: unknown = JSON.parse(content);
        const config = BackendServersConfigSchema.parse(rawConfig);
        logger.debug({ serverCount: keys(config.mcpServers).length }, 'Loaded backend servers configuration');
        return config;
    } catch (error) {
        logger.error({ error }, 'Failed to load backend servers configuration');
        throw new Error(`Failed to load backend servers configuration: ${isError(error) ? error.message : String(error)}`);
    }
}

/**
 * Save backend servers configuration to disk
 */
export async function saveBackendServersConfig(config: BackendServersConfig): Promise<void> {
    try {
        // Validate before saving
        const validated = BackendServersConfigSchema.parse(config);
        const content = JSON.stringify(validated, null, 2);
        await writeFile(BACKEND_SERVERS_CONFIG_PATH, content + '\n', 'utf-8');
        logger.info({ serverCount: keys(validated.mcpServers).length }, 'Saved backend servers configuration');
    } catch (error) {
        logger.error({ error }, 'Failed to save backend servers configuration');
        throw new Error(`Failed to save backend servers configuration: ${isError(error) ? error.message : String(error)}`);
    }
}
