/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Logger type not properly inferred */
/**
 * Backend Server Proxy Service
 *
 * Proxies tool calls and resource reads to backend MCP servers:
 * - Forwards tool calls using client.callTool()
 * - Forwards resource reads using client.readResource()
 * - Implements timeout handling for operations
 * - Logs all operations with timing information
 * - Returns properly typed MCP protocol responses
 */

import { logger } from '@hughescr/logger';
import _ from 'lodash';
import type { CallToolResult, ReadResourceResult, GetPromptResult } from '@modelcontextprotocol/sdk/types';
import type { ClientManager } from './client-manager.js';

/**
 * Configuration for proxy operations
 */
export interface ProxyConfig {
    /** Default timeout for operations in milliseconds */
    defaultTimeoutMs?: number
}

/**
 * Service for proxying tool calls and resource reads to backend servers
 */
export class ProxyService {
    private clientManager:    ClientManager;
    private defaultTimeoutMs: number;

    constructor(clientManager: ClientManager, config: ProxyConfig = {}) {
        this.clientManager = clientManager;
        this.defaultTimeoutMs = config.defaultTimeoutMs ?? 30000; // 30 seconds default
    }

    /**
     * Call a tool on a backend server
     */
    async callTool(
        serverName: string,
        toolName: string,
        args: unknown,
        timeoutMs?: number
    ): Promise<CallToolResult> {
        const startTime = Date.now();
        const timeout = timeoutMs ?? this.defaultTimeoutMs;

        logger.info({ serverName, toolName, timeout }, 'Proxying tool call to backend server');

        const client = this.clientManager.getClient(serverName);
        if(!client) {
            throw new Error(`Not connected to backend server: ${serverName}`);
        }

        try {
            // Create timeout promise
            const timeoutPromise = new Promise<never>((_resolve, reject) => {
                setTimeout(() => {
                    reject(new Error(`Tool call timed out after ${timeout}ms`));
                }, timeout);
            });

            // Race between tool call and timeout

            const result = await Promise.race([
                client.callTool({
                    name:      toolName,
                    arguments: args as Record<string, unknown>,
                }),
                timeoutPromise,
            ]) as CallToolResult;

            const duration = Date.now() - startTime;
            logger.info(
                { serverName, toolName, durationMs: duration },
                'Tool call completed successfully'
            );

            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(
                {
                    serverName,
                    toolName,
                    durationMs: duration,
                    error:      _.isError(error) ? error.message : String(error),
                },
                'Tool call failed'
            );

            // Re-throw with more context
            throw new Error(
                `Tool call to ${serverName}.${toolName} failed: ${_.isError(error) ? error.message : String(error)}`
            );
        }
    }

    /**
     * Read a resource from a backend server
     */
    async readResource(
        serverName: string,
        uri: string,
        timeoutMs?: number
    ): Promise<ReadResourceResult> {
        const startTime = Date.now();
        const timeout = timeoutMs ?? this.defaultTimeoutMs;

        logger.info({ serverName, uri, timeout }, 'Proxying resource read to backend server');

        const client = this.clientManager.getClient(serverName);
        if(!client) {
            throw new Error(`Not connected to backend server: ${serverName}`);
        }

        try {
            // Create timeout promise
            const timeoutPromise = new Promise<never>((_resolve, reject) => {
                setTimeout(() => {
                    reject(new Error(`Resource read timed out after ${timeout}ms`));
                }, timeout);
            });

            // Race between resource read and timeout
            const result = await Promise.race([
                client.readResource({ uri }),
                timeoutPromise,
            ]);

            const duration = Date.now() - startTime;
            logger.info(
                { serverName, uri, durationMs: duration },
                'Resource read completed successfully'
            );

            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(
                {
                    serverName,
                    uri,
                    durationMs: duration,
                    error:      _.isError(error) ? error.message : String(error),
                },
                'Resource read failed'
            );

            // Re-throw with more context
            throw new Error(
                `Resource read from ${serverName} (${uri}) failed: ${_.isError(error) ? error.message : String(error)}`
            );
        }
    }

