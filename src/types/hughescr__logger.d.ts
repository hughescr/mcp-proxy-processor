/**
 * TypeScript declarations for @hughescr/logger
 *
 * This package uses winston logger under the hood
 */
declare module '@hughescr/logger' {
    export interface Logger {
        debug(infoObject: Record<string, unknown>, message?: string): Logger
        debug(message: string, ...meta: unknown[]): Logger
        info(infoObject: Record<string, unknown>, message?: string): Logger
        info(message: string, ...meta: unknown[]): Logger
        warn(infoObject: Record<string, unknown>, message?: string): Logger
        warn(message: string, ...meta: unknown[]): Logger
        error(infoObject: Record<string, unknown>, message?: string): Logger
        error(message: string, ...meta: unknown[]): Logger
        log(level: string, infoObject: Record<string, unknown>, message?: string): Logger
        log(level: string, message: string, ...meta: unknown[]): Logger
    }

    export const logger: Logger;
}
