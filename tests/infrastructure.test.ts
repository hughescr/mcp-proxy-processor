/**
 * Infrastructure smoke tests - verifies test setup is working
 */

import _ from 'lodash';
import { describe, it, expect } from 'bun:test';
import {
    loadBackendServersFixture,
    loadGroupsFixture,
    getTestGroup,
    getTestBackendServer,
    createMockBackendServerConfig,
    createMockGroupConfig,
    assertDefined,
    assertContains,
    assertHasProperty
} from './utils/index.js';

describe('Test Infrastructure', () => {
    describe('Fixture Loading', () => {
        it('should load backend servers fixture', async () => {
            const config = await loadBackendServersFixture();
            expect(config).toBeDefined();
            expect(config.mcpServers).toBeDefined();
            expect(_.keys(config.mcpServers).length).toBeGreaterThan(0);
        });

        it('should load groups fixture', async () => {
            const config = await loadGroupsFixture();
            expect(config).toBeDefined();
            expect(config.groups).toBeDefined();
            expect(_.keys(config.groups).length).toBeGreaterThan(0);
        });

        it('should load specific test group', async () => {
            const group = await getTestGroup('minimal');
            expect(group).toBeDefined();
            expect(group.name).toBe('minimal');
            expect(group.tools).toBeArrayOfSize(1);
        });

        it('should load specific backend server', async () => {
            const server = await getTestBackendServer('time');
            expect(server).toBeDefined();
            expect(server.command).toBeDefined();
        });

        it('should throw error for non-existent group', async () => {
            expect(getTestGroup('does-not-exist')).rejects.toThrow();
        });

        it('should throw error for non-existent server', async () => {
            expect(getTestBackendServer('does-not-exist')).rejects.toThrow();
        });
    });

    describe('Mock Factories', () => {
        it('should create mock backend server config', () => {
            const config = createMockBackendServerConfig();
            expect(config).toBeDefined();
            expect(config.command).toBeDefined();
        });

        it('should create mock group config', () => {
            const config = createMockGroupConfig();
            expect(config).toBeDefined();
            expect(config.name).toBeDefined();
            expect(config.tools).toBeDefined();
        });

        it('should apply overrides to mock configs', () => {
            const config = createMockBackendServerConfig({
                command: '/custom/command',
                args:    ['--custom-arg'],
            });
            expect(config.command).toBe('/custom/command');
            expect(config.args).toEqual(['--custom-arg']);
        });
    });

    describe('Assertion Helpers', () => {
        it('assertDefined should pass for defined values', () => {
            expect(() => assertDefined('value')).not.toThrow();
            expect(() => assertDefined(0)).not.toThrow();
            expect(() => assertDefined(false)).not.toThrow();
        });

        it('assertDefined should throw for null/undefined', () => {
            expect(() => assertDefined(null)).toThrow();
            expect(() => assertDefined(undefined)).toThrow();
        });

        it('assertContains should pass when item is in array', () => {
            expect(() => assertContains([1, 2, 3], 2)).not.toThrow();
            expect(() => assertContains(['a', 'b'], 'a')).not.toThrow();
        });

        it('assertContains should throw when item is not in array', () => {
            expect(() => assertContains([1, 2, 3], 4)).toThrow();
            expect(() => assertContains(['a', 'b'], 'c')).toThrow();
        });

        it('assertHasProperty should pass when property exists', () => {
            const obj = { foo: 'bar' };
            expect(() => assertHasProperty(obj, 'foo')).not.toThrow();
        });

        it('assertHasProperty should throw when property does not exist', () => {
            const obj = { foo: 'bar' };
            expect(() => assertHasProperty(obj, 'baz')).toThrow();
        });
    });

    describe('Test Fixtures Content', () => {
        it('should have valid minimal group', async () => {
            const group = await getTestGroup('minimal');
            expect(group.name).toBe('minimal');
            expect(group.description).toContain('Minimal');
            expect(group.tools.length).toBe(1);
            expect(group.tools[0].serverName).toBe('time');
            expect(group.tools[0].originalName).toBe('get_current_time');
        });

        it('should have valid basic group with multiple servers', async () => {
            const group = await getTestGroup('basic');
            expect(group.name).toBe('basic');
            expect(group.tools.length).toBeGreaterThan(1);

            const serverNames = _.map(group.tools, 'serverName');
            expect(serverNames).toContain('time');
            expect(serverNames).toContain('calculator');
        });

        it('should have valid group with overrides', async () => {
            const group = await getTestGroup('with_overrides');
            expect(group.name).toBe('with_overrides');

            const overriddenTool = _.find(group.tools, t => t.name !== undefined);
            expect(overriddenTool).toBeDefined();
            assertDefined(overriddenTool);
            expect(overriddenTool.name).toBeDefined();
        });

        it('should have time server in backend config', async () => {
            const server = await getTestBackendServer('time');
            expect(server.command).toBe('uvx');
            expect(server.args).toContain('mcp-server-time@latest');
        });

        it('should have calculator server in backend config', async () => {
            const server = await getTestBackendServer('calculator');
            expect(server.command).toBe('uvx');
            expect(server.args).toBeDefined();
        });
    });
});
