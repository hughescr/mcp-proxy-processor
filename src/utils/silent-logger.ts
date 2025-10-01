/**
 * Silent Logger - No-op logger for admin mode
 *
 * This module provides a silent logger that does nothing,
 * used to suppress all logging output in admin mode.
 */

import type { Logger } from '@hughescr/logger';

/**
 * Create a no-op logger that silently ignores all log calls
 */
function createSilentLogger(): Logger {
    const silentLogger: Logger = {
        debug: () => silentLogger,
        info:  () => silentLogger,
        warn:  () => silentLogger,
        error: () => silentLogger,
        log:   () => silentLogger,
    };

    return silentLogger;
}

export const logger = createSilentLogger();
