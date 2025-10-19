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

import { dynamicLogger as logger } from '../utils/silent-logger.js';
import _ from 'lodash';
import type { CallToolResult, ReadResourceResult, GetPromptResult } from '@modelcontextprotocol/sdk/types';
import type { ClientManager } from './client-manager.js';
import { withTimeout } from '../utils/index.js';

/**
 * Configuration for proxy operations
 */
export interface ProxyConfig {
    /** Default timeout for operations in milliseconds */
    defaultTimeoutMs?: number
}

/**
 * Generic retry wrapper for any async operation
 */
async function retryOperation<T>(
    operation: () => Promise<T>,
    options: {
        maxRetries?:   number
        retryDelayMs?: number
        onRetry?:      (attempt: number, error: Error) => void
        onFailure?:    (finalError: Error) => void
    } = {}
): Promise<T> {
    const maxRetries = options.maxRetries ?? 2;
    const retryDelayMs = options.retryDelayMs ?? 1000;
    let lastError: Error | undefined;

    for(let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if(attempt > 0) {
                if(options.onRetry) {
                    options.onRetry(attempt, lastError!);
                }
                // Linear backoff: delay increases linearly with each attempt
                // Future improvement: Consider exponential backoff with jitter for better load distribution
                await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
            }

            return await operation();
        } catch (error) {
            lastError = _.isError(error) ? error : new Error(String(error));

            if(attempt === maxRetries) {
                if(options.onFailure) {
                    options.onFailure(lastError);
                }
                break;
            }
        }
    }

    throw lastError ?? new Error('Operation failed with unknown error');
}

/**
 * Generic helper for executing backend operations with consistent logging and error handling
 */
async function executeBackendOperation<T>(
    serverName: string,
    identifier: string,
    identifierKey: string,
    operationType: string,
    timeout: number,
    clientManager: ClientManager,
    execute: (client: Awaited<ReturnType<typeof clientManager.ensureConnected>>) => Promise<T>
): Promise<T> {
    const startTime = Date.now();

    logger.info(
        { serverName, [identifierKey]: identifier, timeout },
        `Proxying ${operationType} to backend server`
    );

    try {
        const client = await clientManager.ensureConnected(serverName);
        const result = await execute(client);

        const duration = Date.now() - startTime;
        logger.info(
            { serverName, [identifierKey]: identifier, durationMs: duration },
            `${operationType} completed successfully`
        );

        return result;
    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(
            {
                serverName,
                [identifierKey]: identifier,
                durationMs:      duration,
                error:           _.isError(error) ? error.message : String(error),
            },
            `${operationType} failed`
        );

        // Re-throw with more context
        const contextMessage = identifierKey === 'toolName'
            ? `${serverName}.${identifier}`
            : `${serverName} (${identifier})`;
        throw new Error(
            `${operationType} ${contextMessage} failed: ${_.isError(error) ? error.message : String(error)}`
        );
    }
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
        const timeout = timeoutMs ?? this.defaultTimeoutMs;

        return executeBackendOperation(
            serverName,
            toolName,
            'toolName',
            'Tool call',
            timeout,
            this.clientManager,
            client => withTimeout(
                client.callTool({
                    name:      toolName,
                    arguments: args as Record<string, unknown>,
                }),
                timeout,
                `Tool call timed out after ${timeout}ms`
            ) as Promise<CallToolResult>
        );
    }

    /**
     * Read a resource from a backend server
     */
    async readResource(
        serverName: string,
        uri: string,
        timeoutMs?: number
    ): Promise<ReadResourceResult> {
        const timeout = timeoutMs ?? this.defaultTimeoutMs;

        return executeBackendOperation(
            serverName,
            uri,
            'uri',
            'Resource read',
            timeout,
            this.clientManager,
            client => withTimeout(
                client.readResource({ uri }),
                timeout,
                `Resource read timed out after ${timeout}ms`
            )
        );
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
        const timeout = timeoutMs ?? this.defaultTimeoutMs;

        return executeBackendOperation(
            serverName,
            name,
            'name',
            'Prompt get',
            timeout,
            this.clientManager,
            client => withTimeout(
                client.getPrompt({ name, arguments: args }),
                timeout,
                `Prompt get timed out after ${timeout}ms`
            )
        );
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
        return retryOperation(
            () => this.callTool(serverName, toolName, args, options.timeoutMs),
            {
                maxRetries:   options.maxRetries,
                retryDelayMs: options.retryDelayMs,
                onRetry:      (attempt, error) => {
                    logger.warn(
                        { serverName, toolName, attempt, maxRetries: options.maxRetries ?? 2, error: error.message },
                        'Tool call failed, will retry'
                    );
                },
                onFailure: () => {
                    logger.error(
                        { serverName, toolName, maxRetries: options.maxRetries ?? 2 },
                        'Tool call failed after all retries'
                    );
                },
            }
        );
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
        return retryOperation(
            () => this.readResource(serverName, uri, options.timeoutMs),
            {
                maxRetries:   options.maxRetries,
                retryDelayMs: options.retryDelayMs,
                onRetry:      (attempt, error) => {
                    logger.warn(
                        { serverName, uri, attempt, maxRetries: options.maxRetries ?? 2, error: error.message },
                        'Resource read failed, will retry'
                    );
                },
                onFailure: () => {
                    logger.error(
                        { serverName, uri, maxRetries: options.maxRetries ?? 2 },
                        'Resource read failed after all retries'
                    );
                },
            }
        );
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
        return retryOperation(
            () => this.getPrompt(serverName, name, args, options.timeoutMs),
            {
                maxRetries:   options.maxRetries,
                retryDelayMs: options.retryDelayMs,
                onRetry:      (attempt, error) => {
                    logger.warn(
                        { serverName, name, attempt, maxRetries: options.maxRetries ?? 2, error: error.message },
                        'Prompt get failed, will retry'
                    );
                },
                onFailure: () => {
                    logger.error(
                        { serverName, name, maxRetries: options.maxRetries ?? 2 },
                        'Prompt get failed after all retries'
                    );
                },
            }
        );
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
