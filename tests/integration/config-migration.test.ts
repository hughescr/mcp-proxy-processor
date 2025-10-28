/**
 * Configuration migration data integrity tests
 *
 * Tests that migrated config files:
 * 1. Parse as valid JSON
 * 2. Validate against Zod schemas
 * 3. Preserve all data fields correctly
 * 4. Handle edge cases (missing optional fields, empty arrays)
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keys as _keys, find as _find } from 'lodash';
import { BackendServersConfigSchema, GroupsConfigSchema } from '../../src/types/config.js';
import { migrateConfigFile } from '../../src/utils/config-migration.js';
import type { BackendServersConfig, GroupsConfig } from '../../src/types/config.js';

describe('Config Migration Data Integrity', () => {
    let tempDir: string;
    let oldPath: string;
    let newPath: string;

    beforeEach(async () => {
        // Create temporary directory for test files
        tempDir = await mkdtemp(join(tmpdir(), 'mcp-migration-test-'));
        oldPath = join(tempDir, 'old-config.json');
        newPath = join(tempDir, 'new-config.json');
    });

    afterEach(async () => {
        // Clean up temporary directory
        await rm(tempDir, { recursive: true, force: true });
    });

    describe('Backend Servers Migration', () => {
        test('should migrate valid backend servers config with schema validation', async () => {
            // Arrange: Create a comprehensive backend servers config
            const originalConfig: BackendServersConfig = {
                mcpServers: {
                    'server-with-all-fields': {
                        command: 'node',
                        args:    ['server.js', '--verbose'],
                        env:     {
                            API_KEY:     'test-key',
                            DEBUG:       'true',
                            CONFIG_PATH: '/etc/config',
                        },
                        cwd: '/app',
                    },
                    'server-minimal': {
                        command: 'npx',
                    },
                    'server-with-args-only': {
                        command: 'bun',
                        args:    ['run', 'start'],
                    },
                },
            };

            await writeFile(oldPath, JSON.stringify(originalConfig, null, 2));

            // Act: Migrate the file
            const migrated = await migrateConfigFile(oldPath, newPath, 'backend-servers.json');

            // Assert: Migration succeeded
            expect(migrated).toBe(true);

            // Read and parse migrated content
            const migratedContent = await readFile(newPath, 'utf-8');
            const migratedJson = JSON.parse(migratedContent) as unknown;

            // Validate against Zod schema
            const parseResult = BackendServersConfigSchema.safeParse(migratedJson);
            expect(parseResult.success).toBe(true);

            if(parseResult.success) {
                // Verify data integrity - all servers preserved
                expect(_keys(parseResult.data.mcpServers)).toHaveLength(3);
                expect(parseResult.data.mcpServers['server-with-all-fields']).toBeDefined();
                expect(parseResult.data.mcpServers['server-minimal']).toBeDefined();
                expect(parseResult.data.mcpServers['server-with-args-only']).toBeDefined();

                // Verify all fields preserved for comprehensive server
                const fullServer = parseResult.data.mcpServers['server-with-all-fields'];
                expect(fullServer.command).toBe('node');
                expect(fullServer.args).toEqual(['server.js', '--verbose']);
                expect(fullServer.env).toEqual({
                    API_KEY:     'test-key',
                    DEBUG:       'true',
                    CONFIG_PATH: '/etc/config',
                });
                expect(fullServer.cwd).toBe('/app');

                // Verify minimal server (only required fields)
                const minimalServer = parseResult.data.mcpServers['server-minimal'];
                expect(minimalServer.command).toBe('npx');
                expect(minimalServer.args).toBeUndefined();
                expect(minimalServer.env).toBeUndefined();
                expect(minimalServer.cwd).toBeUndefined();

                // Verify partial server (some optional fields)
                const partialServer = parseResult.data.mcpServers['server-with-args-only'];
                expect(partialServer.command).toBe('bun');
                expect(partialServer.args).toEqual(['run', 'start']);
                expect(partialServer.env).toBeUndefined();
            }
        });

        test('should handle empty mcpServers object', async () => {
            const originalConfig: BackendServersConfig = {
                mcpServers: {},
            };

            await writeFile(oldPath, JSON.stringify(originalConfig));

            const migrated = await migrateConfigFile(oldPath, newPath, 'backend-servers.json');
            expect(migrated).toBe(true);

            const migratedContent = await readFile(newPath, 'utf-8');
            const migratedJson = JSON.parse(migratedContent) as unknown;

            const parseResult = BackendServersConfigSchema.safeParse(migratedJson);
            expect(parseResult.success).toBe(true);

            if(parseResult.success) {
                expect(_keys(parseResult.data.mcpServers)).toHaveLength(0);
            }
        });

        test('should reject invalid backend config after migration', async () => {
            // Invalid: missing required 'command' field
            const invalidConfig = {
                mcpServers: {
                    'broken-server': {
                        args: ['test'],
                    },
                },
            };

            await writeFile(oldPath, JSON.stringify(invalidConfig));

            const migrated = await migrateConfigFile(oldPath, newPath, 'backend-servers.json');
            expect(migrated).toBe(true);

            const migratedContent = await readFile(newPath, 'utf-8');
            const migratedJson = JSON.parse(migratedContent) as unknown;

            // Schema validation should fail
            const parseResult = BackendServersConfigSchema.safeParse(migratedJson);
            expect(parseResult.success).toBe(false);

            if(!parseResult.success) {
                expect(parseResult.error.issues.length).toBeGreaterThan(0);
                expect(parseResult.error.issues[0].path).toContain('command');
            }
        });

        test('should reject backend config with unsupported transport type', async () => {
            const configWithType = {
                mcpServers: {
                    'sse-server': {
                        command: 'node',
                        type:    'sse', // Unsupported transport
                    },
                },
            };

            await writeFile(oldPath, JSON.stringify(configWithType));

            const migrated = await migrateConfigFile(oldPath, newPath, 'backend-servers.json');
            expect(migrated).toBe(true);

            const migratedContent = await readFile(newPath, 'utf-8');
            const migratedJson = JSON.parse(migratedContent) as unknown;

            // Schema validation should fail due to unsupported type
            const parseResult = BackendServersConfigSchema.safeParse(migratedJson);
            expect(parseResult.success).toBe(false);

            if(!parseResult.success) {
                const typeError = _find(parseResult.error.issues, issue =>
                    issue.message.includes('Only stdio transport is currently supported')
                );
                expect(typeError).toBeDefined();
            }
        });

        test('should preserve special characters in environment variables', async () => {
            const originalConfig: BackendServersConfig = {
                mcpServers: {
                    'server-with-special-chars': {
                        command: 'node',
                        env:     {
                            API_KEY:          'sk-test-123!@#$%^&*()',
                            JSON_CONFIG:      '{"key":"value","nested":{"foo":"bar"}}',
                            PATH_WITH_SPACES: '/path/with spaces/config',
                            MULTILINE:        'line1\nline2\nline3',
                        },
                    },
                },
            };

            await writeFile(oldPath, JSON.stringify(originalConfig, null, 2));

            const migrated = await migrateConfigFile(oldPath, newPath, 'backend-servers.json');
            expect(migrated).toBe(true);

            const migratedContent = await readFile(newPath, 'utf-8');
            const migratedJson = JSON.parse(migratedContent) as unknown;

            const parseResult = BackendServersConfigSchema.safeParse(migratedJson);
            expect(parseResult.success).toBe(true);

            if(parseResult.success) {
                const server = parseResult.data.mcpServers['server-with-special-chars'];
                expect(server.env?.API_KEY).toBe('sk-test-123!@#$%^&*()');
                expect(server.env?.JSON_CONFIG).toBe('{"key":"value","nested":{"foo":"bar"}}');
                expect(server.env?.PATH_WITH_SPACES).toBe('/path/with spaces/config');
                expect(server.env?.MULTILINE).toBe('line1\nline2\nline3');
            }
        });
    });

    describe('Groups Migration', () => {
        test('should migrate valid groups config with schema validation', async () => {
            const originalConfig: GroupsConfig = {
                groups: {
                    'full-featured-group': {
                        name:        'full-featured-group',
                        description: 'A group with all features',
                        tools:       [
                            {
                                serverName:   'server1',
                                originalName: 'original_tool',
                                name:         'renamed_tool',
                                description:  'Custom description',
                                inputSchema:  {
                                    type:       'object',
                                    properties: {
                                        arg1: { type: 'string' },
                                        arg2: { type: 'number' },
                                    },
                                    required: ['arg1'],
                                },
                            },
                            {
                                serverName:   'server2',
                                originalName: 'another_tool',
                            },
                        ],
                        resources: [
                            {
                                serverName: 'server1',
                                uri:        'file:///path/to/resource',
                            },
                            {
                                serverName: 'server2',
                                uri:        'http://example.com/{id}',
                            },
                        ],
                        prompts: [
                            {
                                serverName: 'server1',
                                name:       'prompt1',
                            },
                        ],
                    },
                    'minimal-group': {
                        name:  'minimal-group',
                        tools: [],
                    },
                },
            };

            await writeFile(oldPath, JSON.stringify(originalConfig, null, 2));

            const migrated = await migrateConfigFile(oldPath, newPath, 'groups.json');
            expect(migrated).toBe(true);

            const migratedContent = await readFile(newPath, 'utf-8');
            const migratedJson = JSON.parse(migratedContent) as unknown;

            const parseResult = GroupsConfigSchema.safeParse(migratedJson);
            expect(parseResult.success).toBe(true);

            if(parseResult.success) {
                // Verify both groups preserved
                expect(_keys(parseResult.data.groups)).toHaveLength(2);

                // Verify full-featured group
                const fullGroup = parseResult.data.groups['full-featured-group'];
                expect(fullGroup.name).toBe('full-featured-group');
                expect(fullGroup.description).toBe('A group with all features');
                expect(fullGroup.tools).toHaveLength(2);
                expect(fullGroup.resources).toHaveLength(2);
                expect(fullGroup.prompts).toHaveLength(1);

                // Verify tool with all fields
                const tool1 = fullGroup.tools[0];
                expect(tool1.serverName).toBe('server1');
                expect(tool1.originalName).toBe('original_tool');
                expect(tool1.name).toBe('renamed_tool');
                expect(tool1.description).toBe('Custom description');
                expect(tool1.inputSchema).toEqual({
                    type:       'object',
                    properties: {
                        arg1: { type: 'string' },
                        arg2: { type: 'number' },
                    },
                    required: ['arg1'],
                });

                // Verify tool with minimal fields
                const tool2 = fullGroup.tools[1];
                expect(tool2.serverName).toBe('server2');
                expect(tool2.originalName).toBe('another_tool');
                expect(tool2.name).toBeUndefined();
                expect(tool2.description).toBeUndefined();
                expect(tool2.inputSchema).toBeUndefined();

                // Verify resources
                expect(fullGroup.resources[0].serverName).toBe('server1');
                expect(fullGroup.resources[0].uri).toBe('file:///path/to/resource');
                expect(fullGroup.resources[1].serverName).toBe('server2');
                expect(fullGroup.resources[1].uri).toBe('http://example.com/{id}');

                // Verify prompts
                expect(fullGroup.prompts[0].serverName).toBe('server1');
                expect(fullGroup.prompts[0].name).toBe('prompt1');

                // Verify minimal group
                const minimalGroup = parseResult.data.groups['minimal-group'];
                expect(minimalGroup.name).toBe('minimal-group');
                expect(minimalGroup.description).toBeUndefined();
                expect(minimalGroup.tools).toHaveLength(0);
                expect(minimalGroup.resources).toHaveLength(0); // Default value
                expect(minimalGroup.prompts).toHaveLength(0); // Default value
            }
        });

        test('should handle empty groups object', async () => {
            const originalConfig: GroupsConfig = {
                groups: {},
            };

            await writeFile(oldPath, JSON.stringify(originalConfig));

            const migrated = await migrateConfigFile(oldPath, newPath, 'groups.json');
            expect(migrated).toBe(true);

            const migratedContent = await readFile(newPath, 'utf-8');
            const migratedJson = JSON.parse(migratedContent) as unknown;

            const parseResult = GroupsConfigSchema.safeParse(migratedJson);
            expect(parseResult.success).toBe(true);

            if(parseResult.success) {
                expect(_keys(parseResult.data.groups)).toHaveLength(0);
            }
        });

        test('should apply default values for missing optional arrays', async () => {
            // Group without resources/prompts fields
            const originalConfig = {
                groups: {
                    'test-group': {
                        name:  'test-group',
                        tools: [
                            {
                                serverName:   'server1',
                                originalName: 'tool1',
                            },
                        ],
                        // resources and prompts fields omitted
                    },
                },
            };

            await writeFile(oldPath, JSON.stringify(originalConfig));

            const migrated = await migrateConfigFile(oldPath, newPath, 'groups.json');
            expect(migrated).toBe(true);

            const migratedContent = await readFile(newPath, 'utf-8');
            const migratedJson = JSON.parse(migratedContent) as unknown;

            const parseResult = GroupsConfigSchema.safeParse(migratedJson);
            expect(parseResult.success).toBe(true);

            if(parseResult.success) {
                const group = parseResult.data.groups['test-group'];
                // Schema should apply default empty arrays
                expect(group.resources).toEqual([]);
                expect(group.prompts).toEqual([]);
            }
        });

        test('should reject invalid group config after migration', async () => {
            // Invalid: missing required 'originalName' in tool
            const invalidConfig = {
                groups: {
                    'broken-group': {
                        name:  'broken-group',
                        tools: [
                            {
                                serverName: 'server1',
                                // missing originalName
                            },
                        ],
                    },
                },
            };

            await writeFile(oldPath, JSON.stringify(invalidConfig));

            const migrated = await migrateConfigFile(oldPath, newPath, 'groups.json');
            expect(migrated).toBe(true);

            const migratedContent = await readFile(newPath, 'utf-8');
            const migratedJson = JSON.parse(migratedContent) as unknown;

            const parseResult = GroupsConfigSchema.safeParse(migratedJson);
            expect(parseResult.success).toBe(false);

            if(!parseResult.success) {
                expect(parseResult.error.issues.length).toBeGreaterThan(0);
                const missingFieldError = _find(parseResult.error.issues, issue =>
                    issue.path.includes('originalName')
                );
                expect(missingFieldError).toBeDefined();
            }
        });

        test('should preserve complex input schemas in tools', async () => {
            const complexSchema = {
                type:       'object',
                properties: {
                    simple: { type: 'string' },
                    array:  { type: 'array', items: { type: 'number' } },
                    nested: {
                        type:       'object',
                        properties: {
                            deep: { type: 'boolean' },
                        },
                    },
                    'enum': { type: 'string', 'enum': ['option1', 'option2', 'option3'] },
                    anyOf:  {
                        anyOf: [
                            { type: 'string' },
                            { type: 'number' },
                        ],
                    },
                },
                required:             ['simple', 'nested'],
                additionalProperties: false,
            };

            const originalConfig: GroupsConfig = {
                groups: {
                    'test-group': {
                        name:  'test-group',
                        tools: [
                            {
                                serverName:   'server1',
                                originalName: 'complex_tool',
                                inputSchema:  complexSchema,
                            },
                        ],
                    },
                },
            };

            await writeFile(oldPath, JSON.stringify(originalConfig, null, 2));

            const migrated = await migrateConfigFile(oldPath, newPath, 'groups.json');
            expect(migrated).toBe(true);

            const migratedContent = await readFile(newPath, 'utf-8');
            const migratedJson = JSON.parse(migratedContent) as unknown;

            const parseResult = GroupsConfigSchema.safeParse(migratedJson);
            expect(parseResult.success).toBe(true);

            if(parseResult.success) {
                const tool = parseResult.data.groups['test-group'].tools[0];
                expect(tool.inputSchema).toEqual(complexSchema);
            }
        });

        test('should preserve argument mapping configurations', async () => {
            const originalConfig = {
                groups: {
                    'mapping-group': {
                        name:  'mapping-group',
                        tools: [
                            {
                                serverName:      'server1',
                                originalName:    'mapped_tool',
                                argumentMapping: {
                                    type:     'template' as const,
                                    mappings: {
                                        backendParam1: {
                                            type:   'passthrough' as const,
                                            source: 'clientParam1',
                                        },
                                        backendParam2: {
                                            type:      'default' as const,
                                            source:    'clientParam2',
                                            'default': 'default_value',
                                        },
                                        backendParam3: {
                                            type:  'constant' as const,
                                            value: 42,
                                        },
                                    },
                                },
                            },
                            {
                                serverName:      'server2',
                                originalName:    'jsonata_tool',
                                argumentMapping: {
                                    type:       'jsonata' as const,
                                    expression: '{ "result": $uppercase(input) }',
                                },
                            },
                        ],
                    },
                },
            };

            await writeFile(oldPath, JSON.stringify(originalConfig, null, 2));

            const migrated = await migrateConfigFile(oldPath, newPath, 'groups.json');
            expect(migrated).toBe(true);

            const migratedContent = await readFile(newPath, 'utf-8');
            const migratedJson = JSON.parse(migratedContent) as unknown;

            const parseResult = GroupsConfigSchema.safeParse(migratedJson);
            expect(parseResult.success).toBe(true);

            if(parseResult.success) {
                const tools = parseResult.data.groups['mapping-group'].tools;

                // Verify template mapping
                const templateTool = tools[0];
                expect(templateTool.argumentMapping).toBeDefined();
                if(templateTool.argumentMapping?.type === 'template') {
                    expect(templateTool.argumentMapping.mappings.backendParam1).toEqual({
                        type:   'passthrough',
                        source: 'clientParam1',
                    });
                    expect(templateTool.argumentMapping.mappings.backendParam2).toEqual({
                        type:      'default',
                        source:    'clientParam2',
                        'default': 'default_value',
                    });
                    expect(templateTool.argumentMapping.mappings.backendParam3).toEqual({
                        type:  'constant',
                        value: 42,
                    });
                }

                // Verify JSONata mapping
                const jsonataTool = tools[1];
                expect(jsonataTool.argumentMapping).toBeDefined();
                if(jsonataTool.argumentMapping?.type === 'jsonata') {
                    expect(jsonataTool.argumentMapping.expression).toBe('{ "result": $uppercase(input) }');
                }
            }
        });
    });

    describe('Migration Edge Cases', () => {
        test('should not migrate if old file does not exist', async () => {
            // Don't create old file
            const migrated = await migrateConfigFile(oldPath, newPath, 'test.json');
            expect(migrated).toBe(false);
        });

        test('should not migrate if new file already exists', async () => {
            const config = { mcpServers: {} };

            await writeFile(oldPath, JSON.stringify(config));
            await writeFile(newPath, JSON.stringify(config)); // New file already exists

            const migrated = await migrateConfigFile(oldPath, newPath, 'test.json');
            expect(migrated).toBe(false);
        });

        test('should handle malformed JSON gracefully', async () => {
            // Write invalid JSON
            await writeFile(oldPath, '{ invalid json content }');

            // Migration will copy the file even if it's invalid JSON
            const migrated = await migrateConfigFile(oldPath, newPath, 'test.json');
            expect(migrated).toBe(true);

            // Reading as JSON should fail
            const content = await readFile(newPath, 'utf-8');
            expect(() => {
                JSON.parse(content);
            }).toThrow();
        });

        test('should preserve JSON formatting from original file', async () => {
            const config: BackendServersConfig = {
                mcpServers: {
                    server1: { command: 'node' },
                },
            };

            // Write with specific formatting (4-space indent)
            const formatted = JSON.stringify(config, null, 4);
            await writeFile(oldPath, formatted);

            const migrated = await migrateConfigFile(oldPath, newPath, 'test.json');
            expect(migrated).toBe(true);

            const migratedContent = await readFile(newPath, 'utf-8');
            // Exact byte-for-byte match
            expect(migratedContent).toBe(formatted);
        });
    });
});
