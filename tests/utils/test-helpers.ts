/**
 * Test utilities and helpers for MCP Proxy Processor tests
 */

import _ from 'lodash';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
    BackendServersConfig,
    GroupsConfig,
    GroupConfig,
    BackendServerConfig
} from '../../src/types/config.js';
import {
    BackendServersConfigSchema,
    GroupsConfigSchema
} from '../../src/types/config.js';

/**
 * Get the absolute path to the test fixtures directory
 */
export function getFixturesDir(): string {
    return join(import.meta.dir, '../fixtures');
}

/**
 * Load a test backend servers configuration file
 * @param filename - The fixture filename (defaults to 'backend-servers-test.json')
 */
export async function loadBackendServersFixture(filename = 'backend-servers-test.json'): Promise<BackendServersConfig> {
    const fixturesDir = getFixturesDir();
    const filePath = join(fixturesDir, filename);
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    return BackendServersConfigSchema.parse(parsed);
}

/**
 * Load a test groups configuration file
 * @param filename - The fixture filename (defaults to 'groups-test.json')
 */
export async function loadGroupsFixture(filename = 'groups-test.json'): Promise<GroupsConfig> {
    const fixturesDir = getFixturesDir();
    const filePath = join(fixturesDir, filename);
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    return GroupsConfigSchema.parse(parsed);
}

/**
 * Get a specific group config from the test fixtures
 * @param groupName - The name of the group to retrieve
 * @param filename - The fixture filename (defaults to 'groups-test.json')
 */
export async function getTestGroup(groupName: string, filename = 'groups-test.json'): Promise<GroupConfig> {
    const groupsConfig = await loadGroupsFixture(filename);
    const group = groupsConfig.groups[groupName];
    if(!group) {
        throw new Error(`Test group "${groupName}" not found in ${filename}`);
    }
    return group;
}

/**
 * Get a specific backend server config from the test fixtures
 * @param serverName - The name of the server to retrieve
 * @param filename - The fixture filename (defaults to 'backend-servers-test.json')
 */
export async function getTestBackendServer(serverName: string, filename = 'backend-servers-test.json'): Promise<BackendServerConfig> {
    const serversConfig = await loadBackendServersFixture(filename);
    const server = serversConfig.mcpServers[serverName];
    if(!server) {
        throw new Error(`Test backend server "${serverName}" not found in ${filename}`);
    }
    return server;
}

/**
 * Create a minimal valid backend server config for testing
 */
export function createMockBackendServerConfig(overrides: Partial<BackendServerConfig> = {}): BackendServerConfig {
    return {
        command: '/bin/echo',
        args:    ['test'],
        env:     {},
        ...overrides,
    };
}

/**
 * Create a minimal valid group config for testing
 */
export function createMockGroupConfig(overrides: Partial<GroupConfig> = {}): GroupConfig {
    return {
        name:        'test-group',
        description: 'Test group description',
        tools:       [],
        resources:   [],
        ...overrides,
    };
}

/**
 * Create a minimal valid backend servers config for testing
 */
export function createMockBackendServersConfig(servers: Record<string, BackendServerConfig> = {}): BackendServersConfig {
    return {
        mcpServers: {
            'mock-server': createMockBackendServerConfig(),
            ...servers,
        },
    };
}

/**
 * Create a minimal valid groups config for testing
 */
export function createMockGroupsConfig(groups: Record<string, GroupConfig> = {}): GroupsConfig {
    return {
        groups: {
            'mock-group': createMockGroupConfig(),
            ...groups,
        },
    };
}

/**
 * Assertion helper: Check if a value is defined (not null or undefined)
 */
export function assertDefined<T>(value: T | null | undefined, message?: string): asserts value is T {
    if(value === null || value === undefined) {
        throw new Error(message ?? 'Expected value to be defined');
    }
}

/**
 * Assertion helper: Check if an array contains an item
 */
export function assertContains<T>(array: T[], item: T, message?: string): void {
    if(!array.includes(item)) {
        throw new Error(message ?? `Expected array to contain ${JSON.stringify(item)}`);
    }
}

/**
 * Assertion helper: Check if an object has a property
 */
export function assertHasProperty<T extends object, K extends PropertyKey>(
    obj: T,
    key: K,
    message?: string
): asserts obj is T & Record<K, unknown> {
    if(!(key in obj)) {
        throw new Error(message ?? `Expected object to have property "${String(key)}"`);
    }
}

/**
 * Type guard: Check if error is an Error object
 */
export function isError(error: unknown): error is Error {
    return _.isError(error);
}

/**
 * Wait for a condition to become true (useful for async tests)
 * @param condition - Function that returns true when condition is met
 * @param timeout - Maximum time to wait in milliseconds (default: 5000)
 * @param interval - How often to check in milliseconds (default: 100)
 */
export async function waitFor(
    condition: () => boolean | Promise<boolean>,
    timeout = 5000,
    interval = 100
): Promise<void> {
    const startTime = Date.now();
    while(Date.now() - startTime < timeout) {
        if(await condition()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Create a timeout promise for testing timeouts
 */
export function timeout(ms: number): Promise<never> {
    return new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    });
}

/**
 * Mock console methods for testing (prevents test output pollution)
 */
export interface ConsoleMock {
    log:     typeof console.log
    error:   typeof console.error
    warn:    typeof console.warn
    restore: () => void
}

export function mockConsole(): ConsoleMock {
    /* eslint-disable no-console -- Console mocking requires direct console access for test utilities */
    const original = {
        log:   console.log,
        error: console.error,
        warn:  console.warn,
    };

    const messages = {
        log:   [] as unknown[],
        error: [] as unknown[],
        warn:  [] as unknown[],
    };

    console.log = (...args: unknown[]) => messages.log.push(args);
    console.error = (...args: unknown[]) => messages.error.push(args);
    console.warn = (...args: unknown[]) => messages.warn.push(args);

    return {
        log:     (...args: unknown[]) => messages.log.push(args),
        error:   (...args: unknown[]) => messages.error.push(args),
        warn:    (...args: unknown[]) => messages.warn.push(args),
        restore: () => {
            console.log = original.log;
            console.error = original.error;
            console.warn = original.warn;
        },
    };
    /* eslint-enable no-console -- Re-enable console linting */
}
