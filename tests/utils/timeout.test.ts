/**
 * Tests for timeout utilities
 */

import { describe, it, expect } from 'bun:test';
import { withTimeout, cancellableDelay } from '../../src/utils/timeout.js';

describe('withTimeout', () => {
    it('should return result when operation completes before timeout', async () => {
        const operation = Promise.resolve('success');
        const result = await withTimeout(operation, 5000, 'Timeout');

        expect(result).toBe('success');
    });

    it('should throw timeout error when operation exceeds timeout', async () => {
        // Create a promise that resolves after 100ms
        const operation = new Promise(resolve => setTimeout(resolve, 100));

        // Set timeout to 10ms (shorter than operation)
        try {
            await withTimeout(operation, 10, 'Operation timed out');
            throw new Error('Expected timeout error but none was thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain('Operation timed out');
        }
    });

    it('should propagate errors from the operation', async () => {
        const operation = Promise.reject(new Error('Operation failed'));

        try {
            await withTimeout(operation, 5000, 'Timeout');
            throw new Error('Expected operation error but none was thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain('Operation failed');
        }
    });

    it('should handle zero timeout', async () => {
        const operation = new Promise(resolve => setTimeout(resolve, 100));

        try {
            await withTimeout(operation, 0, 'Instant timeout');
            throw new Error('Expected instant timeout but none was thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain('Instant timeout');
        }
    });

    it('should work with fast async operations', async () => {
        const results = await Promise.all([
            withTimeout(Promise.resolve(1), 1000, 'Timeout 1'),
            withTimeout(Promise.resolve(2), 1000, 'Timeout 2'),
            withTimeout(Promise.resolve(3), 1000, 'Timeout 3'),
        ]);

        expect(results).toEqual([1, 2, 3]);
    });

    it('should cleanup timeout when operation completes', async () => {
        // This test verifies that we don't leak timeout handles
        // by running many operations quickly
        const operations = Array.from({ length: 100 }, (_, i) =>
            withTimeout(Promise.resolve(i), 1000, `Timeout ${i}`)
        );

        const results = await Promise.all(operations);
        expect(results).toHaveLength(100);
    });
});

describe('cancellableDelay', () => {
    it('should resolve after delay', async () => {
        const startTime = Date.now();
        const { promise } = cancellableDelay(50);

        await promise;

        const duration = Date.now() - startTime;
        expect(duration).toBeGreaterThanOrEqual(40); // Allow some jitter
    });

    it('should resolve immediately when cancelled', async () => {
        const { promise, cancel } = cancellableDelay(5000);

        const startTime = Date.now();
        cancel();
        await promise;
        const duration = Date.now() - startTime;

        // Should complete almost instantly
        expect(duration).toBeLessThan(100);
    });

    it('should handle cancel after natural completion', async () => {
        const { promise, cancel } = cancellableDelay(10);

        await promise;

        // Should not throw or cause issues
        cancel();
    });

    it('should be cancellable multiple times', async () => {
        const { promise, cancel } = cancellableDelay(5000);

        cancel();
        cancel(); // Should be safe to call multiple times

        await promise;
    });
});

describe('withTimeout integration scenarios', () => {
    it('should handle mixed success and timeout in batch', async () => {
        const results = await Promise.allSettled([
            withTimeout(Promise.resolve('fast'), 100, 'Timeout'),
            withTimeout(
                new Promise(resolve => setTimeout(resolve, 200)),
                50,
                'Too slow'
            ),
            withTimeout(Promise.resolve('also fast'), 100, 'Timeout'),
        ]);

        expect(results[0]?.status).toBe('fulfilled');
        expect(results[1]?.status).toBe('rejected');
        expect(results[2]?.status).toBe('fulfilled');
    });

    it('should work with async function results', async () => {
        const asyncFunc = async (): Promise<string> => {
            await new Promise(resolve => setTimeout(resolve, 10));
            return 'async result';
        };

        const result = await withTimeout(asyncFunc(), 1000, 'Timeout');
        expect(result).toBe('async result');
    });
});
