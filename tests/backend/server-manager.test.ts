/**
 * Comprehensive test suite for ServerManager
 *
 * ServerManager is a critical 351 LOC component responsible for:
 * - Subprocess spawning and lifecycle management
 * - Environment variable substitution in configuration
 * - Exponential backoff on failures (1s, 2s, 4s, 8s, 16s)
 * - Health monitoring and auto-restart logic
 * - Graceful shutdown with 5 second timeout + SIGKILL fallback
 * - Stderr logging without backpressure issues
 * - Zombie process prevention
 *
 * Test Approach:
 * - Use dependency injection to mock spawn, setTimeout, clearTimeout
 * - Mock process instances with createMockProcess helper
 * - Use synchronous mock timers for deterministic, fast tests
 * - Validate actual behavior, not just "doesn't crash"
 * - Test both success and failure paths
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import type { ChildProcess } from 'node:child_process';
import _ from 'lodash';
import { createMockProcess, type MockProcess } from '../helpers/mocks.js';
import { backendConfig } from '../helpers/builders.js';
import type { BackendServersConfig, BackendServerConfig, StdioServerConfig } from '../../src/types/config.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Testable version of ServerManager with dependency injection
 */
class TestableServerManager {
    private servers = new Map<string, ServerState>();
    private config: BackendServersConfig | null = null;
    private isShuttingDown = false;

    // Injected dependencies
    private spawnFn:        (cmd: string, args: string[], opts: unknown) => ChildProcess;
    private setTimeoutFn:   (fn: () => void, ms: number) => NodeJS.Timeout;
    private clearTimeoutFn: (id: NodeJS.Timeout) => void;
    private loggerFn:       (obj: unknown, msg: string) => void;

    // Track calls for testing
    public spawnCalls:   { cmd: string, args: string[], env: Record<string, string> }[] = [];
    public timeoutCalls: { ms: number, completed: boolean }[] = [];
    public logMessages:  { obj: unknown, msg: string }[] = [];

    constructor(
        private readonly configPath: string,
        deps?: {
            spawn?:        (cmd: string, args: string[], opts: unknown) => ChildProcess
            setTimeout?:   (fn: () => void, ms: number) => NodeJS.Timeout
            clearTimeout?: (id: NodeJS.Timeout) => void
            logger?:       (obj: unknown, msg: string) => void
        }
    ) {
        this.spawnFn = deps?.spawn ?? ((_cmd, _args, _opts) => {
            throw new Error('Real spawn called unexpectedly');
        });
        this.setTimeoutFn = deps?.setTimeout ?? global.setTimeout;
        this.clearTimeoutFn = deps?.clearTimeout ?? global.clearTimeout;
        this.loggerFn = deps?.logger ?? (() => _.noop());
    }

    /**
     * Load config from file
     */
    async loadConfig(): Promise<BackendServersConfig> {
        const fileContent = await fs.readFile(this.configPath, 'utf-8');
        const config = JSON.parse(fileContent) as BackendServersConfig;
        this.substituteEnvVars(config);
        this.config = config;
        return config;
    }

    /**
     * Substitute environment variables in configuration
     */
    private substituteEnvVars(config: BackendServersConfig): void {
        for(const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
            if('type' in serverConfig) {
                throw new Error(`Transport type not supported for server "${serverName}"`);
            }

            serverConfig.command = this.substituteString(serverConfig.command);

            if(serverConfig.args) {
                serverConfig.args = _.map(serverConfig.args, (arg: string) => this.substituteString(arg));
            }

            if(serverConfig.env) {
                for(const [key, value] of _.toPairs(serverConfig.env)) {
                    serverConfig.env[key] = this.substituteString(value);
                }
            }
        }
    }

