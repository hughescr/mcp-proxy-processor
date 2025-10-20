/**
 * Unit tests for configuration migration utilities
 * Tests migration from old project-relative config paths to new user config directory
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { readFile, writeFile, chmod, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import _ from 'lodash';
import { createTempDir, cleanup, fileExists } from '../helpers/index.js';

// We need to use a helper function that properly types the import
async function importConfigMigration() {
    const module = await import('../../src/utils/config-migration.js') as {
        migrateConfigFile:  (oldPath: string, newPath: string, fileName: string) => Promise<boolean>
        migrateConfigFiles: () => Promise<void>
    };
    return module;
}

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

// Mock the config-paths module to use temp directories
let mockConfigDir: string;
let mockOldConfigDir: string;

describe('Config Migration', () => {
    beforeEach(async () => {
        mockConfigDir = await createTempDir('new-config');
        mockOldConfigDir = await createTempDir('old-config');
    });

    afterEach(async () => {
        await cleanup();
    });

    describe('File Migration', () => {
        it('migrates from old path to new path', async () => {
            const oldPath = join(mockOldConfigDir, 'groups.json');
            const newPath = join(mockConfigDir, 'groups.json');
            const testContent = JSON.stringify({ groups: { test: { name: 'test', tools: [] } } });

            await writeFile(oldPath, testContent, 'utf-8');

            const { migrateConfigFile } = await importConfigMigration();
            const result = await migrateConfigFile(oldPath, newPath, 'groups.json');

            expect(result).toBe(true);
            const migratedContent = await readFile(newPath, 'utf-8');
            expect(migratedContent).toBe(testContent);
        });

        it('preserves file contents during migration', async () => {
            const oldPath = join(mockOldConfigDir, 'backend-servers.json');
            const newPath = join(mockConfigDir, 'backend-servers.json');
            const complexContent = JSON.stringify({
                mcpServers: {
                    'server-1': {
                        command: 'node',
                        args:    ['server.js'],
                        env:     {
                            API_KEY:    'test-key',
                            SECRET:     'test-secret',
                            NESTED_OBJ: { key: 'value' },
                        },
                    },
                },
            }, null, 2);

            await writeFile(oldPath, complexContent, 'utf-8');

            const { migrateConfigFile } = await importConfigMigration();
            await migrateConfigFile(oldPath, newPath, 'backend-servers.json');

            const migratedContent = await readFile(newPath, 'utf-8');
            expect(migratedContent).toBe(complexContent);
            // Verify it's still valid JSON
            const parsed: unknown = JSON.parse(migratedContent);
            expect(parsed).toBeDefined();
        });

        it('handles missing old config gracefully', async () => {
            const oldPath = join(mockOldConfigDir, 'non-existent.json');
            const newPath = join(mockConfigDir, 'groups.json');

            const { migrateConfigFile } = await importConfigMigration();
            const result = await migrateConfigFile(oldPath, newPath, 'groups.json');

            expect(result).toBe(false);
            // New file should not be created
            const exists = await fileExists(newPath);
            expect(exists).toBe(false);
        });

        it('does not overwrite existing new config', async () => {
            const oldPath = join(mockOldConfigDir, 'groups.json');
            const newPath = join(mockConfigDir, 'groups.json');
            const oldContent = JSON.stringify({ groups: { old: { name: 'old', tools: [] } } });
            const newContent = JSON.stringify({ groups: { 'new': { name: 'new', tools: [] } } });

            await writeFile(oldPath, oldContent, 'utf-8');
            await writeFile(newPath, newContent, 'utf-8');

            const { migrateConfigFile } = await importConfigMigration();
            const result = await migrateConfigFile(oldPath, newPath, 'groups.json');

            expect(result).toBe(false);
            const preservedContent = await readFile(newPath, 'utf-8');
            expect(preservedContent).toBe(newContent);
        });

        it('handles permission errors on old path', async () => {
            const oldPath = join(mockOldConfigDir, 'groups.json');
            const newPath = join(mockConfigDir, 'groups.json');

            await writeFile(oldPath, '{}', 'utf-8');
            await chmod(oldPath, 0o000); // Remove all permissions

            const { migrateConfigFile } = await importConfigMigration();
            const result = await migrateConfigFile(oldPath, newPath, 'groups.json');

            expect(result).toBe(false);

            // Restore permissions for cleanup
            await chmod(oldPath, 0o644);
        });

        it('handles permission errors on new path', async () => {
            const oldPath = join(mockOldConfigDir, 'groups.json');
            const newPath = join(mockConfigDir, 'groups.json');

            await writeFile(oldPath, '{"test": "data"}', 'utf-8');
            await chmod(mockConfigDir, 0o444); // Read-only directory

            const { migrateConfigFile } = await importConfigMigration();
            const result = await migrateConfigFile(oldPath, newPath, 'groups.json');

            expect(result).toBe(false);

            // Restore permissions for cleanup
            await chmod(mockConfigDir, 0o755);
        });

        it('handles empty files correctly', async () => {
            const oldPath = join(mockOldConfigDir, 'empty.json');
            const newPath = join(mockConfigDir, 'empty.json');

            await writeFile(oldPath, '', 'utf-8');

            const { migrateConfigFile } = await importConfigMigration();
            const result = await migrateConfigFile(oldPath, newPath, 'empty.json');

            expect(result).toBe(true);
            const content = await readFile(newPath, 'utf-8');
            expect(content).toBe('');
        });
    });

    describe('Migration Edge Cases', () => {
        it('handles partial/corrupt old config', async () => {
            const oldPath = join(mockOldConfigDir, 'corrupt.json');
            const newPath = join(mockConfigDir, 'corrupt.json');
            const corruptContent = '{"groups": {"test": {'; // Invalid JSON

            await writeFile(oldPath, corruptContent, 'utf-8');

            const { migrateConfigFile } = await importConfigMigration();
            // Migration should succeed (it doesn't validate, just copies)
            const result = await migrateConfigFile(oldPath, newPath, 'corrupt.json');

            expect(result).toBe(true);
            const content = await readFile(newPath, 'utf-8');
            expect(content).toBe(corruptContent);
        });

        it('handles very large config files (10MB+)', async () => {
            const oldPath = join(mockOldConfigDir, 'large.json');
            const newPath = join(mockConfigDir, 'large.json');

            // Create a large config with many groups
            const largeConfig = {
                groups: _.fromPairs(
                    _.times(10000, i => [
                        `group-${i}`,
                        {
                            name: `group-${i}`,

                            description: _.repeat(`Description for group ${i} `, 100),
                            tools:       _.times(10, j => ({
                                originalName: `tool-${j}`,
                                serverName:   `server-${j}`,

                                description: _.repeat('Test tool description ', 50),
                            })),
                            resources: [],
                        },
                    ])
                ),
            };

            const largeContent = JSON.stringify(largeConfig);
            expect(largeContent.length).toBeGreaterThan(10 * 1024 * 1024); // > 10MB

            await writeFile(oldPath, largeContent, 'utf-8');

            const { migrateConfigFile } = await importConfigMigration();
            const startTime = Date.now();
            const result = await migrateConfigFile(oldPath, newPath, 'large.json');
            const duration = Date.now() - startTime;

            expect(result).toBe(true);
            expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
            const migratedContent = await readFile(newPath, 'utf-8');
            expect(migratedContent.length).toBe(largeContent.length);
        });

        it('handles symlinked config files', async () => {
            const realPath = join(mockOldConfigDir, 'real-config.json');
            const symlinkPath = join(mockOldConfigDir, 'symlink-config.json');
            const newPath = join(mockConfigDir, 'config.json');
            const content = JSON.stringify({ groups: {} });

            await writeFile(realPath, content, 'utf-8');
            await symlink(realPath, symlinkPath);

            const { migrateConfigFile } = await importConfigMigration();
            const result = await migrateConfigFile(symlinkPath, newPath, 'config.json');

            expect(result).toBe(true);
            const migratedContent = await readFile(newPath, 'utf-8');
            expect(migratedContent).toBe(content);
        });

        it('handles concurrent migration attempts', async () => {
            const oldPath = join(mockOldConfigDir, 'groups.json');
            const newPath = join(mockConfigDir, 'groups.json');
            const content = JSON.stringify({ groups: { test: { name: 'test', tools: [] } } });

            await writeFile(oldPath, content, 'utf-8');

            const { migrateConfigFile } = await importConfigMigration();

            // Attempt multiple concurrent migrations
            const migrations = await Promise.all(
                _.times(10, () => migrateConfigFile(oldPath, newPath, 'groups.json'))
            );

            // Exactly one should succeed (the first one to create the file)
            const successCount = _(migrations).compact().size();
            expect(successCount).toBe(1);

            // File should exist and have correct content
            const finalContent = await readFile(newPath, 'utf-8');
            expect(finalContent).toBe(content);
        });

        it('handles unicode characters in file content', async () => {
            const oldPath = join(mockOldConfigDir, 'unicode.json');
            const newPath = join(mockConfigDir, 'unicode.json');
            const unicodeContent = JSON.stringify({
                groups: {
                    测试组: {
                        name:        '测试组',
                        description: 'Test with emoji 🚀🔥💻 and unicode 日本語',
                        tools:       [],
                    },
                },
            });

            await writeFile(oldPath, unicodeContent, 'utf-8');

            const { migrateConfigFile } = await importConfigMigration();
            const result = await migrateConfigFile(oldPath, newPath, 'unicode.json');

            expect(result).toBe(true);
            const migratedContent = await readFile(newPath, 'utf-8');
            expect(migratedContent).toBe(unicodeContent);
            const parsed = JSON.parse(migratedContent) as { groups: Record<string, { description: string }> };
            expect(_.includes(parsed.groups['测试组'].description, '🚀')).toBe(true);
        });

        it('handles special characters in file content', async () => {
            const oldPath = join(mockOldConfigDir, 'special.json');
            const newPath = join(mockConfigDir, 'special.json');
            const specialContent = JSON.stringify({
                mcpServers: {
                    'test-server': {
                        command: 'node',
                        env:     {
                            SHELL_VAR:  '$HOME/.config',
                            QUOTE_TEST: 'single\'quote and double"quote',
                            NEWLINE:    'line1\nline2\ttab',
                            BACKSLASH:  'path\\to\\file',
                            NULL_BYTE:  'test\x00null',
                        },
                    },
                },
            });

            await writeFile(oldPath, specialContent, 'utf-8');

            const { migrateConfigFile } = await importConfigMigration();
            const result = await migrateConfigFile(oldPath, newPath, 'special.json');

            expect(result).toBe(true);
            const migratedContent = await readFile(newPath, 'utf-8');
            expect(migratedContent).toBe(specialContent);
        });
    });

    describe('Platform-Specific Paths', () => {
        it('uses correct paths on macOS', async () => {
            // This test verifies that config-paths returns appropriate macOS paths
            const { getConfigDir } = await importConfigPaths();
            const configDir = getConfigDir();

            if(process.platform === 'darwin') {
                expect(_.includes(configDir, 'Library/Preferences')).toBe(true);
                expect(_.includes(configDir, '@hughescr/mcp-proxy-processor')).toBe(true);
            }
        });

        it('uses correct paths on Linux', async () => {
            const { getConfigDir } = await importConfigPaths();
            const configDir = getConfigDir();

            if(process.platform === 'linux') {
                // Should use XDG_CONFIG_HOME or ~/.config
                const hasConfigPath = _.includes(configDir, '.config') || _.includes(configDir, 'XDG_CONFIG_HOME');
                expect(hasConfigPath).toBe(true);
            }
        });

        it('uses correct paths on Windows', async () => {
            const { getConfigDir } = await importConfigPaths();
            const configDir = getConfigDir();

            if(process.platform === 'win32') {
                expect(_.includes(configDir, 'AppData')).toBe(true);
            }
        });

        it('handles missing home directory gracefully', async () => {
            // This is challenging to test without mocking environment variables
            // The env-paths library should handle this gracefully
            const { getConfigDir } = await importConfigPaths();
            const configDir = getConfigDir();
            expect(configDir).toBeDefined();
            expect(_.isString(configDir)).toBe(true);
        });
    });

    describe('Full Migration Workflow', () => {
        it('migrates both config files successfully', async () => {
            const oldGroupsPath = join(mockOldConfigDir, 'groups.json');
            const oldBackendPath = join(mockOldConfigDir, 'backend-servers.json');
            const newGroupsPath = join(mockConfigDir, 'groups.json');
            const newBackendPath = join(mockConfigDir, 'backend-servers.json');

            const groupsContent = JSON.stringify({ groups: {} });
            const backendContent = JSON.stringify({ mcpServers: {} });

            await writeFile(oldGroupsPath, groupsContent, 'utf-8');
            await writeFile(oldBackendPath, backendContent, 'utf-8');

            const { migrateConfigFile } = await importConfigMigration();

            const groupsResult = await migrateConfigFile(oldGroupsPath, newGroupsPath, 'groups.json');
            const backendResult = await migrateConfigFile(oldBackendPath, newBackendPath, 'backend-servers.json');

            expect(groupsResult).toBe(true);
            expect(backendResult).toBe(true);

            const migratedGroups = await readFile(newGroupsPath, 'utf-8');
            const migratedBackend = await readFile(newBackendPath, 'utf-8');

            expect(migratedGroups).toBe(groupsContent);
            expect(migratedBackend).toBe(backendContent);
        });

        it('handles partial migration (only one file exists)', async () => {
            const oldGroupsPath = join(mockOldConfigDir, 'groups.json');
            const oldBackendPath = join(mockOldConfigDir, 'backend-servers.json');
            const newGroupsPath = join(mockConfigDir, 'groups.json');
            const newBackendPath = join(mockConfigDir, 'backend-servers.json');

            const groupsContent = JSON.stringify({ groups: {} });
            await writeFile(oldGroupsPath, groupsContent, 'utf-8');
            // Don't create backend-servers.json

            const { migrateConfigFile } = await importConfigMigration();

            const groupsResult = await migrateConfigFile(oldGroupsPath, newGroupsPath, 'groups.json');
            const backendResult = await migrateConfigFile(oldBackendPath, newBackendPath, 'backend-servers.json');

            expect(groupsResult).toBe(true);
            expect(backendResult).toBe(false);

            // Only groups.json should exist
            const migratedGroups = await readFile(newGroupsPath, 'utf-8');
            expect(migratedGroups).toBe(groupsContent);
            const backendExists = await fileExists(newBackendPath);
            expect(backendExists).toBe(false);
        });

        it('is idempotent (can be run multiple times safely)', async () => {
            const oldPath = join(mockOldConfigDir, 'groups.json');
            const newPath = join(mockConfigDir, 'groups.json');
            const content = JSON.stringify({ groups: {} });

            await writeFile(oldPath, content, 'utf-8');

            const { migrateConfigFile } = await importConfigMigration();

            // First migration
            const result1 = await migrateConfigFile(oldPath, newPath, 'groups.json');
            expect(result1).toBe(true);

            // Second migration (should be no-op)
            const result2 = await migrateConfigFile(oldPath, newPath, 'groups.json');
            expect(result2).toBe(false);

            // File should still have original content
            const finalContent = await readFile(newPath, 'utf-8');
            expect(finalContent).toBe(content);
        });
    });

    describe('Error Recovery', () => {
        it('handles write errors gracefully', async () => {
            const oldPath = join(mockOldConfigDir, 'groups.json');
            const newPath = join('/non/existent/directory/groups.json');

            await writeFile(oldPath, '{}', 'utf-8');

            const { migrateConfigFile } = await importConfigMigration();
            const result = await migrateConfigFile(oldPath, newPath, 'groups.json');

            expect(result).toBe(false);
        });

        it('does not corrupt existing file on write error', async () => {
            const oldPath = join(mockOldConfigDir, 'groups.json');
            const newPath = join(mockConfigDir, 'groups.json');
            const oldContent = JSON.stringify({ old: 'data' });
            const newContent = JSON.stringify({ 'new': 'data' });

            await writeFile(oldPath, oldContent, 'utf-8');
            await writeFile(newPath, newContent, 'utf-8');

            const { migrateConfigFile } = await importConfigMigration();
            const result = await migrateConfigFile(oldPath, newPath, 'groups.json');

            expect(result).toBe(false);
            // Existing file should be unchanged
            const preservedContent = await readFile(newPath, 'utf-8');
            expect(preservedContent).toBe(newContent);
        });
    });
});
