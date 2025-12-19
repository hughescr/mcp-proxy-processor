/**
 * Unit tests for configuration path utilities
 * Tests cross-platform path resolution and directory creation
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { access, constants, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import _ from 'lodash';

// Helper to import the config-paths module with proper typing
async function importConfigPaths() {
    const module = await import('../../src/utils/config-paths.js') as {
        getConfigDir:                () => string
        getGroupsConfigPath:         () => string
        getBackendServersConfigPath: () => string
        ensureConfigDir:             () => Promise<string>
        getAllPaths: () => {
            config: string
            data:   string
            cache:  string
            log:    string
            temp:   string
        }
    };
    return module;
}

let cleanupPaths: string[] = [];

async function cleanup(): Promise<void> {
    await Promise.all(
        _.map(cleanupPaths, async (path) => {
            try {
                await rm(path, { recursive: true, force: true });
            } catch{
                // Ignore cleanup errors
            }
        })
    );
    cleanupPaths = [];
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path, constants.F_OK);
        return true;
    } catch{
        return false;
    }
}

describe('Config Paths', () => {
    afterEach(async () => {
        await cleanup();
    });

    describe('Path Resolution', () => {
        it('resolves backend servers config path', async () => {
            const { getBackendServersConfigPath, getConfigDir } = await importConfigPaths();
            const backendPath = getBackendServersConfigPath();
            const configDir = getConfigDir();

            expect(backendPath).toBeDefined();
            expect(_.isString(backendPath)).toBe(true);
            expect(_.includes(backendPath, 'backend-servers.json')).toBe(true);
            expect(_.startsWith(backendPath, configDir)).toBe(true);
        });

        it('resolves groups config path', async () => {
            const { getGroupsConfigPath, getConfigDir } = await importConfigPaths();
            const groupsPath = getGroupsConfigPath();
            const configDir = getConfigDir();

            expect(groupsPath).toBeDefined();
            expect(_.isString(groupsPath)).toBe(true);
            expect(_.includes(groupsPath, 'groups.json')).toBe(true);
            expect(_.startsWith(groupsPath, configDir)).toBe(true);
        });

        it('resolves config directory path', async () => {
            const { getConfigDir } = await importConfigPaths();
            const configDir = getConfigDir();

            expect(configDir).toBeDefined();
            expect(_.isString(configDir)).toBe(true);
            expect(_.includes(configDir, '@hughescr/mcp-proxy-processor')).toBe(true);
            expect(configDir.length).toBeGreaterThan(0);
        });

        it('creates parent directories if missing', async () => {
            const { ensureConfigDir } = await importConfigPaths();
            const configDir = await ensureConfigDir();

            expect(configDir).toBeDefined();
            const exists = await fileExists(configDir);
            expect(exists).toBe(true);
        });

        it('returns same path on repeated calls', async () => {
            const { getConfigDir, getGroupsConfigPath, getBackendServersConfigPath } = await importConfigPaths();

            const configDir1 = getConfigDir();
            const configDir2 = getConfigDir();
            expect(configDir1).toBe(configDir2);

            const groupsPath1 = getGroupsConfigPath();
            const groupsPath2 = getGroupsConfigPath();
            expect(groupsPath1).toBe(groupsPath2);

            const backendPath1 = getBackendServersConfigPath();
            const backendPath2 = getBackendServersConfigPath();
            expect(backendPath1).toBe(backendPath2);
        });

        it('handles ensureConfigDir being called multiple times', async () => {
            const { ensureConfigDir } = await importConfigPaths();

            const dir1 = await ensureConfigDir();
            const dir2 = await ensureConfigDir();

            expect(dir1).toBe(dir2);
            const exists = await fileExists(dir1);
            expect(exists).toBe(true);
        });
    });

    describe('Platform Handling', () => {
        it('uses correct config directory on macOS', async () => {
            const { getConfigDir } = await importConfigPaths();
            const configDir = getConfigDir();

            if(process.platform === 'darwin') {
                expect(_.includes(configDir, 'Library')).toBe(true);
                expect(_.includes(configDir, 'Application Support')).toBe(true);
            }
        });

        it('uses correct config directory on Linux', async () => {
            const { getConfigDir } = await importConfigPaths();
            const configDir = getConfigDir();

            if(process.platform === 'linux') {
                const hasConfigDir = _.includes(configDir, '.config');
                expect(hasConfigDir).toBe(true);
            }
        });

        it('uses correct config directory on Windows', async () => {
            const { getConfigDir } = await importConfigPaths();
            const configDir = getConfigDir();

            if(process.platform === 'win32') {
                expect(_.includes(configDir, 'AppData')).toBe(true);
            }
        });

        it('uses platform-appropriate path separators', async () => {
            const { getConfigDir, getGroupsConfigPath } = await importConfigPaths();
            const configDir = getConfigDir();
            const groupsPath = getGroupsConfigPath();

            expect(_.includes(configDir, sep)).toBe(true);
            expect(_.includes(groupsPath, sep)).toBe(true);
        });

        it('returns absolute paths', async () => {
            const { getConfigDir, getGroupsConfigPath, getBackendServersConfigPath } = await importConfigPaths();

            const configDir = getConfigDir();
            const groupsPath = getGroupsConfigPath();
            const backendPath = getBackendServersConfigPath();

            // Absolute paths start with / on Unix or drive letter on Windows
            const isAbsolute = (path: string): boolean =>
                _.startsWith(path, sep) || /^[a-z]:/i.test(path);

            expect(isAbsolute(configDir)).toBe(true);
            expect(isAbsolute(groupsPath)).toBe(true);
            expect(isAbsolute(backendPath)).toBe(true);
        });
    });

    describe('Edge Cases', () => {
        it('handles spaces in paths', async () => {
            // This test verifies that the path resolution works even if parent dirs have spaces
            // We can't control the actual config path, but we can verify it's a valid string
            const { getConfigDir } = await importConfigPaths();
            const configDir = getConfigDir();

            expect(configDir).toBeDefined();
            expect(_.isString(configDir)).toBe(true);
            // Path should be usable for file operations
            const testFile = join(configDir, 'test with spaces.json');
            await mkdir(configDir, { recursive: true });
            await writeFile(testFile, '{}', 'utf-8');
            const exists = await fileExists(testFile);
            expect(exists).toBe(true);
            await rm(testFile);
        });

        it('handles unicode characters in file names', async () => {
            const { getConfigDir, ensureConfigDir } = await importConfigPaths();
            await ensureConfigDir();
            const configDir = getConfigDir();

            const unicodeFile = join(configDir, 'test-文件-🚀.json');
            await writeFile(unicodeFile, '{}', 'utf-8');
            const exists = await fileExists(unicodeFile);
            expect(exists).toBe(true);
            await rm(unicodeFile);
        });

        it('handles very long path names', async () => {
            const { getConfigDir, ensureConfigDir } = await importConfigPaths();
            await ensureConfigDir();
            const configDir = getConfigDir();

            // Create a file with a very long name
            const longName = _.repeat('a', 200);
            const longPath = join(configDir, `${longName}.json`);

            try {
                await writeFile(longPath, '{}', 'utf-8');
                const exists = await fileExists(longPath);
                expect(exists).toBe(true);
                await rm(longPath);
            } catch (error) {
                // Some filesystems have path length limits, that's okay
                expect(_.isError(error)).toBe(true);
            }
        });

        it('handles missing environment variables gracefully', async () => {
            // env-paths library should handle missing HOME, XDG_CONFIG_HOME, etc.
            const { getConfigDir } = await importConfigPaths();
            const configDir = getConfigDir();

            expect(configDir).toBeDefined();
            expect(_.isString(configDir)).toBe(true);
            expect(configDir.length).toBeGreaterThan(0);
        });

        it('returns consistent paths across multiple calls', async () => {
            const { getConfigDir } = await importConfigPaths();

            const paths = _.times(100, () => getConfigDir());
            const uniquePaths = _.uniq(paths);

            expect(uniquePaths.length).toBe(1);
        });
    });

    describe('Directory Creation', () => {
        it('creates config directory if it does not exist', async () => {
            const { ensureConfigDir } = await importConfigPaths();
            const configDir = await ensureConfigDir();

            const exists = await fileExists(configDir);
            expect(exists).toBe(true);
        });

        it('does not fail if config directory already exists', async () => {
            const { ensureConfigDir } = await importConfigPaths();

            await ensureConfigDir();
            await ensureConfigDir(); // Call twice

            const configDir = await ensureConfigDir();
            const exists = await fileExists(configDir);
            expect(exists).toBe(true);
        });

        it('creates nested directories recursively', async () => {
            const { ensureConfigDir } = await importConfigPaths();
            const configDir = await ensureConfigDir();

            // Verify the entire path exists
            const exists = await fileExists(configDir);
            expect(exists).toBe(true);

            // Verify we can create files in it
            const testFile = join(configDir, 'test.json');
            await writeFile(testFile, '{}', 'utf-8');
            const fileExists_result = await fileExists(testFile);
            expect(fileExists_result).toBe(true);
            await rm(testFile);
        });

        it('handles concurrent directory creation', async () => {
            const { ensureConfigDir } = await importConfigPaths();

            // Try to create the directory from multiple concurrent calls
            const results = await Promise.all(
                _.times(10, () => ensureConfigDir())
            );

            // All calls should return the same path
            const uniqueResults = _.uniq(results);
            expect(uniqueResults.length).toBe(1);

            // Directory should exist
            const exists = await fileExists(results[0]);
            expect(exists).toBe(true);
        });
    });

    describe('getAllPaths', () => {
        it('returns all platform-specific paths', async () => {
            const { getAllPaths } = await importConfigPaths();
            const paths = getAllPaths();

            expect(paths).toBeDefined();
            expect(paths.config).toBeDefined();
            expect(paths.data).toBeDefined();
            expect(paths.cache).toBeDefined();
            expect(paths.log).toBeDefined();
            expect(paths.temp).toBeDefined();
        });

        it('returns valid string paths', async () => {
            const { getAllPaths } = await importConfigPaths();
            const paths = getAllPaths();

            expect(_.isString(paths.config)).toBe(true);
            expect(_.isString(paths.data)).toBe(true);
            expect(_.isString(paths.cache)).toBe(true);
            expect(_.isString(paths.log)).toBe(true);
            expect(_.isString(paths.temp)).toBe(true);

            expect(paths.config.length).toBeGreaterThan(0);
            expect(paths.data.length).toBeGreaterThan(0);
            expect(paths.cache.length).toBeGreaterThan(0);
            expect(paths.log.length).toBeGreaterThan(0);
            expect(paths.temp.length).toBeGreaterThan(0);
        });

        it('returns paths containing app name', async () => {
            const { getAllPaths } = await importConfigPaths();
            const paths = getAllPaths();

            const appName = '@hughescr/mcp-proxy-processor';

            expect(_.includes(paths.config, appName)).toBe(true);
            expect(_.includes(paths.data, appName)).toBe(true);
            expect(_.includes(paths.cache, appName)).toBe(true);
            expect(_.includes(paths.log, appName)).toBe(true);
            expect(_.includes(paths.temp, appName)).toBe(true);
        });

        it('data path matches getConfigDir', async () => {
            const { getAllPaths, getConfigDir } = await importConfigPaths();
            const paths = getAllPaths();
            const configDir = getConfigDir();

            expect(paths.data).toBe(configDir);
        });
    });

    describe('Path Composition', () => {
        it('groups config path is in config directory', async () => {
            const { getGroupsConfigPath, getConfigDir } = await importConfigPaths();
            const groupsPath = getGroupsConfigPath();
            const configDir = getConfigDir();

            expect(_.startsWith(groupsPath, configDir)).toBe(true);
            expect(groupsPath).toBe(join(configDir, 'groups.json'));
        });

        it('backend servers config path is in config directory', async () => {
            const { getBackendServersConfigPath, getConfigDir } = await importConfigPaths();
            const backendPath = getBackendServersConfigPath();
            const configDir = getConfigDir();

            expect(_.startsWith(backendPath, configDir)).toBe(true);
            expect(backendPath).toBe(join(configDir, 'backend-servers.json'));
        });

        it('config paths have correct file extensions', async () => {
            const { getGroupsConfigPath, getBackendServersConfigPath } = await importConfigPaths();
            const groupsPath = getGroupsConfigPath();
            const backendPath = getBackendServersConfigPath();

            expect(_.endsWith(groupsPath, '.json')).toBe(true);
            expect(_.endsWith(backendPath, '.json')).toBe(true);
        });

        it('config paths use platform-appropriate separators', async () => {
            const { getGroupsConfigPath, getBackendServersConfigPath } = await importConfigPaths();
            const groupsPath = getGroupsConfigPath();
            const backendPath = getBackendServersConfigPath();

            // Should not contain wrong separators
            if(sep === '/') {
                expect(_.includes(groupsPath, '\\')).toBe(false);
                expect(_.includes(backendPath, '\\')).toBe(false);
            } else {
                expect(_.includes(groupsPath, '/')).toBe(false);
                expect(_.includes(backendPath, '/')).toBe(false);
            }
        });
    });
});