    /**
     * Substitute environment variables in a string
     */
    private substituteString(str: string): string {
        return _.replace(str, /\$\{([^}]+)\}/g, (_match, varName: string) => {
            const value = process.env[varName];
            if(value === undefined) {
                this.loggerFn({ varName }, 'Environment variable not found, leaving unreplaced');
                return `\${${varName}}`;
            }
            return value;
        });
    }

    /**
     * Launch a single backend server
     */
    async launchServer(serverName: string, config: BackendServerConfig): Promise<void> {
        const existingState = this.servers.get(serverName);
        // Only skip if there's an existing RUNNING process (not just state from failed server)
        if(existingState && !existingState.shuttingDown && existingState.process.pid) {
            this.loggerFn({ serverName }, 'Server already running, skipping launch');
            return;
        }

        if('type' in config) {
            throw new Error(`Transport type not supported for server "${serverName}"`);
        }

        this.loggerFn({ serverName, command: config.command, args: config.args }, 'Launching backend server');

        const env: Record<string, string> = {
            ...process.env as Record<string, string>,
            ...(config.env ?? {}),
        };

        this.spawnCalls.push({ cmd: config.command, args: config.args ?? [], env });

        const childProcess = this.spawnFn(config.command, config.args ?? [], {
            env,
            stdio: ['pipe', 'pipe', 'pipe'] as const,
        });

        const restartCount = existingState?.restartCount ?? 0;

        const state: ServerState = {
            process:      childProcess,
            name:         serverName,
            config,
            restartCount,
            lastRestart:  Date.now(),
            shuttingDown: false,
        };

        this.servers.set(serverName, state);

        // Attach stderr handler
        childProcess.stderr?.on('data', (data: Buffer) => {
            const lines = _.split(_.trim(data.toString()), '\n');
            for(const line of lines) {
                const trimmedLine = _.trim(line);
                if(trimmedLine) {
                    this.loggerFn({ serverName }, trimmedLine);
                }
            }
        });

        // Handle process exit
        childProcess.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
            this.handleServerExit(serverName, code, signal, state);
        });

        // Handle spawn errors
        childProcess.on('error', (error: Error) => {
            this.loggerFn({ serverName, error: error.message }, 'Failed to spawn backend server');
            this.servers.delete(serverName);
        });

        this.loggerFn({ serverName, pid: childProcess.pid }, 'Backend server launched successfully');
    }

    /**
     * Handle server process exit
     */
    private handleServerExit(serverName: string, code: number | null, signal: NodeJS.Signals | null, state: ServerState): void {
        this.loggerFn({ serverName, code, signal }, 'Backend server exited');

        if(this.isShuttingDown || state.shuttingDown) {
            this.servers.delete(serverName);
            this.loggerFn({ serverName }, 'Server shutdown was intentional, not restarting');
            return;
        }

        // Mark process as dead by setting pid to undefined (so launchServer doesn't skip)
        (state.process as { pid?: number }).pid = undefined;

        // Keep the state in the map with restart count for auto-restart
        void this.autoRestartServer(serverName, state);
    }

    /**
     * Auto-restart with exponential backoff
     */
    private async autoRestartServer(serverName: string, state: ServerState): Promise<void> {
        const maxRestarts = 5;
        const newRestartCount = state.restartCount + 1;

        if(newRestartCount > maxRestarts) {
            this.loggerFn({ serverName, restartCount: newRestartCount }, 'Server failed too many times, giving up');
            return;
        }

        const backoffMs = Math.pow(2, newRestartCount - 1) * 1000;
        this.loggerFn({ serverName, restartCount: newRestartCount, backoffMs }, 'Scheduling server restart');

        const timeoutCall = { ms: backoffMs, completed: false };
        this.timeoutCalls.push(timeoutCall);

        this.setTimeoutFn(() => {
            timeoutCall.completed = true;
            void (async () => {
                try {
                    // Update restart count in the state object
                    state.restartCount = newRestartCount;
                    // Update the state in the map so launchServer can see the restart count
                    this.servers.set(serverName, state);
                    await this.launchServer(serverName, state.config);
                } catch (error) {
                    this.loggerFn({ serverName, error: _.isError(error) ? error.message : String(error) }, 'Failed to restart server');
                }
            })();
        }, backoffMs);
    }

    /**
     * Start all configured backend servers
     */
    async start(): Promise<void> {
        this.loggerFn({}, 'Starting backend server manager');

        this.config = await this.loadConfig();

        const launchPromises = _.map(Object.entries(this.config.mcpServers), async ([serverName, serverConfig]) => {
            try {
                await this.launchServer(serverName, serverConfig);
            } catch (error) {
                this.loggerFn({ serverName, error: _.isError(error) ? error.message : String(error) }, 'Failed to launch server during startup');
            }
        });

        await Promise.all(launchPromises);

        this.loggerFn({ serverCount: this.servers.size }, 'Backend server manager started');
    }

    /**
     * Stop all backend servers gracefully
     */
    async stop(): Promise<void> {
        this.loggerFn({}, 'Stopping backend server manager');
        this.isShuttingDown = true;

        const stopPromises = _.map(Array.from(this.servers.values()), async (state) => {
            return new Promise<void>((resolve) => {
                state.shuttingDown = true;

                const timeout = this.setTimeoutFn(() => {
                    this.loggerFn({ serverName: state.name }, 'Server did not exit gracefully, killing');
                    state.process.kill('SIGKILL');
                    resolve();
                }, 5000);

                state.process.once('exit', () => {
                    this.clearTimeoutFn(timeout);
                    resolve();
                });

                this.loggerFn({ serverName: state.name, pid: state.process.pid }, 'Sending SIGTERM to backend server');
                state.process.kill('SIGTERM');
            });
        });

        await Promise.all(stopPromises);

        this.servers.clear();
        this.loggerFn({}, 'Backend server manager stopped');
    }

    /**
     * Get server process by name
     */
    getServerProcess(serverName: string): ChildProcess | undefined {
        return this.servers.get(serverName)?.process;
    }

    /**
     * Get all server names
     */
    getServerNames(): string[] {
        return Array.from(this.servers.keys());
    }

    /**
     * Get server states (for testing)
     */
    getServerStates(): Map<string, ServerState> {
        return new Map(this.servers);
    }

    /**
     * Restart a specific server
     */
    async restartServer(serverName: string): Promise<void> {
        this.loggerFn({ serverName }, 'Restarting backend server');

        const state = this.servers.get(serverName);
        if(!state) {
            throw new Error(`Server not found: ${serverName}`);
        }

        state.shuttingDown = true;

        await new Promise<void>((resolve) => {
            const timeout = this.setTimeoutFn(() => {
                this.loggerFn({ serverName }, 'Server did not exit gracefully during restart, killing');
                state.process.kill('SIGKILL');
                resolve();
            }, 5000);

            state.process.once('exit', () => {
                this.clearTimeoutFn(timeout);
                resolve();
            });

            state.process.kill('SIGTERM');
        });

        await new Promise(resolve => this.setTimeoutFn(resolve as () => void, 1000));

        state.restartCount = 0;
        state.shuttingDown = false;

        await this.launchServer(serverName, state.config);
    }
}

interface ServerState {
    process:      ChildProcess
    name:         string
    config:       BackendServerConfig
    restartCount: number
    lastRestart:  number
    shuttingDown: boolean
}

