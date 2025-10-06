/**
 * Integration tests for resource priority fallback system
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { detectResourceConflicts } from '../../src/middleware/resource-prompt-utils.js';
import type { ResourceConflict } from '../../src/types/config.js';
import { GroupManager } from '../../src/middleware/index.js';
import { createTempConfigFile } from '../fixtures/mock-configs.js';
import _ from 'lodash';
import type { GroupsConfig } from '../../src/types/config.js';
import type { Resource } from '@modelcontextprotocol/sdk/types';

describe('Resource Priority Fallback System', () => {
    let groupManager: GroupManager;
    let configPath: string;

    describe('Exact Duplicate Resource Handling', () => {
        beforeEach(async () => {
            const config: GroupsConfig = {
                groups: {
                    'duplicate-resources': {
                        name:      'duplicate-resources',
                        tools:     [],
                        resources: [
                            // Server 1 has priority (first in array)
                            {
                                uri:        'file:///data/config.json',
                                serverName: 'server-1',
                            },
                            // Server 2 has the same resource - should be deduplicated
                            {
                                uri:        'file:///data/config.json',
                                serverName: 'server-2',
                            },
                            // Server 3 has the same resource - should also be deduplicated
                            {
                                uri:        'file:///data/config.json',
                                serverName: 'server-3',
                            },
                        ],
                        prompts: [],
                    },
                },
            };
            configPath = await createTempConfigFile(config);
            groupManager = new GroupManager(configPath);
            await groupManager.load();
        });

        it('should keep only the first occurrence in resources/list', () => {
            const mockBackendResources = new Map<string, Resource[]>([
                [
                    'server-1',
                    [
                        {
                            uri:         'file:///data/config.json',
                            name:        'Config from Server 1',
                            description: 'Primary config file',
                            mimeType:    'application/json',
                        },
                    ],
                ],
                [
                    'server-2',
                    [
                        {
                            uri:         'file:///data/config.json',
                            name:        'Config from Server 2',
                            description: 'Secondary config file',
                            mimeType:    'application/json',
                        },
                    ],
                ],
                [
                    'server-3',
                    [
                        {
                            uri:         'file:///data/config.json',
                            name:        'Config from Server 3',
                            description: 'Tertiary config file',
                            mimeType:    'application/json',
                        },
                    ],
                ],
            ]);

            const resources = groupManager.getResourcesForGroup('duplicate-resources', mockBackendResources);

            // Should only have one resource (deduplicated)
            expect(resources).toHaveLength(1);
            expect(resources[0].uri).toBe('file:///data/config.json');
            // Should use the metadata from the highest priority server (server-1)
            expect(resources[0].name).toBe('Config from Server 1');
            expect(resources[0].description).toBe('Primary config file');
        });

        it('should fallback through servers when reading resources', () => {
            const group = groupManager.getGroup('duplicate-resources');
            expect(group).toBeDefined();

            // Get the server priority for this resource
            const resourceRef = group?.resources[0];
            expect(resourceRef?.serverName).toBe('server-1');

            // When server-1 fails, it should try server-2, then server-3
            const allRefs = _.filter(group?.resources, { uri: 'file:///data/config.json' });
            expect(allRefs).toHaveLength(3);
            expect(allRefs?.[0]?.serverName).toBe('server-1');
            expect(allRefs?.[1]?.serverName).toBe('server-2');
            expect(allRefs?.[2]?.serverName).toBe('server-3');
        });
    });

    describe('URI Template Matching', () => {
        beforeEach(async () => {
            const config: GroupsConfig = {
                groups: {
                    'template-resources': {
                        name:      'template-resources',
                        tools:     [],
                        resources: [
                            // Template with high priority
                            {
                                uri:        'file:///{+path}',
                                serverName: 'fs-server',
                            },
                            // Exact URI that matches the template
                            {
                                uri:        'file:///etc/hosts',
                                serverName: 'config-server',
                            },
                            // Another template that overlaps
                            {
                                uri:        'file:///{dir}/{file}',
                                serverName: 'advanced-fs',
                            },
                        ],
                        prompts: [],
                    },
                },
            };
            configPath = await createTempConfigFile(config);
            groupManager = new GroupManager(configPath);
            await groupManager.load();
        });

        it('should detect template-covers-exact conflicts', () => {
            const group = groupManager.getGroup('template-resources');
            const conflicts = detectResourceConflicts(group?.resources ?? []);

            // Should detect that 'file:///{+path}' template covers 'file:///etc/hosts'
            const templateCoversExact = _.find(conflicts, { type: 'template-covers-exact' });
            expect(templateCoversExact).toBeDefined();
            expect(templateCoversExact?.exampleUri).toBe('file:///etc/hosts');
        });

        it('should handle template variables in resource URIs', () => {
            const mockBackendResources = new Map<string, Resource[]>([
                [
                    'fs-server',
                    [
                        {
                            uri:         'file:///{+path}',
                            name:        'File System Resource',
                            description: 'Access any file',
                            mimeType:    'text/plain',
                        },
                    ],
                ],
                [
                    'config-server',
                    [
                        {
                            uri:         'file:///etc/hosts',
                            name:        'Hosts File',
                            description: 'System hosts configuration',
                            mimeType:    'text/plain',
                        },
                    ],
                ],
                [
                    'advanced-fs',
                    [
                        {
                            uri:         'file:///{dir}/{file}',
                            name:        'Advanced File Access',
                            description: 'Access files with path segments',
                            mimeType:    'text/plain',
                        },
                    ],
                ],
            ]);

            const resources = groupManager.getResourcesForGroup('template-resources', mockBackendResources);

            // All resources should be included despite overlaps (user's responsibility to handle)
            expect(resources.length).toBeGreaterThanOrEqual(2);

            // Check that templates are preserved
            const templateResource = _.find(resources, { uri: 'file:///{+path}' });
            expect(templateResource).toBeDefined();
            expect(templateResource?.name).toBe('File System Resource');
        });
    });

    describe('Fallback Chain Execution', () => {
        beforeEach(async () => {
            const config: GroupsConfig = {
                groups: {
                    'fallback-chain': {
                        name:      'fallback-chain',
                        tools:     [],
                        resources: [
                            {
                                uri:        'https://api.example.com/data',
                                serverName: 'primary-api',
                            },
                            {
                                uri:        'https://api.example.com/data',
                                serverName: 'backup-api',
                            },
                            {
                                uri:        'https://api.example.com/data',
                                serverName: 'tertiary-api',
                            },
                        ],
                        prompts: [],
                    },
                },
            };
            configPath = await createTempConfigFile(config);
            groupManager = new GroupManager(configPath);
            await groupManager.load();
        });

        it('should provide all servers in priority order for fallback', () => {
            const group = groupManager.getGroup('fallback-chain');
            expect(group).toBeDefined();

            // Check that all three servers are in the resource list
            const apiResources = _.filter(group?.resources, { uri: 'https://api.example.com/data' });
            expect(apiResources).toHaveLength(3);

            // Verify priority order
            expect(apiResources?.[0]?.serverName).toBe('primary-api');
            expect(apiResources?.[1]?.serverName).toBe('backup-api');
            expect(apiResources?.[2]?.serverName).toBe('tertiary-api');
        });

        it('should determine correct server for resource read', () => {
            const group = groupManager.getGroup('fallback-chain');
            expect(group).toBeDefined();

            // Get server mapping for resource directly from group config
            const resourceRef = group?.resources[0];
            expect(resourceRef?.serverName).toBe('primary-api');

            // All servers providing this resource from group config
            const allServers = _(group?.resources)
                .filter({ uri: 'https://api.example.com/data' })
                .map('serverName')
                .value();
            expect(allServers).toEqual(['primary-api', 'backup-api', 'tertiary-api']);
        });
    });

    describe('Template Overlap Detection', () => {
        beforeEach(async () => {
            const config: GroupsConfig = {
                groups: {
                    'overlapping-templates': {
                        name:      'overlapping-templates',
                        tools:     [],
                        resources: [
                            {
                                uri:        'http://api.{domain}/v1/{endpoint}',
                                serverName: 'api-gateway',
                            },
                            {
                                uri:        'http://api.{service}.com/v1/{+path}',
                                serverName: 'microservice',
                            },
                            {
                                uri:        'http://api.example.com/v1/users',
                                serverName: 'users-api',
                            },
                        ],
                        prompts: [],
                    },
                },
            };
            configPath = await createTempConfigFile(config);
            groupManager = new GroupManager(configPath);
            await groupManager.load();
        });

        it('should detect overlapping templates', () => {
            const group = groupManager.getGroup('overlapping-templates');
            const conflicts = detectResourceConflicts(group?.resources ?? []);

            // Should detect template overlaps
            const templateOverlaps = _.filter(conflicts, { type: 'template-overlap' });
            expect(templateOverlaps.length).toBeGreaterThan(0);

            // Should detect exact covered by template (templates come first, so template-covers-exact)
            const templateCoversExact = _.find(conflicts, { type: 'template-covers-exact' });
            expect(templateCoversExact).toBeDefined();
        });

        it('should generate example URIs for conflict reporting', () => {
            const group = groupManager.getGroup('overlapping-templates');
            const conflicts = detectResourceConflicts(group?.resources ?? []);

            _.forEach(conflicts, (conflict: ResourceConflict) => {
                expect(conflict.exampleUri).toBeDefined();
                expect(conflict.exampleUri).not.toBe('');
                // Example URIs should be concrete (no template variables)
                expect(conflict.exampleUri).not.toMatch(/\{[^}]+\}/);
            });
        });
    });

    describe('Mixed Resource Types', () => {
        beforeEach(async () => {
            const config: GroupsConfig = {
                groups: {
                    'mixed-resources': {
                        name:      'mixed-resources',
                        tools:     [],
                        resources: [
                            // Different types of resources
                            {
                                uri:        'file:///{+path}',
                                serverName: 'fs-server',
                            },
                            {
                                uri:        'https://api.github.com/repos/{owner}/{repo}',
                                serverName: 'github-api',
                            },
                            {
                                uri:        'sqlite:///data/app.db',
                                serverName: 'db-server',
                            },
                            {
                                uri:        'file:///etc/passwd',
                                serverName: 'config-reader',
                            },
                            {
                                uri:        'https://api.github.com/repos/microsoft/vscode',
                                serverName: 'vscode-api',
                            },
                        ],
                        prompts: [],
                    },
                },
            };
            configPath = await createTempConfigFile(config);
            groupManager = new GroupManager(configPath);
            await groupManager.load();
        });

        it('should handle different URI schemes without conflicts', () => {
            const group = groupManager.getGroup('mixed-resources');
            const conflicts = detectResourceConflicts(group?.resources ?? []);

            // Should only detect conflicts within same URI scheme/pattern
            // Should only detect conflicts within same URI scheme/pattern
            const _exactDuplicates = _.filter(conflicts, { type: 'exact-duplicate' });
            const templates = _.filter(conflicts, (c: ResourceConflict) =>
                c.type === 'template-covers-exact' || c.type === 'exact-covered-by-template'
            );

            const fileConflicts = _.filter(templates, (c: ResourceConflict) =>
                _.startsWith(c.exampleUri, 'file://')
            );
            const apiConflicts = _.filter(templates, (c: ResourceConflict) =>
                _.startsWith(c.exampleUri, 'https://api.github.com')
            );

            // file:///{+path} should conflict with file:///etc/passwd
            expect(fileConflicts.length).toBeGreaterThan(0);

            // GitHub API template should conflict with exact VSCode repo URI
            expect(apiConflicts.length).toBeGreaterThan(0);

            // SQLite URI shouldn't conflict with anything
            const sqliteConflicts = _.filter(conflicts, (c: ResourceConflict) =>
                c.exampleUri.includes('sqlite://')
            );
            expect(sqliteConflicts).toHaveLength(0);
        });

        it('should correctly deduplicate in resources/list', () => {
            const mockBackendResources = new Map<string, Resource[]>([
                ['fs-server', [
                    { uri: 'file:///{+path}', name: 'File System', mimeType: 'text/plain' },
                ]],
                ['github-api', [
                    { uri: 'https://api.github.com/repos/{owner}/{repo}', name: 'GitHub Repo', mimeType: 'application/json' },
                ]],
                ['db-server', [
                    { uri: 'sqlite:///data/app.db', name: 'App Database', mimeType: 'application/x-sqlite3' },
                ]],
                ['config-reader', [
                    { uri: 'file:///etc/passwd', name: 'Password File', mimeType: 'text/plain' },
                ]],
                ['vscode-api', [
                    { uri: 'https://api.github.com/repos/microsoft/vscode', name: 'VSCode Repo', mimeType: 'application/json' },
                ]],
            ]);

            const resources = groupManager.getResourcesForGroup('mixed-resources', mockBackendResources);

            // All resources should be present (no deduplication of non-duplicates)
            expect(resources.length).toBe(5);

            // Verify each unique resource is present
            expect(_.find(resources, { uri: 'file:///{+path}' })).toBeDefined();
            expect(_.find(resources, { uri: 'https://api.github.com/repos/{owner}/{repo}' })).toBeDefined();
            expect(_.find(resources, { uri: 'sqlite:///data/app.db' })).toBeDefined();
            expect(_.find(resources, { uri: 'file:///etc/passwd' })).toBeDefined();
            expect(_.find(resources, { uri: 'https://api.github.com/repos/microsoft/vscode' })).toBeDefined();
        });
    });
});
