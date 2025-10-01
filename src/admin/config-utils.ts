/**
 * Configuration utilities for the admin interface
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keys, isError } from 'lodash';
import { logger as realLogger } from '@hughescr/logger';
import { logger as silentLogger } from '../utils/silent-logger.js';
import { GroupsConfigSchema, BackendServersConfigSchema, type GroupsConfig, type BackendServersConfig } from '../types/config.js';

// Use silent logger in admin mode
const logger = process.env.LOG_LEVEL === 'silent' ? silentLogger : realLogger;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Config file paths
const CONFIG_DIR = join(__dirname, '..', '..', 'config');
export const GROUPS_CONFIG_PATH = join(CONFIG_DIR, 'groups.json');
export const BACKEND_SERVERS_CONFIG_PATH = join(CONFIG_DIR, 'backend-servers.json');

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
