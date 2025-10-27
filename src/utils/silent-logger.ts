/**
 * Stderr Logger - Logger configured to write only to stderr
 *
 * This module provides logger instances that write exclusively to stderr,
 * preventing corruption of MCP protocol messages on stdout.
 *
 * Two logger types are exported:
 * - logger: A no-op silent logger (for admin mode or when logging is disabled)
 * - stderrLogger: A winston-based logger that writes all output to stderr (for MCP serve mode)
 */

import type * as LoggerModule from '@hughescr/logger';
import winston from 'winston';
import { isString } from 'lodash';

// Type alias to work around TypeScript namespace confusion
type LoggerType = LoggerModule.Logger;

/**
 * Create a no-op logger that silently ignores all log calls
 * Used in admin mode to avoid cluttering the UI
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

/**
 * Create a winston logger that writes ALL output to stderr
 * This is critical for MCP serve mode to prevent stdout pollution
 */
function createStderrLogger(): LoggerType {
    const winstonLogger = winston.createLogger({
        level:  process.env.LOG_LEVEL ?? 'info',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
        ),
        transports: [
            new winston.transports.Console({
                stderrLevels: ['error', 'warn', 'info', 'debug'], // ALL levels to stderr
            }),
        ],
    });

    // Wrap winston logger to match LoggerType interface
    return {
        debug(infoObjectOrMessage: Record<string, unknown> | string, messageOrMeta?: string, ...meta: unknown[]): LoggerType {
            if(isString(infoObjectOrMessage)) {
                winstonLogger.debug(infoObjectOrMessage, messageOrMeta, ...meta);
            } else {
                winstonLogger.debug(messageOrMeta ?? '', infoObjectOrMessage);
            }
            return this;
        },
        info(infoObjectOrMessage: Record<string, unknown> | string, messageOrMeta?: string, ...meta: unknown[]): LoggerType {
            if(isString(infoObjectOrMessage)) {
                winstonLogger.info(infoObjectOrMessage, messageOrMeta, ...meta);
            } else {
                winstonLogger.info(messageOrMeta ?? '', infoObjectOrMessage);
            }
            return this;
        },
        warn(infoObjectOrMessage: Record<string, unknown> | string, messageOrMeta?: string, ...meta: unknown[]): LoggerType {
            if(isString(infoObjectOrMessage)) {
                winstonLogger.warn(infoObjectOrMessage, messageOrMeta, ...meta);
            } else {
                winstonLogger.warn(messageOrMeta ?? '', infoObjectOrMessage);
            }
            return this;
        },
        error(infoObjectOrMessage: Record<string, unknown> | string, messageOrMeta?: string, ...meta: unknown[]): LoggerType {
            if(isString(infoObjectOrMessage)) {
                winstonLogger.error(infoObjectOrMessage, messageOrMeta, ...meta);
            } else {
                winstonLogger.error(messageOrMeta ?? '', infoObjectOrMessage);
            }
            return this;
        },
        log(level: string, infoObjectOrMessage: Record<string, unknown> | string, messageOrMeta?: string, ...meta: unknown[]): LoggerType {
            if(isString(infoObjectOrMessage)) {
                winstonLogger.log(level, infoObjectOrMessage, messageOrMeta, ...meta);
            } else {
                winstonLogger.log(level, messageOrMeta ?? '', infoObjectOrMessage);
            }
            return this;
        },
    };
}

// Singleton instances - created once at module load
const silentLogger: LoggerType = new SilentLogger();
const stderrLogger: LoggerType = createStderrLogger();

/**
 * Returns appropriate logger based on current environment
 * - In admin mode (ADMIN_MODE=true): SilentLogger (no output)
 * - In serve mode or debug mode: StderrLogger (winston to stderr)
 *
 * This function is called lazily on each log method invocation to ensure
 * it picks up environment variable changes made after module load.
 */
function getLogger(): LoggerType {
    // Check if we're in admin mode
    const isAdminMode = process.env.ADMIN_MODE === 'true';

    if(isAdminMode) {
        return silentLogger;
    }

    return stderrLogger;
}

/**
 * Create a lazy logger proxy that delegates to getLogger() on each method call
 * This ensures the logger selection happens at call time, not module load time
 */
function createLazyLogger(): LoggerType {
    const validMethods = ['debug', 'info', 'warn', 'error', 'log'];

    return new Proxy({} as LoggerType, {
        get(_target, prop: string | symbol) {
            if(isString(prop) && validMethods.includes(prop)) {
                return (...args: unknown[]): LoggerType => {
                    const logger = getLogger();
                    const method = logger[prop as keyof LoggerType] as (...args: unknown[]) => LoggerType;
                    return method.apply(logger, args);
                };
            }
            // Coverage: Returns undefined for non-logger properties accessed via proxy
            // Edge case for unexpected property access; all valid logger methods handled above
            return undefined;
        },
    });
}

// Silent logger for admin mode (deprecated - use dynamicLogger instead)
export const logger: LoggerType = new SilentLogger();

// Export the lazy logger as the primary export
// This is the recommended logger to use throughout the codebase
export const dynamicLogger: LoggerType = createLazyLogger();

// Stderr-only logger for MCP serve mode (deprecated - use dynamicLogger instead)
// Kept for backward compatibility but will always log to stderr
export { stderrLogger };
