/**
 * Silent Logger - No-op logger for admin mode
 *
 * This module provides a silent logger that does nothing,
 * used to suppress all logging output in admin mode.
 */

import type * as LoggerModule from '@hughescr/logger';

// Type alias to work around TypeScript namespace confusion
type LoggerType = LoggerModule.Logger;

/**
 * Create a no-op logger that silently ignores all log calls
 */
class SilentLogger implements LoggerType {
    debug(..._args: unknown[]): LoggerType {
        return this;
    }

    info(..._args: unknown[]): LoggerType {
        return this;
    }

    warn(..._args: unknown[]): LoggerType {
        return this;
    }

    error(..._args: unknown[]): LoggerType {
        return this;
    }

    log(..._args: unknown[]): LoggerType {
        return this;
    }
}

export const logger: LoggerType = new SilentLogger();
