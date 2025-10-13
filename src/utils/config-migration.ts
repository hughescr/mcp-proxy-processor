/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- logger is typed as any */
/**
 * Configuration migration utilities
 * Handles migration from old project-relative config paths to new user config directory
 */

import { readFile, writeFile, access, constants } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@hughescr/logger';
import { getConfigDir, getGroupsConfigPath, getBackendServersConfigPath, ensureConfigDir } from './config-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Old config paths (project-relative)
const OLD_CONFIG_DIR = join(__dirname, '..', '..', 'config');
const OLD_GROUPS_CONFIG_PATH = join(OLD_CONFIG_DIR, 'groups.json');
const OLD_BACKEND_SERVERS_CONFIG_PATH = join(OLD_CONFIG_DIR, 'backend-servers.json');

/**
 * Check if a file exists and is readable
 */
async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path, constants.R_OK);
        return true;
    } catch{
        return false;
    }
}

/**
 * Migrate a single config file from old location to new location
 */
async function migrateConfigFile(oldPath: string, newPath: string, fileName: string): Promise<boolean> {
    // Check if old file exists
    const oldExists = await fileExists(oldPath);
    if(!oldExists) {
        logger.debug({ fileName }, 'Old config file not found, skipping migration');
        return false;
    }

    // Check if new file already exists
    const newExists = await fileExists(newPath);
    if(newExists) {
        logger.debug({ fileName }, 'New config file already exists, skipping migration');
        return false;
    }

    try {
        // Read old config
        const content = await readFile(oldPath, 'utf-8');

        // Write to new location
        await writeFile(newPath, content, 'utf-8');

        logger.info({ fileName, oldPath, newPath }, 'Migrated config file');
        return true;
    } catch (error) {
        logger.error({ error, fileName, oldPath, newPath }, 'Failed to migrate config file');
        return false;
    }
}

/**
 * Migrate config files from old project-relative location to new user config directory
 * This is called automatically on startup
 */
export async function migrateConfigFiles(): Promise<void> {
    // Ensure new config directory exists
    await ensureConfigDir();

    // Track if any migrations occurred
    let migratedAny = false;

    // Migrate groups.json
    const migratedGroups = await migrateConfigFile(
        OLD_GROUPS_CONFIG_PATH,
        getGroupsConfigPath(),
        'groups.json'
    );
    migratedAny = migratedAny || migratedGroups;

    // Migrate backend-servers.json
    const migratedBackends = await migrateConfigFile(
        OLD_BACKEND_SERVERS_CONFIG_PATH,
        getBackendServersConfigPath(),
        'backend-servers.json'
    );
    migratedAny = migratedAny || migratedBackends;

    // Log migration summary
    if(migratedAny) {
        const configDir = getConfigDir();
        logger.info({ configDir }, 'Config files migrated to user config directory');
        // eslint-disable-next-line no-console -- Important migration message to stderr for user visibility
        console.error(`\n✓ Config files migrated to: ${configDir}\n`);
    } else {
        logger.debug('No config migration needed');
    }
}
