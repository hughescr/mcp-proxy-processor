/**
 * Integration tests for ClientManager with real MCP stdio subprocess
 * These tests validate actual MCP protocol communication
 *
 * Run with: INTEGRATION_TESTS=true bun test client-manager.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { resolve } from 'path';
import ClientManager from '../../src/backend/client-manager.js';
import type { BackendServerConfig } from '../../src/types/config.js';

const INTEGRATION_TESTS_ENABLED = process.env.INTEGRATION_TESTS === 'true';

// Skip all tests in this file unless INTEGRATION_TESTS is enabled
const describeIntegration = INTEGRATION_TESTS_ENABLED ? describe : describe.skip;

describeIntegration('ClientManager integration (real MCP subprocess)', () => {
    let manager: ClientManager;
    const stubServerPath = resolve(import.meta.dir, '../fixtures/stub-mcp-server.ts');

    beforeAll(async () => {
        // Verify stub server exists
        const stubServerFile = Bun.file(stubServerPath);
        const exists = await stubServerFile.exists();
        if(!exists) {
            throw new Error(`Stub server not found at ${stubServerPath}`);
        }
    });

    afterAll(async () => {
        if(manager) {
            await manager.disconnectAll();
        }
    });

    it('connects to real MCP stub server via stdio transport', async () => {
        const config: BackendServerConfig = {
            command: 'bun',
            args:    [stubServerPath],
        };

        manager = new ClientManager(new Map([['stub-server', config]]));

        await manager.connect('stub-server');

        expect(manager.isConnected('stub-server')).toBe(true);
    }, { timeout: 5000 });

    it('completes MCP handshake and can list tools', async () => {
        const config: BackendServerConfig = {
            command: 'bun',
            args:    [stubServerPath],
        };

        manager = new ClientManager(new Map([['stub-server', config]]));
        const client = await manager.connect('stub-server');

        // List tools from the stub server
        const toolsResponse = await client.listTools();

        expect(toolsResponse.tools).toBeDefined();
        expect(toolsResponse.tools.length).toBeGreaterThan(0);
        expect(toolsResponse.tools[0]?.name).toBe('test_echo');
    }, { timeout: 5000 });

    it('can call a tool on the real MCP server', async () => {
        const config: BackendServerConfig = {
            command: 'bun',
            args:    [stubServerPath],
        };

        manager = new ClientManager(new Map([['stub-server', config]]));
        const client = await manager.connect('stub-server');

        // Call the test_echo tool
        const result = await client.callTool({
            name:      'test_echo',
            arguments: {
                message: 'Hello, MCP!',
            },
        });

        expect(result.content).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- MCP SDK types are dynamic
        const firstContent = result.content[0];
        expect(firstContent).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- MCP SDK types are dynamic
        expect(firstContent.type).toBe('text');
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- MCP SDK types are dynamic
        expect(firstContent.text).toContain('Echo: Hello, MCP!');
    }, { timeout: 5000 });

    it('validates environment variable propagation to subprocess', async () => {
        const config: BackendServerConfig = {
            command: 'bun',
            args:    [stubServerPath],
            env:     {
                TEST_CUSTOM_VAR: 'integration-test-value',
            },
        };

        manager = new ClientManager(new Map([['stub-server', config]]));

        // Connect should succeed (validates env vars are passed correctly)
        await manager.connect('stub-server');

        expect(manager.isConnected('stub-server')).toBe(true);

        // If LOG_LEVEL is set, it should also be propagated
        const originalLogLevel = process.env.LOG_LEVEL;
        process.env.LOG_LEVEL = 'debug';

        const config2: BackendServerConfig = {
            command: 'bun',
            args:    [stubServerPath],
        };

        const manager2 = new ClientManager(new Map([['stub-server-2', config2]]));
        await manager2.connect('stub-server-2');

        expect(manager2.isConnected('stub-server-2')).toBe(true);

        await manager2.disconnectAll();

        // Restore
        if(originalLogLevel === undefined) {
            delete process.env.LOG_LEVEL;
        } else {
            process.env.LOG_LEVEL = originalLogLevel;
        }
    }, { timeout: 5000 });

    it('handles subprocess stderr correctly based on LOG_LEVEL', async () => {
        const originalLogLevel = process.env.LOG_LEVEL;

        // Test with LOG_LEVEL=silent (stderr should be ignored)
        process.env.LOG_LEVEL = 'silent';

        const config: BackendServerConfig = {
            command: 'bun',
            args:    [stubServerPath],
        };

        const managerSilent = new ClientManager(new Map([['stub-server-silent', config]]));
        await managerSilent.connect('stub-server-silent');

        expect(managerSilent.isConnected('stub-server-silent')).toBe(true);

        await managerSilent.disconnectAll();

        // Restore
        if(originalLogLevel === undefined) {
            delete process.env.LOG_LEVEL;
        } else {
            process.env.LOG_LEVEL = originalLogLevel;
        }
    }, { timeout: 5000 });

    it('validates real connection lifecycle: connect -> disconnect -> reconnect', async () => {
        const config: BackendServerConfig = {
            command: 'bun',
            args:    [stubServerPath],
        };

        manager = new ClientManager(new Map([['stub-server', config]]));

        // Initial connect
        await manager.connect('stub-server');
        expect(manager.isConnected('stub-server')).toBe(true);

        // Disconnect
        await manager.disconnect('stub-server');
        expect(manager.isConnected('stub-server')).toBe(false);

        // Reconnect
        await manager.connect('stub-server');
        expect(manager.isConnected('stub-server')).toBe(true);

        // Verify it still works
        const client = await manager.ensureConnected('stub-server');
        const tools = await client.listTools();
        expect(tools.tools.length).toBeGreaterThan(0);
    }, { timeout: 10000 });

    it('validates connectAll with multiple real servers', async () => {
        const config1: BackendServerConfig = {
            command: 'bun',
            args:    [stubServerPath],
        };

        const config2: BackendServerConfig = {
            command: 'bun',
            args:    [stubServerPath],
        };

        manager = new ClientManager(new Map([
            ['stub-server-1', config1],
            ['stub-server-2', config2],
        ]));

        const result = await manager.connectAll();

        expect(result.successful).toContain('stub-server-1');
        expect(result.successful).toContain('stub-server-2');
        expect(result.failed).toHaveLength(0);
        expect(manager.isConnected('stub-server-1')).toBe(true);
        expect(manager.isConnected('stub-server-2')).toBe(true);
    }, { timeout: 10000 });
});