    /**
     * Get a prompt from a backend server
     */
    async getPrompt(
        serverName: string,
        name: string,
        args?: Record<string, string>,
        timeoutMs?: number
    ): Promise<GetPromptResult> {
        const startTime = Date.now();
        const timeout = timeoutMs ?? this.defaultTimeoutMs;

        logger.info({ serverName, name, timeout }, 'Proxying prompt get to backend server');

        const client = this.clientManager.getClient(serverName);
        if(!client) {
            throw new Error(`Not connected to backend server: ${serverName}`);
        }

        try {
            // Create timeout promise
            const timeoutPromise = new Promise<never>((_resolve, reject) => {
                setTimeout(() => {
                    reject(new Error(`Prompt get timed out after ${timeout}ms`));
                }, timeout);
            });

            // Race between prompt get and timeout
            const result = await Promise.race([
                client.getPrompt({ name, arguments: args }),
                timeoutPromise,
            ]);

            const duration = Date.now() - startTime;
            logger.info(
                { serverName, name, durationMs: duration },
                'Prompt get completed successfully'
            );

            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(
                {
                    serverName,
                    name,
                    durationMs: duration,
                    error:      _.isError(error) ? error.message : String(error),
                },
                'Prompt get failed'
            );

            // Re-throw with more context
            throw new Error(
                `Prompt get from ${serverName} (${name}) failed: ${_.isError(error) ? error.message : String(error)}`
            );
        }
    }

    /**
     * Call a tool with automatic retry on failure
     */
    async callToolWithRetry(
        serverName: string,
        toolName: string,
        args: unknown,
        options: {
            maxRetries?:   number
            retryDelayMs?: number
            timeoutMs?:    number
        } = {}
    ): Promise<CallToolResult> {
        const maxRetries = options.maxRetries ?? 2;
        const retryDelayMs = options.retryDelayMs ?? 1000;
        let lastError: Error | undefined;

        for(let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if(attempt > 0) {
                    logger.info(
                        { serverName, toolName, attempt, maxRetries },
                        'Retrying tool call'
                    );
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
                }

                return await this.callTool(serverName, toolName, args, options.timeoutMs);
            } catch (error) {
                lastError = _.isError(error) ? error : new Error(String(error));

                if(attempt === maxRetries) {
                    logger.error(
                        { serverName, toolName, attempt, maxRetries },
                        'Tool call failed after all retries'
                    );
                    break;
                }

                logger.warn(
                    { serverName, toolName, attempt, maxRetries, error: lastError.message },
                    'Tool call failed, will retry'
                );
            }
        }

