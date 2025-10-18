/**
 * Timeout Utilities
 *
 * Provides utilities for adding timeouts to async operations with proper cleanup
 * to prevent memory leaks from uncancelled timeout handles.
 */

/**
 * Race a promise against a timeout, with automatic cleanup of the timeout
 * when the operation completes first.
 *
 * This prevents memory leaks from pending timeout callbacks that would otherwise
 * remain in the event loop even after the operation completes.
 *
 * @param promise - The async operation to race
 * @param timeoutMs - Timeout duration in milliseconds
 * @param timeoutMessage - Error message to use when timeout occurs
 * @returns The result of the promise if it completes before timeout
 * @throws Error with timeoutMessage if timeout occurs first
 *
 * @example
 * const result = await withTimeout(
 *   fetch('https://api.example.com'),
 *   5000,
 *   'API request timed out after 5s'
 * );
 */
export async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;

    try {
        // Create a timeout promise that we can cancel
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
            timeoutHandle = setTimeout(() => {
                reject(new Error(timeoutMessage));
            }, timeoutMs);
        });

        // Race the operation against the timeout
        const result = await Promise.race([promise, timeoutPromise]);

        // If we got here, the operation completed successfully
        // Clear the timeout to prevent memory leak
        if(timeoutHandle !== undefined) {
            clearTimeout(timeoutHandle);
        }

        return result;
    } catch (error) {
        // Clean up timeout on error path too
        if(timeoutHandle !== undefined) {
            clearTimeout(timeoutHandle);
        }
        throw error;
    }
}

/**
 * Create a cancellable delay
 *
 * @param delayMs - Delay duration in milliseconds
 * @returns Promise that resolves after delay, and a cancel function
 *
 * @example
 * const { promise, cancel } = cancellableDelay(5000);
 * // Later, if needed:
 * cancel();
 */
export function cancellableDelay(delayMs: number): {
    promise: Promise<void>
    cancel:  () => void
} {
    let timeoutHandle: NodeJS.Timeout | undefined;
    let resolveFn: (() => void) | undefined;

    const promise = new Promise<void>((resolve) => {
        resolveFn = resolve;
        timeoutHandle = setTimeout(() => {
            resolve();
        }, delayMs);
    });

    const cancel = (): void => {
        if(timeoutHandle !== undefined) {
            clearTimeout(timeoutHandle);
        }
        if(resolveFn !== undefined) {
            resolveFn();
        }
    };

    return { promise, cancel };
}
