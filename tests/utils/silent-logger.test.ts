/**
 * Tests for Silent Logger - Dynamic Logger Selection
 *
 * REGRESSION TESTS: Verify that logger selection dynamically responds to ADMIN_MODE
 * environment variable changes at runtime.
 *
 * Bug fix: Previously, logger selection was static at module load time, causing
 * admin mode to still produce stderr output. Now uses lazy proxy pattern to check
 * ADMIN_MODE on each log call.
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { constant, some as _some, map as _map } from 'lodash';
import { dynamicLogger } from '../../src/utils/silent-logger.js';

// Type for spy mock object with proper typing
interface MockSpy {
    mock: {
        calls: unknown[][]
    }
    mockClear: () => void
}

describe('Silent Logger - Dynamic Logger Selection', () => {
    let originalAdminMode: string | undefined;
    let stderrSpy: MockSpy;
    let stdoutSpy: MockSpy;

    beforeEach(() => {
        // Save original ADMIN_MODE value
        originalAdminMode = process.env.ADMIN_MODE;

        // Spy on stderr and stdout writes
        stderrSpy = spyOn(process.stderr, 'write').mockImplementation(constant(true)) as unknown as MockSpy;
        stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(constant(true)) as unknown as MockSpy;
    });

    afterEach(() => {
        // Restore original ADMIN_MODE value
        if(originalAdminMode === undefined) {
            delete process.env.ADMIN_MODE;
        } else {
            process.env.ADMIN_MODE = originalAdminMode;
        }

        // Restore spies
        mock.restore();
    });

    it('should use stderr logger when ADMIN_MODE is not set', () => {
        delete process.env.ADMIN_MODE;

        dynamicLogger.info('test message');

        // Verify stderr was written to
        expect(stderrSpy).toHaveBeenCalled();

        // Verify the message contains our test text
        const calls = stderrSpy.mock.calls;
        const hasTestMessage = _some(calls, (call) => {
            const output = String(call[0]);
            return output.includes('test message');
        });
        expect(hasTestMessage).toBe(true);

        // Verify stdout was NOT written to
        expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('should use stderr logger when ADMIN_MODE is false', () => {
        process.env.ADMIN_MODE = 'false';

        dynamicLogger.warn('warning message');

        // Verify stderr was written to
        expect(stderrSpy).toHaveBeenCalled();

        // Verify the message contains our test text
        const calls = stderrSpy.mock.calls;
        const hasWarning = _some(calls, (call) => {
            const output = String(call[0]);
            return output.includes('warning message');
        });
        expect(hasWarning).toBe(true);

        // Verify stdout was NOT written to
        expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('should use silent logger when ADMIN_MODE is true', () => {
        process.env.ADMIN_MODE = 'true';

        dynamicLogger.info('this should be silent');
        dynamicLogger.warn('this should also be silent');
        dynamicLogger.error('even errors should be silent');

        // Verify NO output to stderr or stdout
        expect(stderrSpy).not.toHaveBeenCalled();
        expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('should switch logger based on ADMIN_MODE changes', () => {
        // Start with ADMIN_MODE=false (stderr logger)
        process.env.ADMIN_MODE = 'false';
        dynamicLogger.info('first message');
        expect(stderrSpy).toHaveBeenCalled();

        // Clear spy history
        stderrSpy.mockClear();
        stdoutSpy.mockClear();

        // Switch to ADMIN_MODE=true (silent logger)
        process.env.ADMIN_MODE = 'true';
        dynamicLogger.info('second message - should be silent');
        expect(stderrSpy).not.toHaveBeenCalled();
        expect(stdoutSpy).not.toHaveBeenCalled();

        // Switch back to ADMIN_MODE=false (stderr logger)
        process.env.ADMIN_MODE = 'false';
        dynamicLogger.info('third message');
        expect(stderrSpy).toHaveBeenCalled();

        // Verify the third message contains our test text
        const calls = stderrSpy.mock.calls;
        const hasThirdMessage = _some(calls, (call) => {
            const output = String(call[0]);
            return output.includes('third message');
        });
        expect(hasThirdMessage).toBe(true);
    });

    it('should handle all log levels correctly in admin mode', () => {
        process.env.ADMIN_MODE = 'true';

        // All log levels should be silent
        dynamicLogger.debug('debug message');
        dynamicLogger.info('info message');
        dynamicLogger.warn('warn message');
        dynamicLogger.error('error message');
        dynamicLogger.log('info', {}, 'log message');

        // Verify NO output
        expect(stderrSpy).not.toHaveBeenCalled();
        expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('should handle all log levels correctly in serve mode', () => {
        delete process.env.ADMIN_MODE;

        // All log levels should go to stderr
        dynamicLogger.debug('debug message');
        dynamicLogger.info('info message');
        dynamicLogger.warn('warn message');
        dynamicLogger.error('error message');

        // Verify stderr was written to (at least once for each level)
        expect(stderrSpy.mock.calls.length).toBeGreaterThan(0);

        // Verify stdout was NOT written to
        expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('should return the logger instance for method chaining', () => {
        process.env.ADMIN_MODE = 'true';

        // Should support chaining
        const result = dynamicLogger
            .info('first')
            .warn('second')
            .error('third');

        // Should return a logger-like object
        expect(result).toBeDefined();
        expect(typeof result.info).toBe('function');
    });

    it('should handle object-style log calls in serve mode', () => {
        delete process.env.ADMIN_MODE;

        dynamicLogger.info({ message: 'test', data: { key: 'value' } });

        // Verify stderr was written to
        expect(stderrSpy).toHaveBeenCalled();

        // Verify stdout was NOT written to
        expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('should handle object-style log calls in admin mode', () => {
        process.env.ADMIN_MODE = 'true';

        dynamicLogger.info({ message: 'test', data: { key: 'value' } });

        // Verify NO output
        expect(stderrSpy).not.toHaveBeenCalled();
        expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('should handle log() method with string message in serve mode', () => {
        delete process.env.ADMIN_MODE;

        dynamicLogger.log('warn', 'test warning message');

        // Verify stderr was written to
        expect(stderrSpy).toHaveBeenCalled();

        // Verify the message contains our test text
        const calls = stderrSpy.mock.calls;
        const hasTestMessage = _some(calls, (call) => {
            const output = String(call[0]);
            return output.includes('test warning message');
        });
        expect(hasTestMessage).toBe(true);

        // Verify stdout was NOT written to
        expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('should handle log() method with object message in serve mode', () => {
        delete process.env.ADMIN_MODE;

        const testData = { message: 'log test', details: { foo: 'bar' } };
        dynamicLogger.log('info', testData);

        // Verify stderr was written to
        expect(stderrSpy).toHaveBeenCalled();

        // Verify the message contains our test data (at least the key parts)
        const calls = stderrSpy.mock.calls;
        const hasTestData = _some(calls, (call) => {
            const output = String(call[0]);
            return output.includes('log test') || output.includes('foo');
        });
        expect(hasTestData).toBe(true);

        // Verify stdout was NOT written to
        expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('should handle log() method with different log levels in serve mode', () => {
        delete process.env.ADMIN_MODE;

        // Clear any previous calls
        stderrSpy.mockClear();
        stdoutSpy.mockClear();

        // Test different log levels with log() method
        dynamicLogger.log('debug', 'debug level message');
        dynamicLogger.log('info', 'info level message');
        dynamicLogger.log('warn', 'warn level message');
        dynamicLogger.log('error', 'error level message');

        // Verify stderr was written to for each log call
        expect(stderrSpy.mock.calls.length).toBeGreaterThanOrEqual(3); // At least info, warn, error (debug may be filtered by LOG_LEVEL)

        // Verify the messages contain our test text
        const calls = stderrSpy.mock.calls;
        const allCallsAsString = _map(calls, call => String(call[0])).join('\n');

        // Should contain at least the non-debug messages (debug might be filtered by default LOG_LEVEL)
        expect(allCallsAsString).toContain('info level message');
        expect(allCallsAsString).toContain('warn level message');
        expect(allCallsAsString).toContain('error level message');

        // Verify stdout was NOT written to
        expect(stdoutSpy).not.toHaveBeenCalled();
    });
});