        throw lastError ?? new Error('Tool call failed with unknown error');
    }

    /**
     * Read a resource with automatic retry on failure
     */
    async readResourceWithRetry(
        serverName: string,
        uri: string,
        options: {
            maxRetries?:   number
            retryDelayMs?: number
            timeoutMs?:    number
        } = {}
    ): Promise<ReadResourceResult> {
        const maxRetries = options.maxRetries ?? 2;
        const retryDelayMs = options.retryDelayMs ?? 1000;
        let lastError: Error | undefined;

        for(let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if(attempt > 0) {
                    logger.info(
                        { serverName, uri, attempt, maxRetries },
                        'Retrying resource read'
                    );
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
                }

                return await this.readResource(serverName, uri, options.timeoutMs);
            } catch (error) {
                lastError = _.isError(error) ? error : new Error(String(error));

                if(attempt === maxRetries) {
                    logger.error(
                        { serverName, uri, attempt, maxRetries },
                        'Resource read failed after all retries'
                    );
                    break;
                }

                logger.warn(
                    { serverName, uri, attempt, maxRetries, error: lastError.message },
                    'Resource read failed, will retry'
                );
            }
        }

        throw lastError ?? new Error('Resource read failed with unknown error');
    }

    /**
     * Get a prompt with automatic retry on failure
     */
    async getPromptWithRetry(
        serverName: string,
        name: string,
        args?: Record<string, string>,
        options: {
            maxRetries?:   number
            retryDelayMs?: number
            timeoutMs?:    number
        } = {}
    ): Promise<GetPromptResult> {
        const maxRetries = options.maxRetries ?? 2;
        const retryDelayMs = options.retryDelayMs ?? 1000;
        let lastError: Error | undefined;

        for(let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if(attempt > 0) {
                    logger.info(
                        { serverName, name, attempt, maxRetries },
                        'Retrying prompt get'
                    );
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
                }

                return await this.getPrompt(serverName, name, args, options.timeoutMs);
            } catch (error) {
                lastError = _.isError(error) ? error : new Error(String(error));

                if(attempt === maxRetries) {
                    logger.error(
                        { serverName, name, attempt, maxRetries },
                        'Prompt get failed after all retries'
                    );
                    break;
                }

                logger.warn(
                    { serverName, name, attempt, maxRetries, error: lastError.message },
                    'Prompt get failed, will retry'
                );
            }
        }

        throw lastError ?? new Error('Prompt get failed with unknown error');
    }

    /**
     * Batch call multiple tools in parallel
     */
    async callToolsBatch(
        calls: { serverName: string, toolName: string, args: unknown, timeoutMs?: number }[]
    ): Promise<{ success: boolean, result?: CallToolResult, error?: string }[]> {
        logger.info({ callCount: calls.length }, 'Executing batch tool calls');

        const results = await Promise.allSettled(
            _.map(calls, ({ serverName, toolName, args, timeoutMs }) =>
                this.callTool(serverName, toolName, args, timeoutMs)
            )
        );

        return _.map(results, (result, index): { success: boolean, result?: CallToolResult, error?: string } => {
            if(result.status === 'fulfilled') {
                const toolResult: CallToolResult = result.value;

                return { success: true, result: toolResult };
            } else {
                const errorMsg: string = _.isError(result.reason) ? result.reason.message : String(result.reason);
                logger.warn(
                    { serverName: calls[index]?.serverName, toolName: calls[index]?.toolName, error: errorMsg },
                    'Batch tool call failed'
                );
                return { success: false, error: errorMsg };
            }
        });
    }

    /**
     * Batch read multiple resources in parallel
     */
    async readResourcesBatch(
        reads: { serverName: string, uri: string, timeoutMs?: number }[]
    ): Promise<{ success: boolean, result?: ReadResourceResult, error?: string }[]> {
        logger.info({ readCount: reads.length }, 'Executing batch resource reads');

        const results = await Promise.allSettled(
            _.map(reads, ({ serverName, uri, timeoutMs }) =>
                this.readResource(serverName, uri, timeoutMs)
            )
        );
        return _.map(results, (result, index): { success: boolean, result?: ReadResourceResult, error?: string } => {
            if(result.status === 'fulfilled') {
                const resourceResult: ReadResourceResult = result.value;

                return { success: true, result: resourceResult };
            } else {
                const errorMsg: string = _.isError(result.reason) ? result.reason.message : String(result.reason);
                logger.warn(
                    { serverName: reads[index]?.serverName, uri: reads[index]?.uri, error: errorMsg },
                    'Batch resource read failed'
                );
                return { success: false, error: errorMsg };
            }
        });
    }

    /**
     * Update default timeout
     */
    setDefaultTimeout(timeoutMs: number): void {
        this.defaultTimeoutMs = timeoutMs;
        logger.info({ timeoutMs }, 'Updated default proxy timeout');
    }

    /**
     * Get current default timeout
     */
    getDefaultTimeout(): number {
        return this.defaultTimeoutMs;
    }
}

export default ProxyService;
