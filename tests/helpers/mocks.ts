/**
 * Mock implementations for subprocess operations and stdio transport
 * Used for testing ServerManager and Frontend MCP protocol interactions
 */

import _ from 'lodash';
import { EventEmitter } from 'node:events';
import { Writable, Readable } from 'node:stream';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

/**
 * Mock process interface matching Node.js ChildProcess
 */
export interface MockProcess extends EventEmitter {
    stdout:           Readable
    stderr:           Readable
    stdin:            Writable
    stdio:            [Writable | null, Readable | null, Readable | null, Readable | Writable | null | undefined, Readable | Writable | null | undefined]
    pid:              number
    killed:           boolean
    connected:        boolean
    exitCode:         number | null
    signalCode:       NodeJS.Signals | null
    spawnargs:        string[]
    spawnfile:        string
    kill:             (signal?: NodeJS.Signals | number) => boolean
    send:             () => boolean
    disconnect:       () => void
    unref:            () => void
    ref:              () => void
    [Symbol.dispose]: () => void
    on:               (event: string, handler: (...args: unknown[]) => void) => this
    emit:             (event: string | symbol, ...args: unknown[]) => boolean
}

/**
 * Options for creating a mock process
 */
export interface MockProcessOptions {
    /** Exit code to emit when process exits (default: 0) */
    exitCode?:       number
    /** Delay in ms before emitting exit event (default: immediate) */
    exitAfter?:      number
    /** Lines to emit on stderr */
    stderrOutput?:   string[]
    /** Lines to emit on stdout */
    stdoutOutput?:   string[]
    /** Process ID (default: random) */
    pid?:            number
    /** Whether process should emit 'spawn' event (default: true) */
    emitSpawn?:      boolean
    /** Delay before emitting spawn event (default: 0) */
    spawnDelay?:     number
    /** Whether to automatically emit output lines (default: true) */
    autoEmitOutput?: boolean
}

/**
 * Create a mock subprocess for testing ServerManager and similar components
 *
 * @example
 * ```typescript
 * const mockProc = createMockProcess({
 *   exitCode: 0,
 *   exitAfter: 100,
 *   stderrOutput: ['Server started'],
 * });
 *
 * mockProc.on('exit', (code) => console.log(`Exited with ${code}`));
 * ```
 */
export function createMockProcess(options: MockProcessOptions = {}): MockProcess {
    const {
        exitCode = 0,
        exitAfter,
        stderrOutput = [],
        stdoutOutput = [],
        pid = Math.floor(Math.random() * 100000),
        emitSpawn = true,
        spawnDelay = 0,
        autoEmitOutput = true,
    } = options;

    const emitter = new EventEmitter() as MockProcess;
    const stdout = new Readable({ read: () => _.noop() });
    const stderr = new Readable({ read: () => _.noop() });
    const stdin = new Writable({
        write(_chunk, _encoding, callback) {
            callback();
        },
    });

    _.assign(emitter, {
        stdout,
        stderr,
        stdin,
        stdio:      [stdin, stdout, stderr, undefined, undefined] as [Writable | null, Readable | null, Readable | null, Readable | Writable | null | undefined, Readable | Writable | null | undefined],
        pid,
        killed:     false,
        connected:  false,
        exitCode:   null,
        signalCode: null,
        spawnargs:  [],
        spawnfile:  '',
        kill:       (signal?: NodeJS.Signals | number) => {
            emitter.killed = true;
            emitter.exitCode = null;
            emitter.signalCode = (_.isNumber(signal) ? null : signal) ?? 'SIGTERM';
            emitter.emit('exit', null, emitter.signalCode);
            return true;
        },
        send:             _.constant(true), // Stub for IPC - not used in these tests
        disconnect:       () => _.noop(),   // Stub for IPC - not used in these tests
        unref:            () => _.noop(),   // Stub - not used in these tests
        ref:              () => _.noop(),   // Stub - not used in these tests
        [Symbol.dispose]: () => {
            emitter.kill();
        },
    });

    // Setup spawn event emission
    setupSpawnEmission(emitter, emitSpawn, spawnDelay);

    // Setup output emission
    if(autoEmitOutput) {
        setupOutputEmission(stdout, stdoutOutput);
        setupOutputEmission(stderr, stderrOutput);
    }

    // Schedule exit event if requested
    if(exitAfter !== undefined) {
        scheduleExit(stdout, stderr, emitter, exitCode, exitAfter);
    }

    return emitter;
}

/**
 * Setup spawn event emission for mock process
 */
