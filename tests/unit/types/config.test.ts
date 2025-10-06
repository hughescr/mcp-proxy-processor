/**
 * Unit tests for configuration type validation
 */

import { describe, it, expect } from 'bun:test';
import {
    BackendServerConfigSchema,
    BackendServersConfigSchema,
    ToolOverrideSchema,
    GroupConfigSchema,
    GroupsConfigSchema
} from '../../../src/types/config.js';
import {
    createMockBackendServerConfig,
    createMockGroupConfig
} from '../../utils/test-helpers.js';

describe('Configuration Schemas', () => {
    describe('BackendServerConfigSchema', () => {
        it('should validate valid server config', () => {
            const valid = {
                command: 'uvx',
                args:    ['mcp-server-time'],
                env:     { TZ: 'UTC' },
            };

            const result = BackendServerConfigSchema.safeParse(valid);
            expect(result.success).toBe(true);
        });

        it('should validate minimal server config', () => {
            const minimal = {
                command: '/bin/echo',
            };

            const result = BackendServerConfigSchema.safeParse(minimal);
            expect(result.success).toBe(true);
        });

        it('should reject config without command', () => {
            const invalid = {
                args: ['test'],
            };

            const result = BackendServerConfigSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it('should reject invalid args type', () => {
            const invalid = {
                command: 'test',
                args:    'not-an-array',
            };

            const result = BackendServerConfigSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it('should reject invalid env type', () => {
            const invalid = {
                command: 'test',
                env:     ['not', 'an', 'object'],
            };

            const result = BackendServerConfigSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });
    });

    describe('BackendServersConfigSchema', () => {
        it('should validate valid servers config', () => {
            const valid = {
                mcpServers: {
                    time: {
                        command: 'uvx',
                        args:    ['mcp-server-time'],
                    },
                    calculator: {
                        command: 'uvx',
                        args:    ['calculator-mcp-server'],
                    },
                },
            };

            const result = BackendServersConfigSchema.safeParse(valid);
            expect(result.success).toBe(true);
        });

        it('should reject missing mcpServers', () => {
            const invalid = {};

            const result = BackendServersConfigSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it('should reject invalid server definition', () => {
            const invalid = {
                mcpServers: {
                    'bad-server': {
                        // Missing command
                        args: ['test'],
                    },
                },
            };

            const result = BackendServersConfigSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });
    });

    describe('ToolOverrideSchema', () => {
        it('should validate minimal tool override', () => {
            const valid = {
                serverName:   'time',
                originalName: 'get_current_time',
            };

            const result = ToolOverrideSchema.safeParse(valid);
            expect(result.success).toBe(true);
        });

        it('should validate full tool override', () => {
            const valid = {
                serverName:   'calculator',
                originalName: 'calculate',
                name:         'math_calc',
                description:  'Perform calculations',
                inputSchema:  {
                    type:       'object',
                    properties: { expr: { type: 'string' } },
                },
            };

            const result = ToolOverrideSchema.safeParse(valid);
            expect(result.success).toBe(true);
        });

        it('should reject missing serverName', () => {
            const invalid = {
                originalName: 'tool',
            };

            const result = ToolOverrideSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it('should reject missing originalName', () => {
            const invalid = {
                serverName: 'server',
            };

            const result = ToolOverrideSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });
    });

    describe('GroupConfigSchema', () => {
        it('should validate minimal group config', () => {
            const valid = {
                name:  'test-group',
                tools: [],
            };

            const result = GroupConfigSchema.safeParse(valid);
            expect(result.success).toBe(true);
            if(result.success) {
                expect(result.data.resources).toEqual([]);
            }
        });

        it('should validate full group config', () => {
            const valid = {
                name:        'test-group',
                description: 'Test group',
                tools:       [
                    {
                        serverName:   'time',
                        originalName: 'get_current_time',
                    },
                ],
                resources: [
                    {
                        serverName: 'time',
                        uri:        'config://app',
                    },
                ],
            };

            const result = GroupConfigSchema.safeParse(valid);
            expect(result.success).toBe(true);
        });

        it('should reject missing name', () => {
            const invalid = {
                tools: [],
            };

            const result = GroupConfigSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it('should reject missing tools', () => {
            const invalid = {
                name: 'test-group',
            };

            const result = GroupConfigSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it('should default resources to empty array', () => {
            const valid = {
                name:  'test-group',
                tools: [],
            };

            const result = GroupConfigSchema.parse(valid);
            expect(result.resources).toEqual([]);
        });
    });

    describe('GroupsConfigSchema', () => {
        it('should validate valid groups config', () => {
            const valid = {
                groups: {
                    group1: {
                        name:  'group1',
                        tools: [],
                    },
                    group2: {
                        name:        'group2',
                        description: 'Second group',
                        tools:       [
                            {
                                serverName:   'time',
                                originalName: 'get_current_time',
                            },
                        ],
                    },
                },
            };

            const result = GroupsConfigSchema.safeParse(valid);
            expect(result.success).toBe(true);
        });

        it('should reject missing groups', () => {
            const invalid = {};

            const result = GroupsConfigSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it('should reject invalid group definition', () => {
            const invalid = {
                groups: {
                    'bad-group': {
                        // Missing name and tools
                        description: 'Invalid group',
                    },
                },
            };

            const result = GroupsConfigSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });
    });

    describe('Mock Factory Validation', () => {
        it('should create valid backend server config', () => {
            const mock = createMockBackendServerConfig();
            const result = BackendServerConfigSchema.safeParse(mock);
            expect(result.success).toBe(true);
        });

        it('should create valid group config', () => {
            const mock = createMockGroupConfig();
            const result = GroupConfigSchema.safeParse(mock);
            expect(result.success).toBe(true);
        });

        it('should apply overrides correctly', () => {
            const mock = createMockBackendServerConfig({
                command: '/custom/command',
                args:    ['--custom'],
            });

            expect(mock.command).toBe('/custom/command');
            expect(mock.args).toEqual(['--custom']);
        });
    });
});
