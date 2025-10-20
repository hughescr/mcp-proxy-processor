/**
 * Async testing utilities for handling timeouts, events, and conditions
 */

import _ from 'lodash';
import type { EventEmitter } from 'node:events';

/**
 * Wait for a condition to become true within a timeout period
 *
 * @example
 * ```typescript
 * await waitFor(() => server.isReady(), { timeout: 5000 });
 * ```
 */
export async function waitFor(
    condition: () => boolean | Promise<boolean>,
    options: { timeout?: number, interval?: number } = {}
): Promise<void> {
    const { timeout = 5000, interval = 100 } = options;
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
 * Wait for an event to be emitted from an EventEmitter
 *
 * @example
 * ```typescript
 * const data = await waitForEvent(server, 'ready', 5000);
 * ```
 */
export async function waitForEvent<T = unknown>(
    emitter: EventEmitter,
    event: string,
    timeout = 5000
): Promise<T> {
    return new Promise((resolve, reject) => {
        const handler = (data: T, tid: NodeJS.Timeout) => {
            clearTimeout(tid);
            resolve(data);
        };

        const timeoutId = setTimeout(() => {
            emitter.off(event, (data: T) => handler(data, timeoutId));
            reject(new Error(`Event "${event}" not emitted within ${timeout}ms`));
        }, timeout);

        emitter.once(event, (data: T) => handler(data, timeoutId));
    });
}

/**
 * Create a promise that rejects after a timeout
 * Useful for testing timeout behavior
 *
 * @example
 * ```typescript
 * await Promise.race([
 *   operationThatShouldTimeout(),
 *   timeout(1000)
 * ]);
 * ```
 */
export function timeout(ms: number, message?: string): Promise<never> {
    return new Promise((_resolve, reject) => {
        setTimeout(() => {
            reject(new Error(message ?? `Timeout after ${ms}ms`));
        }, ms);
    });
}

/**
 * Wait for multiple events to be emitted in sequence
 *
 * @example
 * ```typescript
 * const events = await waitForEvents(server, ['connecting', 'connected'], 5000);
 * ```
 */
export async function waitForEvents(
    emitter: EventEmitter,
    events: string[],
    timeout = 5000
): Promise<unknown[]> {
    const results: unknown[] = [];
    const startTime = Date.now();

    for(const event of events) {
        const remaining = timeout - (Date.now() - startTime);
        if(remaining <= 0) {
            throw new Error(`Timeout waiting for events: ${events.join(', ')}`);
        }

        const result = await waitForEvent(emitter, event, remaining);
        results.push(result);
    }

    return results;
}

/**
 * Create a deferred promise that can be resolved or rejected externally
 *
 * @example
 * ```typescript
 * const deferred = createDeferred<string>();
 * setTimeout(() => deferred.resolve('done'), 100);
 * const result = await deferred.promise;
 * ```
 */
export interface Deferred<T> {
    promise:  Promise<T>
    resolve:  (value: T) => void
    reject:   (reason?: unknown) => void
    resolved: boolean
    rejected: boolean
}

export function createDeferred<T>(): Deferred<T> {
    let resolveFn!: (value: T) => void;
    let rejectFn!: (reason?: unknown) => void;
    let resolved = false;
    let rejected = false;

    const promise = new Promise<T>((resolve, reject) => {
        resolveFn = (value: T) => {
            resolved = true;
            resolve(value);
        };
        rejectFn = (reason?: unknown) => {
            rejected = true;
            const error = _.isError(reason) ? reason : new Error('Deferred rejected without reason');
            reject(error);
        };
    });

    return {
        promise,
        resolve: resolveFn,
        reject:  rejectFn,
        get resolved() {
            return resolved;
        },
        get rejected() {
            return rejected;
        },
    };
}

/**
 * Delay execution for a specified number of milliseconds
 *
 * @example
 * ```typescript
 * await delay(1000); // Wait 1 second
 * ```
 */
export async function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async operation until it succeeds or reaches max attempts
 *
 * @example
 * ```typescript
 * const result = await retry(
 *   () => fetchData(),
 *   { maxAttempts: 3, delay: 1000 }
 * );
 * ```
 */
export async function retry<T>(
    operation: () => Promise<T>,
    options: {
        maxAttempts?: number
        delay?:       number
        onError?:     (error: unknown, attempt: number) => void
    } = {}
): Promise<T> {
    const { maxAttempts = 3, delay: delayMs = 1000, onError } = options;

    let lastError: unknown;

    for(let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            onError?.(error, attempt);

            if(attempt < maxAttempts) {
                await delay(delayMs);
            }
        }
    }

    throw new Error(
        `Operation failed after ${maxAttempts} attempts. Last error: ${String(lastError)}`
    );
}

/**
 * Execute an async function with a timeout
 * Returns the result if it completes in time, otherwise throws
 *
 * @example
 * ```typescript
 * const result = await withTimeout(
 *   () => slowOperation(),
 *   5000
 * );
 * ```
 */
export async function withTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    message?: string
): Promise<T> {
    return Promise.race([
        operation(),
        timeout(timeoutMs, message),
    ]);
}

/**
 * Poll a function until it returns a truthy value or times out
 *
 * @example
 * ```typescript
 * const value = await poll(
 *   () => getStatus(),
 *   { timeout: 5000, interval: 500 }
 * );
 * ```
 */
export async function poll<T>(
    fn: () => T | Promise<T>,
    options: { timeout?: number, interval?: number } = {}
): Promise<T> {
    const { timeout: timeoutMs = 5000, interval = 100 } = options;
    const startTime = Date.now();

    while(true) {
        const result = await fn();
        if(result) {
            return result;
        }

        if(Date.now() - startTime >= timeoutMs) {
            throw new Error(`Poll timeout after ${timeoutMs}ms`);
        }

        await delay(interval);
    }
}

/**
 * Flush all pending promises in the microtask queue
 * Useful for waiting for all queued async operations to complete
 *
 * @example
 * ```typescript
 * server.start(); // Async operation
 * await flushPromises();
 * // Now all promises from start() have settled
 * ```
 */
export async function flushPromises(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

/**
 * Run multiple async operations in sequence
 *
 * @example
 * ```typescript
 * const results = await sequence([
 *   () => operation1(),
 *   () => operation2(),
 *   () => operation3(),
 * ]);
 * ```
 */
export async function sequence<T>(operations: (() => Promise<T>)[]): Promise<T[]> {
    const results: T[] = [];

    for(const operation of operations) {
        results.push(await operation());
    }

    return results;
}

/**
 * Collect all events emitted during an async operation
 *
 * @example
 * ```typescript
 * const events = await collectEvents(
 *   emitter,
 *   'data',
 *   async () => await processData()
 * );
 * ```
 */
export async function collectEvents<T>(
    emitter: EventEmitter,
    event: string,
    operation: () => Promise<void>
): Promise<T[]> {
    const collected: T[] = [];

    const handler = (data: T) => {
        collected.push(data);
    };

    emitter.on(event, handler);

    try {
        await operation();
    } finally {
        emitter.off(event, handler);
    }

    return collected;
}