function setupSpawnEmission(emitter: MockProcess, emitSpawn: boolean, spawnDelay: number): void {
    if(!emitSpawn) {
        return;
    }

    if(spawnDelay > 0) {
        setTimeout(() => emitter.emit('spawn'), spawnDelay);
    } else {
        setImmediate(() => emitter.emit('spawn'));
    }
}

/**
 * Setup output emission for a stream
 */
function setupOutputEmission(stream: Readable, output: string[]): void {
    if(output.length === 0) {
        return;
    }

    setImmediate(() => {
        for(const line of output) {
            stream.push(`${line}\n`);
        }
    });
}

/**
 * Schedule process exit event
 */
function scheduleExit(
    stdout: Readable,
    stderr: Readable,
    emitter: MockProcess,
    exitCode: number,
    exitAfter: number
): void {
    setTimeout(() => {
        stdout.push(null); // End stream
        stderr.push(null); // End stream
        emitter.emit('exit', exitCode, null);
    }, exitAfter);
}

/**
 * Loopback transport for testing MCP server protocol without real stdio
 *
 * This creates an in-memory transport that allows you to send messages to an MCP server
 * and capture its responses without involving actual stdin/stdout streams.
 *
 * @example
 * ```typescript
 * const transport = new LoopbackTransport();
 * await transport.connect(mcpServer);
 *
 * // Send a message to the server
 * transport.inject(JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }));
 *
 * // Read the response
 * const response = await transport.nextFrame();
 * ```
 */
export class LoopbackTransport {
    private _server?:          Server;
    private _messageQueue:     string[] = [];
    private _responseQueue:    string[] = [];
    private _stdin:            Readable;
    private _stdout:           Writable;
    private _pendingResolvers: ((value: string) => void)[] = [];

    constructor() {
        // Create mock stdin that we can push messages to
        this._stdin = new Readable({
            read: () => _.noop(),
        });

        // Create mock stdout that captures server responses
        this._stdout = new Writable({
            write: (chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) => {
                const message = chunk.toString();
                this._responseQueue.push(message);

                // Resolve any pending nextFrame() calls
                const resolver = this._pendingResolvers.shift();
                if(resolver) {
                    resolver(message);
                }

                callback();
            },
        });
    }

    /**
     * Connect to an MCP server using this loopback transport
     */
    async connect(server: Server): Promise<void> {
        this._server = server;

        // Connect server to our mock stdio streams with start/close methods
        await server.connect({
            readable: this._stdin,
            writable: this._stdout,
            start:    async () => Promise.resolve(),
            close:    async () => {
                this._stdin.push(null);
            },
        } as never);

        // Process any queued messages
        for(const message of this._messageQueue) {
            this._stdin.push(message);
        }
        this._messageQueue = [];
    }

    /**
     * Inject a message to the server
     * @param message - JSON-RPC message string (should include \n terminator)
     */
    inject(message: string): void {
        const messageWithNewline = _.endsWith(message, '\n') ? message : `${message}\n`;

        if(this._server) {
            this._stdin.push(messageWithNewline);
        } else {
            this._messageQueue.push(messageWithNewline);
        }
    }

    /**
     * Read the next response frame from the server
     * @param timeout - Maximum time to wait in ms (default: 5000)
     * @returns The response message
     */
    async nextFrame(timeout = 5000): Promise<unknown> {
        // Check if we already have a response queued
        if(this._responseQueue.length > 0) {
            const message = this._responseQueue.shift()!;
            return JSON.parse(message) as unknown;
        }

        // Wait for next response
        return new Promise((resolve, reject) => {
            const resolveMessage = (message: string, tid: NodeJS.Timeout) => {
                clearTimeout(tid);
                resolve(JSON.parse(message) as unknown);
            };

            const timeoutId = setTimeout(() => {
                const index = this._pendingResolvers.indexOf((msg: string) => resolveMessage(msg, timeoutId));
                if(index >= 0) {
                    this._pendingResolvers.splice(index, 1);
                }
                reject(new Error(`Timeout waiting for response after ${timeout}ms`));
            }, timeout);

            this._pendingResolvers.push((msg: string) => resolveMessage(msg, timeoutId));
        });
    }

    /**
     * Get all captured response frames (parsed as JSON)
     */
    capturedFrames(): unknown[] {
        return _.map(this._responseQueue, msg => JSON.parse(msg) as unknown);
    }

    /**
     * Get all captured response frames as raw strings
     */
    capturedRawFrames(): string[] {
        return [...this._responseQueue];
    }

    /**
     * Clear all captured responses
     */
    clearCapturedFrames(): void {
        this._responseQueue = [];
    }

    /**
     * Close the transport and cleanup
     */
    async close(): Promise<void> {
        this._stdin.push(null);
        await this._server?.close();
    }
}
