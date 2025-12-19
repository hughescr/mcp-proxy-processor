/**
 * Configuration file path utilities
 * Provides cross-platform paths for user config files
 */

import envPaths from 'env-paths';
import { makeDirectory } from 'make-dir';
import { join } from 'node:path';

// Get platform-specific config paths
// Uses @hughescr/mcp-proxy-processor as the app name
// suffix: '' removes the default '-nodejs' suffix
const paths = envPaths('@hughescr/mcp-proxy-processor', { suffix: '' });

/**
 * Get the config directory path
 * This is where backend-servers.json and groups.json are stored
 */
export function getConfigDir(): string {
    return paths.data;
}

/**
 * Get the full path to the groups config file
 */
export function getGroupsConfigPath(): string {
    return join(paths.data, 'groups.json');
}

/**
 * Get the full path to the backend servers config file
 */
export function getBackendServersConfigPath(): string {
    return join(paths.data, 'backend-servers.json');
}

/**
 * Ensure the config directory exists
 * Creates it if it doesn't exist
 */
export async function ensureConfigDir(): Promise<string> {
    await makeDirectory(paths.data);
    return paths.data;
}

/**
 * Get all standard paths (config, data, cache, log, temp)
 * Useful for debugging or advanced use cases
 */
export function getAllPaths() {
    return {
        config: paths.config,
        data:   paths.data,
        cache:  paths.cache,
        log:    paths.log,
        temp:   paths.temp,
    };
}
