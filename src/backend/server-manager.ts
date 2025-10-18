/**
 * Backend MCP Server Manager
 *
 * Manages the lifecycle of backend MCP servers as stdio subprocesses:
 * - Launches servers based on configuration
 * - Monitors health and auto-restarts failed servers
 * - Handles graceful shutdown
 * - Pipes stderr for logging
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dynamicLogger as logger } from '../utils/silent-logger.js';
import _ from 'lodash';
import { ZodError } from 'zod';
import { BackendServersConfigSchema, type BackendServersConfig, type BackendServerConfig } from '../types/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ServerState {
    process:      ChildProcess
    name:         string
    config:       BackendServerConfig
    restartCount: number
    lastRestart:  number
    shuttingDown: boolean
}

/**
 * Manages backend MCP server processes
 */
export class ServerManager {
    private servers = new Map<string, ServerState>();
    private config:     BackendServersConfig | null = null;
    private configPath: string;
    private isShuttingDown = false;

    constructor(configPath: string) {
        this.configPath = configPath;
    }

    /**
     * Load and validate backend servers configuration
     */
    private async loadConfig(): Promise<BackendServersConfig> {
        try {
            // If config doesn't exist, copy from example
            let configExists = true;
            try {
                await access(this.configPath, constants.F_OK);
            } catch{
                configExists = false;
            }

            if(!configExists) {
                const examplePath = _.replace(this.configPath, /\.json$/, '.example.json');
                let exampleExists = true;
                try {
                    await access(examplePath, constants.F_OK);
                } catch{
                    exampleExists = false;
                }

                if(exampleExists) {
                    logger.warn({ configPath: this.configPath, examplePath }, 'Config file not found, creating from example');
                    const exampleContent = await readFile(examplePath, 'utf-8');
                    await writeFile(this.configPath, exampleContent, 'utf-8');
                } else {
                    throw new Error(`Config file not found and no example available: ${this.configPath}`);
                }
            }

            const content = await readFile(this.configPath, 'utf-8');
            const rawConfig: unknown = JSON.parse(content);

            // Validate with Zod
            const config = BackendServersConfigSchema.parse(rawConfig);

            // Substitute environment variables in config
            this.substituteEnvVars(config);

            return config;
        } catch (error) {
            if(error instanceof ZodError) {
                const zodError = error;
                logger.error({ error: zodError.issues, configPath: this.configPath }, 'Invalid backend servers configuration');
                throw new Error(`Invalid backend servers configuration: ${_.map(zodError.issues, (e: { path: (string | number)[], message: string }) => `${_.join(e.path, '.')}: ${e.message}`).join(', ')}`);
            }
            throw error;
        }
    }