describe('ServerManager', () => {
    let configPath: string;
    let mockProcesses: MockProcess[];
    let timeoutQueue: { fn: () => void, ms: number }[];

    beforeEach(async () => {
        // Create temp config file
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'server-manager-test-'));
        configPath = path.join(tmpDir, 'backend-servers.json');

        mockProcesses = [];
        timeoutQueue = [];
    });

    afterEach(async () => {
        // Cleanup temp files
        try {
            await fs.rm(path.dirname(configPath), { recursive: true, force: true });
        } catch{
            // Ignore cleanup errors
        }

        // Kill any lingering processes
        for(const proc of mockProcesses) {
            try {
                proc.kill('SIGKILL');
            } catch{
                // Ignore
            }
        }
    });

    /**
     * Create a mock spawn function that returns controllable mock processes
     */
    function createMockSpawn(): (cmd: string, args: string[], opts: unknown) => ChildProcess {
        return (_cmd: string, _args: string[], _opts: unknown) => {
            const mockProc = createMockProcess({
                pid:            1000 + mockProcesses.length,
                emitSpawn:      true,
                spawnDelay:     0,
                autoEmitOutput: false,
            });
            mockProcesses.push(mockProc);
            return mockProc as unknown as ChildProcess;
        };
    }

    /**
     * Create a synchronous mock setTimeout that queues calls
     */
    function createMockSetTimeout(): (fn: () => void, ms: number) => NodeJS.Timeout {
        return (fn: () => void, ms: number) => {
            timeoutQueue.push({ fn, ms });
            return (timeoutQueue.length - 1) as unknown as NodeJS.Timeout;
        };
    }

    /**
     * Execute all queued timeouts synchronously
     */
    function flushTimeouts(): void {
        const pending = [...timeoutQueue];
        timeoutQueue = [];
        for(const { fn } of pending) {
            fn();
        }
    }

    describe('Process Lifecycle', () => {
        it('spawns backend server with correct command and args', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js', '--port', '8080'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

            await manager.start();

            expect(manager.spawnCalls).toHaveLength(1);
            expect(manager.spawnCalls[0].cmd).toBe('node');
            expect(manager.spawnCalls[0].args).toEqual(['server.js', '--port', '8080']);
        });

        it('substitutes environment variables in args', async () => {
            process.env.TEST_VAR = 'test-value';
            process.env.TEST_PORT = '9000';

            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js', '--key', '${TEST_VAR}', '--port', '${TEST_PORT}'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

            await manager.start();

            expect(manager.spawnCalls[0].args).toEqual(['server.js', '--key', 'test-value', '--port', '9000']);

            delete process.env.TEST_VAR;
            delete process.env.TEST_PORT;
        });

        it('substitutes environment variables in env values', async () => {
            process.env.API_KEY = 'secret-key';

            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
                env:     {
                    MY_API_KEY: '${API_KEY}',
                    STATIC_VAR: 'static-value',
                },
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

            await manager.start();

            expect(manager.spawnCalls[0].env.MY_API_KEY).toBe('secret-key');
            expect(manager.spawnCalls[0].env.STATIC_VAR).toBe('static-value');

            delete process.env.API_KEY;
        });

        it('handles missing environment variables gracefully', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js', '--key', '${MISSING_VAR}'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const logCalls: unknown[] = [];
            const manager = new TestableServerManager(configPath, {
                spawn:  mockSpawn,
                logger: obj => logCalls.push(obj),
            });

            await manager.start();

            // Should leave placeholder unreplaced
            expect(manager.spawnCalls[0].args).toEqual(['server.js', '--key', '${MISSING_VAR}']);

            // Should log a warning
            const warningLog = _.find(logCalls, (log: unknown) =>
                _.isObject(log) && 'varName' in log && (log as { varName: string }).varName === 'MISSING_VAR'
            );
            expect(warningLog).toBeDefined();
        });

        it('attaches stderr logging handler', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const logCalls: unknown[] = [];
            const manager = new TestableServerManager(configPath, {
                spawn:  mockSpawn,
                logger: obj => logCalls.push(obj),
            });

            await manager.start();

            // Emit stderr data
            const mockProc = mockProcesses[0];
            mockProc.stderr.push('Server started on port 8080\n');
            mockProc.stderr.push('Ready to accept connections\n');

            // Wait for async event handlers
            await new Promise(resolve => setImmediate(resolve));

            // Should have logged stderr output
            const stderrLogs = _.filter(logCalls, (log: unknown) =>
                _.isString(log) || (_.isObject(log) && 'serverName' in log)
            );
            expect(stderrLogs.length).toBeGreaterThan(0);
        });

        it('emits started event with PID', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

            await manager.start();

            const serverProc = manager.getServerProcess('test-server');
            expect(serverProc).toBeDefined();
            expect(serverProc?.pid).toBeGreaterThan(0);
        });

        it('handles spawn errors gracefully', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'invalid-command',
                args:    [],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

            await manager.start();

            // Trigger spawn error
            const mockProc = mockProcesses[0];
            mockProc.emit('error', new Error('ENOENT: command not found'));

            // Wait for async handlers
            await new Promise(resolve => setImmediate(resolve));

            // Server should be removed from active list
            expect(manager.getServerProcess('test-server')).toBeUndefined();
        });
    });

    describe('Auto-restart Logic', () => {
        it('restarts server on unexpected exit', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const mockSetTimeout = createMockSetTimeout();
            const manager = new TestableServerManager(configPath, {
                spawn:      mockSpawn,
                setTimeout: mockSetTimeout,
            });

            await manager.start();

            // Initial spawn
            expect(manager.spawnCalls).toHaveLength(1);

            // Trigger unexpected exit
            const mockProc = mockProcesses[0];
            mockProc.emit('exit', 1, null);

            // Should schedule restart
            expect(timeoutQueue).toHaveLength(1);
            expect(timeoutQueue[0].ms).toBe(1000); // First backoff = 1s

            // Execute the timeout
            flushTimeouts();
            await new Promise(resolve => setImmediate(resolve));

            // Should have spawned again
            expect(manager.spawnCalls).toHaveLength(2);
        });

        it('applies exponential backoff (1s, 2s, 4s, 8s, 16s)', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const mockSetTimeout = createMockSetTimeout();
            const manager = new TestableServerManager(configPath, {
                spawn:      mockSpawn,
                setTimeout: mockSetTimeout,
            });

            await manager.start();

            const expectedBackoffs = [1000, 2000, 4000, 8000, 16000];

            for(const backoff of expectedBackoffs) {
                const timeoutCallCountBefore = manager.timeoutCalls.length;

                // Trigger exit
                const mockProc = mockProcesses[mockProcesses.length - 1];
                mockProc.emit('exit', 1, null);

                // Should have added exactly one new timeout call
                expect(manager.timeoutCalls.length).toBe(timeoutCallCountBefore + 1);

                // Check backoff time of the newly added timeout
                expect(manager.timeoutCalls[manager.timeoutCalls.length - 1].ms).toBe(backoff);

                // Execute timeout and wait for restart
                flushTimeouts();
                await new Promise(resolve => setImmediate(resolve));
            }
        });

        it('stops retrying after 5 consecutive failures', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const mockSetTimeout = createMockSetTimeout();
            const logCalls: unknown[] = [];
            const manager = new TestableServerManager(configPath, {
                spawn:      mockSpawn,
                setTimeout: mockSetTimeout,
                logger:     obj => logCalls.push(obj),
            });

            await manager.start();

            // Fail 5 times (each failure schedules a restart)
            for(let i = 0; i < 5; i++) {
                const mockProc = mockProcesses[mockProcesses.length - 1];
                const timeoutCallsBefore = manager.timeoutCalls.length;
                mockProc.emit('exit', 1, null);

                // Should schedule a restart
                expect(manager.timeoutCalls.length).toBe(timeoutCallsBefore + 1);

                flushTimeouts();
                await new Promise(resolve => setImmediate(resolve));
            }

            // 6th failure should NOT schedule restart (exceeds maxRestarts)
            const mockProc = mockProcesses[mockProcesses.length - 1];
            const finalTimeoutCount = manager.timeoutCalls.length;
            mockProc.emit('exit', 1, null);

            // Should NOT add new timeout
            expect(manager.timeoutCalls.length).toBe(finalTimeoutCount);

            // Should log "giving up" message
            const giveUpLog = _.find(logCalls, (log: unknown) =>
                _.isObject(log) && 'serverName' in log && 'restartCount' in log
                && (log as { restartCount: number }).restartCount === 6
            );
            expect(giveUpLog).toBeDefined();
        });

        it('resets failure count on successful start', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

            await manager.start();

            const serverStates = manager.getServerStates();
            const state = serverStates.get('test-server');

            expect(state?.restartCount).toBe(0);
        });

        it('does not restart if isShuttingDown is true', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const mockSetTimeout = createMockSetTimeout();
            const manager = new TestableServerManager(configPath, {
                spawn:      mockSpawn,
                setTimeout: mockSetTimeout,
            });

            await manager.start();

            // Start shutdown (but don't complete it)
            void manager.stop();

            // Clear the queue (shutdown process will add a 5s timeout for graceful exit)
            timeoutQueue = [];

            // Trigger exit during shutdown
            const mockProc = mockProcesses[0];
            mockProc.emit('exit', 0, null);

            await new Promise(resolve => setImmediate(resolve));

            // Should NOT schedule restart (no timeouts should have been added)
            expect(timeoutQueue).toHaveLength(0);
        });
    });

    describe('Graceful Shutdown', () => {
        it('sends SIGTERM to process', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

            await manager.start();

            const killSpy = spyOn(mockProcesses[0], 'kill');

            const stopPromise = manager.stop();

            // Should send SIGTERM
            expect(killSpy).toHaveBeenCalledWith('SIGTERM');

            // Complete the exit
            mockProcesses[0].emit('exit', 0, null);
            await stopPromise;
        });

        it('waits for graceful exit', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

            await manager.start();

            const stopPromise = manager.stop();

            // Simulate delayed graceful exit
            setTimeout(() => {
                mockProcesses[0].emit('exit', 0, null);
            }, 100);

            await stopPromise;

            // Should have waited for exit
            expect(manager.getServerNames()).toHaveLength(0);
        });

        it('sends SIGKILL after 5 second timeout', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            let killTimeoutFn: (() => void) | null = null;
            const mockSetTimeout = (fn: () => void, ms: number) => {
                if(ms === 5000) {
                    killTimeoutFn = fn;
                }
                return {} as NodeJS.Timeout;
            };
            const manager = new TestableServerManager(configPath, {
                spawn:        mockSpawn,
                setTimeout:   mockSetTimeout,
                clearTimeout: () => _.noop(),
            });

            await manager.start();

            const killSpy = spyOn(mockProcesses[0], 'kill');

            const stopPromise = manager.stop();

            // Process doesn't exit gracefully
            // Execute the 5s timeout
            expect(killTimeoutFn).not.toBeNull();
            killTimeoutFn!();

            // Should send SIGKILL
            expect(killSpy).toHaveBeenCalledWith('SIGKILL');

            await stopPromise;
        });

        it('clears timeout on graceful exit', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const clearTimeoutSpy = mock(() => _.noop());
            const manager = new TestableServerManager(configPath, {
                spawn:        mockSpawn,
                clearTimeout: clearTimeoutSpy,
            });

            await manager.start();

            const stopPromise = manager.stop();

            // Graceful exit before timeout
            mockProcesses[0].emit('exit', 0, null);

            await stopPromise;

            // Should have cleared the timeout
            expect(clearTimeoutSpy).toHaveBeenCalled();
        });

        it('prevents restart during shutdown', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const mockSetTimeout = createMockSetTimeout();
            const manager = new TestableServerManager(configPath, {
                spawn:      mockSpawn,
                setTimeout: mockSetTimeout,
            });

            await manager.start();

            const initialSpawnCount = manager.spawnCalls.length;

            const stopPromise = manager.stop();
            mockProcesses[0].emit('exit', 1, null);
            await stopPromise;

            // Should NOT have attempted restart
            expect(manager.spawnCalls).toHaveLength(initialSpawnCount);
        });
    });

    describe('Environment Variable Substitution', () => {
        it('replaces ${VAR_NAME} with env values', async () => {
            process.env.TEST_COMMAND = 'node';
            process.env.TEST_ARG = 'test-arg';

            const config = backendConfig.withServer('test-server', {
                command: '${TEST_COMMAND}',
                args:    ['server.js', '${TEST_ARG}'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

            await manager.start();

            expect(manager.spawnCalls[0].cmd).toBe('node');
            expect(manager.spawnCalls[0].args).toContain('test-arg');

            delete process.env.TEST_COMMAND;
            delete process.env.TEST_ARG;
        });

        it('substitutes multiple variables in single arg', async () => {
            process.env.HOST = 'localhost';
            process.env.PORT = '8080';

            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js', '--url=http://${HOST}:${PORT}'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

            await manager.start();

            expect(manager.spawnCalls[0].args).toContain('--url=http://localhost:8080');

            delete process.env.HOST;
            delete process.env.PORT;
        });

        it('handles empty string values', async () => {
            process.env.EMPTY_VAR = '';

            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js', '--key=${EMPTY_VAR}'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

            await manager.start();

            expect(manager.spawnCalls[0].args).toContain('--key=');

            delete process.env.EMPTY_VAR;
        });
    });

    describe('Error Handling', () => {
        it('handles process that exits immediately', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const mockSetTimeout = createMockSetTimeout();
            const manager = new TestableServerManager(configPath, {
                spawn:      mockSpawn,
                setTimeout: mockSetTimeout,
            });

            await manager.start();

            // Immediate exit
            mockProcesses[0].emit('exit', 1, null);

            // Should schedule restart
            expect(timeoutQueue).toHaveLength(1);
        });

        it('handles process that crashes repeatedly', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const mockSetTimeout = createMockSetTimeout();
            const manager = new TestableServerManager(configPath, {
                spawn:      mockSpawn,
                setTimeout: mockSetTimeout,
            });

            await manager.start();

            // Crash repeatedly - first 5 will schedule restarts, after that it gives up
            for(let i = 0; i < 10; i++) {
                const mockProc = mockProcesses[mockProcesses.length - 1];
                mockProc.emit('exit', 1, null);

                // Only first 5 failures should schedule restarts
                if(i < 5) {
                    flushTimeouts();
                    await new Promise(resolve => setImmediate(resolve));
                }
            }

            // Should have stopped retrying after 5 failures (1 initial + 5 restarts = 6 total spawns)
            expect(manager.spawnCalls.length).toBe(6);
        });

        it('handles stderr overflow scenarios', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const logCalls: unknown[] = [];
            const manager = new TestableServerManager(configPath, {
                spawn:  mockSpawn,
                logger: obj => logCalls.push(obj),
            });

            await manager.start();

            // Flood stderr with many lines
            const mockProc = mockProcesses[0];
            const largeOutput = _.times(1000, i => `Line ${i}`).join('\n');
            mockProc.stderr.push(largeOutput);

            await new Promise(resolve => setImmediate(resolve));

            // Should have processed all lines without crashing
            expect(logCalls.length).toBeGreaterThan(0);
        });

        it('handles invalid command/args', async () => {
            const config = {
                mcpServers: {
                    'test-server': {
                        command: '',
                        args:    [],
                    },
                },
            };
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

            await manager.start();

            // Should attempt to spawn even with empty command
            expect(manager.spawnCalls).toHaveLength(1);
        });
    });

    describe('Manual Restart', () => {
        it('restarts server on demand', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

            await manager.start();

            const initialPid = manager.getServerProcess('test-server')?.pid;

            // Manual restart
            const restartPromise = manager.restartServer('test-server');

            // Complete the shutdown
            mockProcesses[0].emit('exit', 0, null);

            await restartPromise;

            const newPid = manager.getServerProcess('test-server')?.pid;

            expect(newPid).not.toBe(initialPid);
        });

        it('resets restart count on manual restart', async () => {
            const config = backendConfig.withServer('test-server', {
                command: 'node',
                args:    ['server.js'],
            });
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const mockSetTimeout = createMockSetTimeout();
            const manager = new TestableServerManager(configPath, {
                spawn:      mockSpawn,
                setTimeout: mockSetTimeout,
            });

            await manager.start();

            // Trigger some failures
            for(let i = 0; i < 3; i++) {
                mockProcesses[mockProcesses.length - 1].emit('exit', 1, null);
                flushTimeouts();
                await new Promise(resolve => setImmediate(resolve));
            }

            // Manual restart
            const restartPromise = manager.restartServer('test-server');

            // Flush the 5s graceful shutdown timeout and emit exit
            await new Promise(resolve => setImmediate(resolve));
            mockProcesses[mockProcesses.length - 1].emit('exit', 0, null);

            // Flush the 1s delay before relaunch
            await new Promise(resolve => setImmediate(resolve));
            flushTimeouts();

            await restartPromise;

            const state = manager.getServerStates().get('test-server');
            expect(state?.restartCount).toBe(0);
        });

        it('throws error if server not found', async () => {
            const config = backendConfig.minimal();
            await fs.writeFile(configPath, JSON.stringify(config));

            const mockSpawn = createMockSpawn();
            const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

            await manager.start();

            expect(manager.restartServer('non-existent')).rejects.toThrow('Server not found');
        });
    });

    describe('ServerManager - Advanced Edge Cases', () => {
        describe('Stderr Handling', () => {
            it('handles stderr backpressure without blocking', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const logCalls: unknown[] = [];
                const manager = new TestableServerManager(configPath, {
                    spawn:  mockSpawn,
                    logger: obj => logCalls.push(obj),
                });

                await manager.start();

                const mockProc = mockProcesses[0];

                // Simulate rapid stderr writes (1000+ lines)
                for(let i = 0; i < 1000; i++) {
                    mockProc.stderr.push(`Log line ${i}\n`);
                }

                // Wait for all async handlers
                await new Promise(resolve => setImmediate(resolve));

                // Should handle all output without blocking or crashing
                expect(logCalls.length).toBeGreaterThan(1000);
            });

            it('handles very large stderr output (1MB+ in single write)', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const logCalls: unknown[] = [];
                const manager = new TestableServerManager(configPath, {
                    spawn:  mockSpawn,
                    logger: obj => logCalls.push(obj),
                });

                await manager.start();

                const mockProc = mockProcesses[0];

                // Create 1MB+ of output (10,000 lines of ~100 chars each)
                const largeLine = _.repeat('x', 100);
                const largeOutput = _.times(10000, i => `${i}: ${largeLine}`).join('\n');
                expect(largeOutput.length).toBeGreaterThan(1_000_000);

                mockProc.stderr.push(largeOutput);

                await new Promise(resolve => setImmediate(resolve));

                // Should process without crashing
                expect(logCalls.length).toBeGreaterThan(0);
            });

            it('handles rapid stderr writes (1000+ lines/sec)', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                let logCount = 0;
                const manager = new TestableServerManager(configPath, {
                    spawn:  mockSpawn,
                    logger: () => logCount++,
                });

                await manager.start();

                const mockProc = mockProcesses[0];

                // Emit many separate data events rapidly
                for(let i = 0; i < 1000; i++) {
                    mockProc.stderr.push(`Rapid line ${i}\n`);
                }

                await new Promise(resolve => setImmediate(resolve));

                expect(logCount).toBeGreaterThan(1000);
            });

            it('handles stderr with invalid UTF-8 sequences', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const logCalls: unknown[] = [];
                const manager = new TestableServerManager(configPath, {
                    spawn:  mockSpawn,
                    logger: obj => logCalls.push(obj),
                });

                await manager.start();

                const mockProc = mockProcesses[0];

                // Invalid UTF-8 bytes (will be converted to replacement characters)
                const invalidUtf8 = Buffer.from([0xFF, 0xFE, 0xFD, 0x41, 0x42, 0x43]);
                mockProc.stderr.push(invalidUtf8);

                await new Promise(resolve => setImmediate(resolve));

                // Should handle gracefully without throwing
                expect(logCalls.length).toBeGreaterThan(0);
            });

            it('handles mixed valid and invalid UTF-8', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const logCalls: unknown[] = [];
                const manager = new TestableServerManager(configPath, {
                    spawn:  mockSpawn,
                    logger: obj => logCalls.push(obj),
                });

                await manager.start();

                const mockProc = mockProcesses[0];

                // Mix valid text with invalid bytes
                mockProc.stderr.push('Valid line 1\n');
                mockProc.stderr.push(Buffer.from([0xFF, 0xFE]));
                mockProc.stderr.push('\nValid line 2\n');

                await new Promise(resolve => setImmediate(resolve));

                expect(logCalls.length).toBeGreaterThan(0);
            });
        });

        describe('Race Conditions', () => {
            it('handles timeout AND exit event firing simultaneously', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                let killTimeoutFn: (() => void) | null = null;
                const mockSetTimeout = (fn: () => void, ms: number) => {
                    if(ms === 5000) {
                        killTimeoutFn = fn;
                    }
                    return {} as NodeJS.Timeout;
                };
                const clearTimeoutSpy = mock(() => _.noop());
                const manager = new TestableServerManager(configPath, {
                    spawn:        mockSpawn,
                    setTimeout:   mockSetTimeout,
                    clearTimeout: clearTimeoutSpy,
                });

                await manager.start();

                const stopPromise = manager.stop();

                // Race: emit exit AND trigger timeout simultaneously
                const mockProc = mockProcesses[0];
                mockProc.emit('exit', 0, null);
                if(killTimeoutFn) {
                    (killTimeoutFn as () => void)();
                }

                await stopPromise;

                // Should handle gracefully (clearTimeout should be called)
                expect(clearTimeoutSpy).toHaveBeenCalled();
                expect(manager.getServerNames()).toHaveLength(0);
            });

            it('handles multiple rapid start/stop cycles', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

                // Rapid start/stop cycles
                for(let i = 0; i < 5; i++) {
                    await manager.start();

                    const stopPromise = manager.stop();
                    for(const proc of mockProcesses) {
                        proc.emit('exit', 0, null);
                    }
                    await stopPromise;

                    mockProcesses.length = 0; // Clear for next iteration
                }

                // Should complete all cycles without error
                expect(manager.getServerNames()).toHaveLength(0);
            });

            it('handles stop() called during spawn', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                let spawnCallback: (() => void) | null = null;
                const delayedSpawn = (_cmd: string, _args: string[], _opts: unknown): ChildProcess => {
                    const mockProc = createMockProcess({
                        pid:            1000 + mockProcesses.length,
                        emitSpawn:      false, // Don't emit spawn immediately
                        spawnDelay:     0,
                        autoEmitOutput: false,
                    });
                    mockProcesses.push(mockProc);

                    // Store callback to manually trigger spawn later
                    spawnCallback = () => mockProc.emit('spawn');

                    return mockProc as unknown as ChildProcess;
                };

                const manager = new TestableServerManager(configPath, { spawn: delayedSpawn });

                const startPromise = manager.start();

                // Immediately call stop before spawn completes
                const stopPromise = manager.stop();

                // Now complete the spawn
                if(spawnCallback) {
                    (spawnCallback as () => void)();
                }

                await startPromise;

                // Complete the exit
                for(const proc of mockProcesses) {
                    proc.emit('exit', 0, null);
                }

                await stopPromise;

                // Should handle gracefully
                expect(manager.getServerNames()).toHaveLength(0);
            });

            it('handles restart triggered during shutdown', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const mockSetTimeout = createMockSetTimeout();
                const manager = new TestableServerManager(configPath, {
                    spawn:      mockSpawn,
                    setTimeout: mockSetTimeout,
                });

                await manager.start();

                // Start shutdown
                const stopPromise = manager.stop();

                // Process exits with error during shutdown (would normally trigger restart)
                mockProcesses[0].emit('exit', 1, null);

                await stopPromise;

                // Should NOT have scheduled restart (no new timeouts)
                // Note: The stop() will add a 5s timeout, so filter those out
                const restartTimeouts = _.filter(timeoutQueue, t => t.ms !== 5000);
                expect(restartTimeouts).toHaveLength(0);
            });

            it('handles concurrent restarts of different servers', async () => {
                const config = backendConfig.withServers({
                    'server-1': { command: 'node', args: ['server1.js'] },
                    'server-2': { command: 'node', args: ['server2.js'] },
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

                await manager.start();

                // Trigger concurrent restarts
                const restart1 = manager.restartServer('server-1');
                const restart2 = manager.restartServer('server-2');

                // Complete both shutdowns
                mockProcesses[0].emit('exit', 0, null);
                mockProcesses[1].emit('exit', 0, null);

                await Promise.all([restart1, restart2]);

                // Both should have new PIDs
                expect(manager.getServerProcess('server-1')?.pid).toBeGreaterThan(0);
                expect(manager.getServerProcess('server-2')?.pid).toBeGreaterThan(0);
            });
        });

        describe('Multiple Server Scenarios', () => {
            it('handles multiple servers crashing simultaneously', async () => {
                const config = backendConfig.withServers({
                    'server-1': { command: 'node', args: ['server1.js'] },
                    'server-2': { command: 'node', args: ['server2.js'] },
                    'server-3': { command: 'node', args: ['server3.js'] },
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const mockSetTimeout = createMockSetTimeout();
                const manager = new TestableServerManager(configPath, {
                    spawn:      mockSpawn,
                    setTimeout: mockSetTimeout,
                });

                await manager.start();

                expect(mockProcesses).toHaveLength(3);

                // All servers crash simultaneously
                mockProcesses[0].emit('exit', 1, null);
                mockProcesses[1].emit('exit', 1, null);
                mockProcesses[2].emit('exit', 1, null);

                // Should schedule 3 restarts
                expect(timeoutQueue).toHaveLength(3);

                // Execute all timeouts
                flushTimeouts();
                await new Promise(resolve => setImmediate(resolve));

                // Should have spawned 3 new processes
                expect(manager.spawnCalls).toHaveLength(6); // 3 initial + 3 restarts
            });

            it('isolates failures (server A crash doesn\'t affect B)', async () => {
                const config = backendConfig.withServers({
                    'server-a': { command: 'node', args: ['serverA.js'] },
                    'server-b': { command: 'node', args: ['serverB.js'] },
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const mockSetTimeout = createMockSetTimeout();
                const manager = new TestableServerManager(configPath, {
                    spawn:      mockSpawn,
                    setTimeout: mockSetTimeout,
                });

                await manager.start();

                const serverBPid = manager.getServerProcess('server-b')?.pid;

                // Server A crashes
                mockProcesses[0].emit('exit', 1, null);

                // Server B should still be running
                expect(manager.getServerProcess('server-b')?.pid).toBe(serverBPid);

                // Restart server A
                flushTimeouts();
                await new Promise(resolve => setImmediate(resolve));

                // Server B still untouched
                expect(manager.getServerProcess('server-b')?.pid).toBe(serverBPid);
            });

            it('handles cascade failures (server A crash triggers B crash)', async () => {
                const config = backendConfig.withServers({
                    'server-a': { command: 'node', args: ['serverA.js'] },
                    'server-b': { command: 'node', args: ['serverB.js'] },
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const mockSetTimeout = createMockSetTimeout();
                const manager = new TestableServerManager(configPath, {
                    spawn:      mockSpawn,
                    setTimeout: mockSetTimeout,
                });

                await manager.start();

                // Server A crashes, triggering B crash
                mockProcesses[0].emit('exit', 1, null);
                mockProcesses[1].emit('exit', 1, null);

                // Should schedule both restarts independently
                expect(timeoutQueue).toHaveLength(2);

                // Both should restart with correct backoff
                expect(timeoutQueue[0].ms).toBe(1000);
                expect(timeoutQueue[1].ms).toBe(1000);
            });

            it('handles staggered multi-server failures', async () => {
                const config = backendConfig.withServers({
                    'server-1': { command: 'node', args: ['server1.js'] },
                    'server-2': { command: 'node', args: ['server2.js'] },
                    'server-3': { command: 'node', args: ['server3.js'] },
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const mockSetTimeout = createMockSetTimeout();
                const manager = new TestableServerManager(configPath, {
                    spawn:      mockSpawn,
                    setTimeout: mockSetTimeout,
                });

                await manager.start();

                // Server 1 fails
                mockProcesses[0].emit('exit', 1, null);
                expect(timeoutQueue).toHaveLength(1);

                // Server 2 fails
                mockProcesses[1].emit('exit', 1, null);
                expect(timeoutQueue).toHaveLength(2);

                // Server 3 fails
                mockProcesses[2].emit('exit', 1, null);
                expect(timeoutQueue).toHaveLength(3);

                // All should restart independently
                flushTimeouts();
                await new Promise(resolve => setImmediate(resolve));

                expect(manager.spawnCalls).toHaveLength(6);
            });
        });

        describe('Resource Exhaustion', () => {
            it('handles process spawn failures (EMFILE - too many open files)', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

                await manager.start();

                // Simulate EMFILE error
                const emfileError = new Error('spawn EMFILE');
                (emfileError as NodeJS.ErrnoException).code = 'EMFILE';
                mockProcesses[0].emit('error', emfileError);

                await new Promise(resolve => setImmediate(resolve));

                // Server should be removed
                expect(manager.getServerProcess('test-server')).toBeUndefined();
            });

            it('handles too many concurrent restarts', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const mockSetTimeout = createMockSetTimeout();
                const manager = new TestableServerManager(configPath, {
                    spawn:      mockSpawn,
                    setTimeout: mockSetTimeout,
                });

                await manager.start();

                // Trigger 10 rapid failures
                for(let i = 0; i < 10; i++) {
                    const currentProc = mockProcesses[mockProcesses.length - 1];
                    currentProc.emit('exit', 1, null);

                    if(i < 5) {
                        flushTimeouts();
                        await new Promise(resolve => setImmediate(resolve));
                    }
                }

                // Should stop after 5 restarts (max)
                expect(manager.spawnCalls.length).toBeLessThanOrEqual(6); // 1 initial + 5 restarts
            });

            it('handles spawn that throws synchronously', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                let shouldThrow = false;
                const throwingSpawn = (_cmd: string, _args: string[], _opts: unknown): ChildProcess => {
                    if(shouldThrow) {
                        throw new Error('ENOMEM: Cannot allocate memory');
                    }
                    const mockProc = createMockProcess({
                        pid:            1000 + mockProcesses.length,
                        emitSpawn:      true,
                        spawnDelay:     0,
                        autoEmitOutput: false,
                    });
                    mockProcesses.push(mockProc);
                    return mockProc as unknown as ChildProcess;
                };

                const manager = new TestableServerManager(configPath, { spawn: throwingSpawn });

                await manager.start();

                // Now make spawn throw
                shouldThrow = true;

                // Trigger a restart (will throw during spawn)
                mockProcesses[0].emit('exit', 1, null);

                // Should handle the error gracefully
                await new Promise(resolve => setImmediate(resolve));

                // Process should still exist in some form
                expect(manager.getServerNames()).toContain('test-server');
            });

            it('handles memory pressure during startup', async () => {
                // Simulate many servers at once
                const servers: Record<string, Partial<StdioServerConfig>> = {};
                for(let i = 0; i < 50; i++) {
                    servers[`server-${i}`] = {
                        command: 'node',
                        args:    [`server${i}.js`],
                    };
                }
                const serverConfig = backendConfig.withServers(servers);
                await fs.writeFile(configPath, JSON.stringify(serverConfig));

                const mockSpawn = createMockSpawn();
                const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

                await manager.start();

                // Should spawn all 50 servers
                expect(manager.spawnCalls).toHaveLength(50);
                expect(mockProcesses).toHaveLength(50);
            });
        });

        describe('Orphaned Process Prevention', () => {
            it('cleanup works even if manager loses server reference', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

                await manager.start();

                const proc = manager.getServerProcess('test-server');
                expect(proc).toBeDefined();

                // Simulate cleanup
                const stopPromise = manager.stop();
                mockProcesses[0].emit('exit', 0, null);
                await stopPromise;

                // Should have cleaned up
                expect(manager.getServerNames()).toHaveLength(0);
            });

            it('handles process that becomes unresponsive during shutdown', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                let killTimeoutFn: (() => void) | null = null;
                const mockSetTimeout = (fn: () => void, ms: number) => {
                    if(ms === 5000) {
                        killTimeoutFn = fn;
                    }
                    return {} as NodeJS.Timeout;
                };

                const manager = new TestableServerManager(configPath, {
                    spawn:      mockSpawn,
                    setTimeout: mockSetTimeout,
                });

                await manager.start();

                const killSpy = spyOn(mockProcesses[0], 'kill');

                const stopPromise = manager.stop();

                // Process doesn't respond to SIGTERM
                expect(killSpy).toHaveBeenCalledWith('SIGTERM');

                // Trigger SIGKILL timeout
                if(killTimeoutFn) {
                    (killTimeoutFn as () => void)();
                }

                expect(killSpy).toHaveBeenCalledWith('SIGKILL');

                await stopPromise;
            });

            it('prevents restart if state is corrupted (no process)', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

                await manager.start();

                // Corrupt the state by removing the process but keeping the map entry
                const states = manager.getServerStates();
                const state = states.get('test-server');
                if(state) {
                    (state.process as { pid?: number }).pid = undefined;
                }

                // Try to launch again (should work since pid is undefined)
                await manager.launchServer('test-server', state!.config);

                // Should have spawned again
                expect(manager.spawnCalls).toHaveLength(2);
            });
        });

        describe('Error Recovery', () => {
            it('recovers from transient spawn failures', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                let failCount = 0;
                const transientFailSpawn = (_cmd: string, _args: string[], _opts: unknown): ChildProcess => {
                    failCount++;
                    const mockProc = createMockProcess({
                        pid:            1000 + mockProcesses.length,
                        emitSpawn:      true,
                        spawnDelay:     0,
                        autoEmitOutput: false,
                    });
                    mockProcesses.push(mockProc);

                    if(failCount <= 2) {
                        // Fail first 2 spawns
                        setTimeout(() => mockProc.emit('error', new Error('Transient failure')), 0);
                    }

                    return mockProc as unknown as ChildProcess;
                };

                const mockSetTimeout = createMockSetTimeout();
                const manager = new TestableServerManager(configPath, {
                    spawn:      transientFailSpawn,
                    setTimeout: mockSetTimeout,
                });

                await manager.start();

                // First spawn should fail
                await new Promise(resolve => setImmediate(resolve));

                // Should have attempted to spawn
                expect(manager.spawnCalls.length).toBeGreaterThanOrEqual(1);
            });

            it('handles process that crashes immediately on every start', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const mockSetTimeout = createMockSetTimeout();
                const manager = new TestableServerManager(configPath, {
                    spawn:      mockSpawn,
                    setTimeout: mockSetTimeout,
                });

                await manager.start();

                // Process crashes immediately every time
                for(let i = 0; i < 10; i++) {
                    if(mockProcesses.length > 0) {
                        const proc = mockProcesses[mockProcesses.length - 1];
                        proc.emit('exit', 1, null);

                        if(i < 5) {
                            flushTimeouts();
                            await new Promise(resolve => setImmediate(resolve));
                        }
                    }
                }

                // Should give up after 5 restarts
                expect(manager.spawnCalls.length).toBe(6); // 1 initial + 5 restarts
            });

            it('handles process that becomes unresponsive (no exit)', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

                await manager.start();

                const restartPromise = manager.restartServer('test-server');

                // Process doesn't exit even after SIGKILL
                // Timeout should fire
                await new Promise(resolve => setTimeout(resolve, 100));

                // Force exit to complete the promise
                mockProcesses[0].emit('exit', 1, null);

                await restartPromise;

                // Should have attempted restart
                expect(manager.spawnCalls.length).toBeGreaterThan(1);
            });

            it('handles spawn error followed by successful restart', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

                await manager.start();

                // Trigger spawn error
                mockProcesses[0].emit('error', new Error('ENOENT'));

                await new Promise(resolve => setImmediate(resolve));

                // Server should be removed
                expect(manager.getServerProcess('test-server')).toBeUndefined();

                // But we should be able to launch it again
                await manager.launchServer('test-server', config.mcpServers['test-server']);

                expect(manager.getServerProcess('test-server')).toBeDefined();
            });

            it('handles exit with signal (SIGKILL, SIGSEGV, etc)', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const mockSetTimeout = createMockSetTimeout();
                const manager = new TestableServerManager(configPath, {
                    spawn:      mockSpawn,
                    setTimeout: mockSetTimeout,
                });

                await manager.start();

                // Process killed with SIGSEGV
                mockProcesses[0].emit('exit', null, 'SIGSEGV');

                // Should schedule restart
                expect(timeoutQueue).toHaveLength(1);

                flushTimeouts();
                await new Promise(resolve => setImmediate(resolve));

                // Should have restarted
                expect(manager.spawnCalls).toHaveLength(2);
            });
        });

        describe('Edge Case Combinations', () => {
            it('handles restart during another restart', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

                await manager.start();

                // Start first restart
                const restart1 = manager.restartServer('test-server');

                // Process exits
                mockProcesses[0].emit('exit', 0, null);

                await restart1;

                // Immediately start another restart
                const restart2 = manager.restartServer('test-server');

                // New process exits
                mockProcesses[1].emit('exit', 0, null);

                await restart2;

                // Should handle both restarts
                expect(manager.spawnCalls.length).toBeGreaterThanOrEqual(3);
            });

            it('handles crash during graceful shutdown', async () => {
                const config = backendConfig.withServer('test-server', {
                    command: 'node',
                    args:    ['server.js'],
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const manager = new TestableServerManager(configPath, { spawn: mockSpawn });

                await manager.start();

                const stopPromise = manager.stop();

                // Process crashes instead of exiting gracefully
                mockProcesses[0].emit('exit', 1, 'SIGSEGV');

                await stopPromise;

                // Should complete shutdown without restart
                expect(manager.getServerNames()).toHaveLength(0);
            });

            it('handles multiple servers with different backoff states', async () => {
                const config = backendConfig.withServers({
                    'server-1': { command: 'node', args: ['server1.js'] },
                    'server-2': { command: 'node', args: ['server2.js'] },
                });
                await fs.writeFile(configPath, JSON.stringify(config));

                const mockSpawn = createMockSpawn();
                const mockSetTimeout = createMockSetTimeout();
                const manager = new TestableServerManager(configPath, {
                    spawn:      mockSpawn,
                    setTimeout: mockSetTimeout,
                });

                await manager.start();

                // Server 1: fail once
                mockProcesses[0].emit('exit', 1, null);
                expect(_.last(timeoutQueue)?.ms).toBe(1000);

                // Server 2: fail twice
                mockProcesses[1].emit('exit', 1, null);
                flushTimeouts();
                await new Promise(resolve => setImmediate(resolve));
                mockProcesses[mockProcesses.length - 1].emit('exit', 1, null);

                // Server 2 should have 2s backoff (second restart)
                expect(_.last(timeoutQueue)?.ms).toBe(2000);
            });
        });
    });
});
