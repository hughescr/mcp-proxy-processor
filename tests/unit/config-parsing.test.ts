/**
 * Unit tests for configuration parsing and validation
 */

import { describe, it, expect } from 'bun:test';
import { BackendServersConfigSchema, GroupsConfigSchema, ToolOverrideSchema, ResourceOverrideSchema } from '../../src/types/config.js';
import { validBackendConfig, validGroupConfig, invalidBackendConfig, invalidGroupConfig, emptyBackendConfig, emptyGroupConfig } from '../fixtures/mock-configs.js';

describe('Config Parsing', () => {
    describe('BackendServersConfigSchema', () => {
        it('should parse valid backend server configuration', () => {
            const result = BackendServersConfigSchema.parse(validBackendConfig);
            expect(result).toEqual(validBackendConfig);
            expect(result.mcpServers['test-server-1'].command).toBe('node');
            expect(result.mcpServers['test-server-1'].args).toEqual(['server1.js']);
            expect(result.mcpServers['test-server-1'].env).toEqual({ API_KEY: 'test-key-1' });
        });

        it('should parse minimal backend server configuration', () => {
            const minimalConfig = {
                mcpServers: {
                    minimal: {
                        command: 'python',
                    },
                },
            };
            const result = BackendServersConfigSchema.parse(minimalConfig);
            expect(result.mcpServers.minimal.command).toBe('python');
            expect(result.mcpServers.minimal.args).toBeUndefined();
            expect(result.mcpServers.minimal.env).toBeUndefined();
        });

        it('should parse empty backend configuration', () => {
            const result = BackendServersConfigSchema.parse(emptyBackendConfig);
            expect(result).toEqual(emptyBackendConfig);
            expect(Object.keys(result.mcpServers)).toHaveLength(0);
        });

        it('should reject invalid backend configuration missing command', () => {
            expect(() => {
                BackendServersConfigSchema.parse(invalidBackendConfig);
            }).toThrow();
        });

        it('should reject backend configuration with wrong types', () => {
            const badConfig = {
                mcpServers: {
                    'bad-server': {
                        command: 123, // Should be string
                        args:    'not-an-array', // Should be array
                    },
                },
            };
            expect(() => {
                BackendServersConfigSchema.parse(badConfig);
            }).toThrow();
        });

        it('should reject backend configuration with invalid structure', () => {
            const badStructure = {
                // Missing mcpServers key
                servers: {
                    test: { command: 'node' },
                },
            };
            expect(() => {
                BackendServersConfigSchema.parse(badStructure);
            }).toThrow();
        });
    });

    describe('GroupsConfigSchema', () => {
        it('should parse valid groups configuration', () => {
            const result = GroupsConfigSchema.parse(validGroupConfig);
            expect(result).toEqual(validGroupConfig);
            expect(result.groups['test-group'].name).toBe('test-group');
            expect(result.groups['test-group'].description).toBe('Test group for unit tests');
            expect(result.groups['test-group'].tools).toHaveLength(2);
            expect(result.groups['test-group'].resources).toHaveLength(1);
        });

        it('should parse minimal group configuration', () => {
            const minimalGroup = {
                groups: {
                    minimal: {
                        name:  'minimal',
                        tools: [],
                    },
                },
            };
            const result = GroupsConfigSchema.parse(minimalGroup);
            expect(result.groups.minimal.name).toBe('minimal');
            expect(result.groups.minimal.description).toBeUndefined();
            expect(result.groups.minimal.tools).toEqual([]);
            expect(result.groups.minimal.resources).toEqual([]); // Should default to empty array
        });

        it('should parse empty groups configuration', () => {
            const result = GroupsConfigSchema.parse(emptyGroupConfig);
            expect(result).toEqual(emptyGroupConfig);
            expect(Object.keys(result.groups)).toHaveLength(0);
        });

        it('should default resources to empty array if not provided', () => {
            const groupWithoutResources = {
                groups: {
                    test: {
                        name:  'test',
                        tools: [],
                    },
                },
            };
            const result = GroupsConfigSchema.parse(groupWithoutResources);
            expect(result.groups.test.resources).toEqual([]);
        });

        it('should reject invalid group configuration missing required fields', () => {
            expect(() => {
                GroupsConfigSchema.parse(invalidGroupConfig);
            }).toThrow();
        });

        it('should reject group configuration with wrong types', () => {
            const badConfig = {
                groups: {
                    'bad-group': {
                        name:  'bad-group',
                        tools: 'not-an-array', // Should be array
                    },
                },
            };
            expect(() => {
                GroupsConfigSchema.parse(badConfig);
            }).toThrow();
        });

        it('should reject group configuration with invalid structure', () => {
            const badStructure = {
                // Missing groups key
                'test-group': {
                    name:  'test-group',
                    tools: [],
                },
            };
            expect(() => {
                GroupsConfigSchema.parse(badStructure);
            }).toThrow();
        });
    });

    describe('ToolOverrideSchema', () => {
        it('should parse valid tool override with all fields', () => {
            const toolOverride = {
                originalName: 'original_tool',
                serverName:   'test-server',
                name:         'new_tool_name',
                description:  'New description',
                inputSchema:  {
                    type:       'object',
                    properties: {
                        param: { type: 'string' },
                    },
                },
            };
            const result = ToolOverrideSchema.parse(toolOverride);
            expect(result).toEqual(toolOverride);
        });

        it('should parse minimal tool override with only required fields', () => {
            const minimalOverride = {
                originalName: 'tool',
                serverName:   'server',
            };
            const result = ToolOverrideSchema.parse(minimalOverride);
            expect(result.originalName).toBe('tool');
            expect(result.serverName).toBe('server');
            expect(result.name).toBeUndefined();
            expect(result.description).toBeUndefined();
            expect(result.inputSchema).toBeUndefined();
        });

        it('should reject tool override missing required fields', () => {
            const missingRequired = {
                name: 'new_name',
                // Missing originalName and serverName
            };
            expect(() => {
                ToolOverrideSchema.parse(missingRequired);
            }).toThrow();
        });

        it('should accept complex input schema', () => {
            const complexSchema = {
                originalName: 'tool',
                serverName:   'server',
                inputSchema:  {
                    type:       'object',
                    properties: {
                        nested: {
                            type:       'object',
                            properties: {
                                deep: { type: 'string' },
                            },
                        },
                        array: {
                            type:  'array',
                            items: { type: 'number' },
                        },
                    },
                    required: ['nested'],
                },
            };
            const result = ToolOverrideSchema.parse(complexSchema);
            expect(result.inputSchema).toEqual(complexSchema.inputSchema);
        });
    });

    describe('ResourceOverrideSchema', () => {
        it('should parse valid resource override with all fields', () => {
            const resourceOverride = {
                originalUri: 'test://resource',
                serverName:  'test-server',
                name:        'New Resource Name',
                description: 'New description',
                mimeType:    'application/json',
            };
            const result = ResourceOverrideSchema.parse(resourceOverride);
            expect(result).toEqual(resourceOverride);
        });

        it('should parse minimal resource override with only required fields', () => {
            const minimalOverride = {
                originalUri: 'test://resource',
                serverName:  'server',
            };
            const result = ResourceOverrideSchema.parse(minimalOverride);
            expect(result.originalUri).toBe('test://resource');
            expect(result.serverName).toBe('server');
            expect(result.name).toBeUndefined();
            expect(result.description).toBeUndefined();
            expect(result.mimeType).toBeUndefined();
        });

        it('should reject resource override missing required fields', () => {
            const missingRequired = {
                name: 'new_name',
                // Missing originalUri and serverName
            };
            expect(() => {
                ResourceOverrideSchema.parse(missingRequired);
            }).toThrow();
        });

        it('should accept various URI formats', () => {
            const uriFormats = [
                'http://example.com/resource',
                'https://api.example.com/data',
                'file:///path/to/resource',
                'custom://protocol/resource',
                'resource/path',
            ];

            for(const uri of uriFormats) {
                const override = {
                    originalUri: uri,
                    serverName:  'server',
                };
                const result = ResourceOverrideSchema.parse(override);
                expect(result.originalUri).toBe(uri);
            }
        });
    });

    describe('Edge Cases', () => {
        it('should handle null values correctly', () => {
            const configWithNulls = {
                mcpServers: {
                    test: {
                        command: 'node',
                        args:    null, // Should be rejected or converted
                        env:     null,
                    },
                },
            };
            expect(() => {
                BackendServersConfigSchema.parse(configWithNulls);
            }).toThrow();
        });

        it('should handle undefined values correctly', () => {
            const configWithUndefined = {
                mcpServers: {
                    test: {
                        command: 'node',
                        args:    undefined, // Should be fine (optional)
                        env:     undefined, // Should be fine (optional)
                    },
                },
            };
            const result = BackendServersConfigSchema.parse(configWithUndefined);
            expect(result.mcpServers.test.command).toBe('node');
            expect(result.mcpServers.test.args).toBeUndefined();
            expect(result.mcpServers.test.env).toBeUndefined();
        });

        it('should handle extra fields in configuration', () => {
            const configWithExtras = {
                mcpServers: {
                    test: {
                        command:    'node',
                        extraField: 'should be ignored',
                    },
                },
                anotherExtra: 'ignored',
            };
            // Zod by default strips unknown keys
            const result = BackendServersConfigSchema.parse(configWithExtras);
            expect(result.mcpServers.test.command).toBe('node');
            expect('extraField' in result.mcpServers.test).toBe(false);
            expect('anotherExtra' in result).toBe(false);
        });

        it('should validate deeply nested structures', () => {
            const deeplyNested = {
                groups: {
                    deep: {
                        name:  'deep',
                        tools: [
                            {
                                originalName: 'tool1',
                                serverName:   'server1',
                                inputSchema:  {
                                    type:       'object',
                                    properties: {
                                        level1: {
                                            type:       'object',
                                            properties: {
                                                level2: {
                                                    type:       'object',
                                                    properties: {
                                                        level3: { type: 'string' },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        ],
                        resources: [],
                    },
                },
            };
            const result = GroupsConfigSchema.parse(deeplyNested);
            expect(result.groups.deep.tools[0].inputSchema).toBeDefined();
        });
    });
});