    /**
     * Substitute environment variables in configuration
     * Supports ${VAR_NAME} syntax
     */
    private substituteEnvVars(config: BackendServersConfig): void {
        for(const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
            // Only stdio transport is currently supported
            if('type' in serverConfig) {
                const transportType = (serverConfig as { type?: unknown }).type;
                throw new Error(`Transport type "${String(transportType)}" is not yet supported for server "${serverName}". Only stdio transport is currently implemented.`);
            }

            // Substitute in command
            serverConfig.command = this.substituteString(serverConfig.command);

            // Substitute in args
            if(serverConfig.args) {
                serverConfig.args = _.map(serverConfig.args, (arg: string) => this.substituteString(arg));
            }

            // Substitute in env values
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
                logger.warn({ varName }, 'Environment variable not found, leaving unreplaced');
                return `\${${varName}}`;
            }
            return value;
        });
    }

    /**
     * Launch a single backend server
     */
    private async launchServer(serverName: string, config: BackendServerConfig): Promise<void> {
        const existingState = this.servers.get(serverName);
        if(existingState && !existingState.shuttingDown) {
            logger.warn({ serverName }, 'Server already running, skipping launch');
            return;
        }

        // Only stdio transport is currently supported
        if('type' in config) {
            const transportType = (config as { type?: unknown }).type;
            throw new Error(`Transport type "${String(transportType)}" is not yet supported for server "${serverName}". Only stdio transport is currently implemented.`);
        }

        logger.info({ serverName, command: config.command, args: config.args }, 'Launching backend server');

        try {
            // Merge server-specific env with process.env
            // Merge server-specific env with process.env
            const env: Record<string, string> = {
                ...process.env as Record<string, string>,
                ...(config.env ?? {}),
            };

            // Spawn the server process
            const childProcess = spawn(config.command, config.args ?? [], {
                env,
                stdio: ['pipe', 'pipe', 'pipe'] as const, // stdin, stdout, stderr
            });

            // Track restart count
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

            // Pipe stderr to logger (respects ADMIN_MODE for suppression)
            childProcess.stderr?.on('data', (data: Buffer) => {
                const lines = _.split(_.trim(data.toString()), '\n');
                for(const line of lines) {
                    const trimmedLine = _.trim(line);
                    if(trimmedLine) {
                        // Log backend server stderr at debug level (suppressed in admin mode)
                        logger.debug({ serverName }, trimmedLine);
                    }
                }
            });

            // Handle process exit
            childProcess.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
                this.handleServerExit(serverName, code, signal, state);
            });

            // Handle spawn errors
            childProcess.on('error', (error: Error) => {
                logger.error({ serverName, error: error.message }, 'Failed to spawn backend server');
                this.servers.delete(serverName);
            });

            logger.info({ serverName, pid: childProcess.pid }, 'Backend server launched successfully');
        } catch (error) {
            logger.error({ serverName, error: _.isError(error) ? error.message : String(error) }, 'Failed to launch backend server');
            throw error;
        }
    }

    /**
     * Handle server process exit
     */
    private handleServerExit(serverName: string, code: number | null, signal: NodeJS.Signals | null, state: ServerState): void {
        logger.warn({ serverName, code, signal }, 'Backend server exited');

        // Remove from active servers
        this.servers.delete(serverName);

        // Don't restart if we're shutting down or if it was an intentional shutdown
        if(this.isShuttingDown || state.shuttingDown) {
            logger.info({ serverName }, 'Server shutdown was intentional, not restarting');
            return;
        }

        // Auto-restart with exponential backoff
        void this.autoRestartServer(serverName, state);
    }

    /**
     * Auto-restart a failed server with exponential backoff
     */
    private async autoRestartServer(serverName: string, state: ServerState): Promise<void> {
        const maxRestarts = 5;
        const newRestartCount = state.restartCount + 1;

        if(newRestartCount > maxRestarts) {
            logger.error({ serverName, restartCount: newRestartCount }, 'Server failed too many times, giving up');
            return;
        }

        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        const backoffMs = Math.pow(2, newRestartCount - 1) * 1000;
        logger.info({ serverName, restartCount: newRestartCount, backoffMs }, 'Scheduling server restart');

        setTimeout(() => {
            void (async () => {
                try {
                    // Update restart count
                    state.restartCount = newRestartCount;
                    await this.launchServer(serverName, state.config);
                } catch (error) {
                    logger.error({ serverName, error: _.isError(error) ? error.message : String(error) }, 'Failed to restart server');
                }
            })();
        }, backoffMs);
    }

    /**
     * Start all configured backend servers
     */
    async start(): Promise<void> {
        logger.info('Starting backend server manager');

        // Load configuration
        this.config = await this.loadConfig();

        // Launch all servers
        const launchPromises = _.map(Object.entries(this.config.mcpServers), async ([serverName, serverConfig]) => {
            try {
                await this.launchServer(serverName, serverConfig);
            } catch (error) {
                logger.error({ serverName, error: _.isError(error) ? error.message : String(error) }, 'Failed to launch server during startup');
            }
        });

        await Promise.all(launchPromises);

        logger.info({ serverCount: this.servers.size }, 'Backend server manager started');
    }

    /**
     * Stop all backend servers gracefully
     */
    async stop(): Promise<void> {
        logger.info('Stopping backend server manager');
        this.isShuttingDown = true;

        const stopPromises = _.map(Array.from(this.servers.values()), async (state) => {
            return new Promise<void>((resolve) => {
                state.shuttingDown = true;

                // Give the process 5 seconds to exit gracefully
                const timeout = setTimeout(() => {
                    logger.warn({ serverName: state.name }, 'Server did not exit gracefully, killing');
                    state.process.kill('SIGKILL');
                    resolve();
                }, 5000);

                state.process.once('exit', () => {
                    clearTimeout(timeout);
                    resolve();
                });

                // Send SIGTERM
                logger.info({ serverName: state.name, pid: state.process.pid }, 'Sending SIGTERM to backend server');
                state.process.kill('SIGTERM');
            });
        });

        await Promise.all(stopPromises);

        this.servers.clear();
        logger.info('Backend server manager stopped');
    }

    /**
     * Get a server process by name
     */
    getServerProcess(serverName: string): ChildProcess | undefined {
        return this.servers.get(serverName)?.process;
    }

    /**
     * Restart a specific server
     */
    async restartServer(serverName: string): Promise<void> {
        logger.info({ serverName }, 'Restarting backend server');

        const state = this.servers.get(serverName);
        if(!state) {
            throw new Error(`Server not found: ${serverName}`);
        }

        // Mark as intentional shutdown
        state.shuttingDown = true;

        // Stop the server
        await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
                logger.warn({ serverName }, 'Server did not exit gracefully during restart, killing');
                state.process.kill('SIGKILL');
                resolve();
            }, 5000);

            state.process.once('exit', () => {
                clearTimeout(timeout);
                resolve();
            });

            state.process.kill('SIGTERM');
        });

        // Wait a moment before restarting
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Reset restart count for manual restarts
        state.restartCount = 0;
        state.shuttingDown = false;

        // Launch again
        await this.launchServer(serverName, state.config);
    }

    /**
     * Get list of configured server names
     */
    getServerNames(): string[] {
        return Array.from(this.servers.keys());
    }

    /**
     * Get all active server states (for debugging/admin purposes)
     */
    getServerStates(): Map<string, ServerState> {
        return new Map(this.servers);
    }
}

export default ServerManager;
