/**
 * Configuration migration utilities
 * Handles migration from old project-relative config paths to new user config directory
 */

import { readFile, writeFile, access, constants } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dynamicLogger as logger } from './silent-logger.js';
import { getConfigDir, getGroupsConfigPath, getBackendServersConfigPath, ensureConfigDir, getAllPaths } from './config-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Old config paths (project-relative)
const PROJECT_CONFIG_DIR = join(__dirname, '..', '..', 'config');
const PROJECT_GROUPS_CONFIG_PATH = join(PROJECT_CONFIG_DIR, 'groups.json');
const PROJECT_BACKEND_SERVERS_CONFIG_PATH = join(PROJECT_CONFIG_DIR, 'backend-servers.json');

// Old config paths (Preferences directory - before migration to Application Support)
const paths = getAllPaths();
const PREFERENCES_GROUPS_CONFIG_PATH = join(paths.config, 'groups.json');
const PREFERENCES_BACKEND_SERVERS_CONFIG_PATH = join(paths.config, 'backend-servers.json');

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
export async function migrateConfigFile(oldPath: string, newPath: string, fileName: string): Promise<boolean> {
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

        // Write to new location atomically (fail if file already exists)
        // This prevents race conditions in concurrent migration attempts
        await writeFile(newPath, content, { encoding: 'utf-8', flag: 'wx' });

        logger.info({ fileName, oldPath, newPath }, 'Migrated config file');
        return true;
    } catch (error) {
        logger.error({ error, fileName, oldPath, newPath }, 'Failed to migrate config file');
        return false;
    }
}

/**
 * Migrate config files from old locations to new user config directory
 * This is called automatically on startup
 * Handles two migration paths:
 * 1. Project-relative (./config/) → Application Support
 * 2. Preferences directory → Application Support
 */
export async function migrateConfigFiles(): Promise<void> {
    // Ensure new config directory exists
    await ensureConfigDir();

    // Track if any migrations occurred
    let migratedAny = false;

    // Migration 1: Project-relative → Application Support
    // Migrate groups.json from project
    const migratedGroupsFromProject = await migrateConfigFile(
        PROJECT_GROUPS_CONFIG_PATH,
        getGroupsConfigPath(),
        'groups.json (from project)'
    );
    migratedAny = migratedAny || migratedGroupsFromProject;

    // Migrate backend-servers.json from project
    const migratedBackendsFromProject = await migrateConfigFile(
        PROJECT_BACKEND_SERVERS_CONFIG_PATH,
        getBackendServersConfigPath(),
        'backend-servers.json (from project)'
    );
    migratedAny = migratedAny || migratedBackendsFromProject;

    // Migration 2: Preferences → Application Support
    // Migrate groups.json from Preferences
    const migratedGroupsFromPrefs = await migrateConfigFile(
        PREFERENCES_GROUPS_CONFIG_PATH,
        getGroupsConfigPath(),
        'groups.json (from Preferences)'
    );
    migratedAny = migratedAny || migratedGroupsFromPrefs;

    // Migrate backend-servers.json from Preferences
    const migratedBackendsFromPrefs = await migrateConfigFile(
        PREFERENCES_BACKEND_SERVERS_CONFIG_PATH,
        getBackendServersConfigPath(),
        'backend-servers.json (from Preferences)'
    );
    migratedAny = migratedAny || migratedBackendsFromPrefs;

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
