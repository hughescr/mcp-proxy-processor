/**
 * File system test helpers
 * Utilities for creating temporary files and directories for testing
 */

import { mkdir, rm, writeFile, access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import _ from 'lodash';

/**
 * Global cleanup registry for temporary paths created during tests
 */
const cleanupRegistry: string[] = [];

/**
 * Create a temporary directory with a unique name
 *
 * The directory will be automatically registered for cleanup.
 * Call `cleanup()` in your test's afterEach to remove all temp directories.
 *
 * @param prefix - Optional prefix for the directory name (default: 'mcp-proxy-test')
 * @returns Absolute path to the created directory
 *
 * @example
 * ```typescript
 * import { createTempDir, cleanup } from '../helpers/fs-utils.js';
 *
 * describe('My Tests', () => {
 *   let testDir: string;
 *
 *   beforeEach(async () => {
 *     testDir = await createTempDir('my-test');
 *   });
 *
 *   afterEach(async () => {
 *     await cleanup();
 *   });
 * });
 * ```
 */
export async function createTempDir(prefix = 'mcp-proxy-test'): Promise<string> {
    const uniqueSuffix = randomBytes(8).toString('hex');
    const dir = join(tmpdir(), `${prefix}-${uniqueSuffix}`);
    await mkdir(dir, { recursive: true });
    cleanupRegistry.push(dir);
    return dir;
}

/**
 * Create a temporary file with content
 *
 * The file's parent directory will be automatically registered for cleanup.
 * Call `cleanup()` in your test's afterEach to remove all temp files.
 *
 * @param content - File content (string or object to be JSON.stringified)
 * @param options - Optional filename and directory
 * @returns Absolute path to the created file
 *
 * @example
 * ```typescript
 * const configFile = await createTempFile(
 *   { groups: { test: { name: 'test', tools: [] } } },
 *   { filename: 'groups.json' }
 * );
 * ```
 */
export async function createTempFile(
    content: string | Record<string, unknown>,
    options: {
        filename?:  string
        directory?: string
    } = {}
): Promise<string> {
    const { filename = `test-${randomBytes(4).toString('hex')}.txt`, directory } = options;

    const dir = directory ?? await createTempDir('temp-file');
    const filePath = join(dir, filename);

    const fileContent = _.isString(content) ? content : JSON.stringify(content, null, 2);
    await writeFile(filePath, fileContent, 'utf-8');

    return filePath;
}

/**
 * Check if a file exists at the given path
 *
 * @param path - Path to check
 * @returns true if file exists, false otherwise
 *
 * @example
 * ```typescript
 * const exists = await fileExists('/path/to/file');
 * expect(exists).toBe(true);
 * ```
 */
export async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path, constants.F_OK);
        return true;
    } catch{
        return false;
    }
}

/**
 * Cleanup all temporary files and directories created during tests
 *
 * This should be called in afterEach() hooks to ensure proper cleanup.
 * All paths created via createTempDir() and createTempFile() will be removed.
 *
 * @example
 * ```typescript
 * afterEach(async () => {
 *   await cleanup();
 * });
 * ```
 */
export async function cleanup(): Promise<void> {
    await Promise.all(
        _.map(cleanupRegistry, async (path) => {
            try {
                await rm(path, { recursive: true, force: true });
            } catch{
                // Ignore cleanup errors
            }
        })
    );
    cleanupRegistry.length = 0;
}

/**
 * Manually register a path for cleanup
 *
 * Use this if you create files/directories manually but want them
 * cleaned up by the cleanup() function.
 *
 * @param path - Path to register for cleanup
 *
 * @example
 * ```typescript
 * const customDir = '/path/to/custom/dir';
 * await mkdir(customDir);
 * registerForCleanup(customDir);
 * ```
 */
export function registerForCleanup(path: string): void {
    cleanupRegistry.push(path);
}

/**
 * Clear the cleanup registry without removing files
 *
 * Use this if you want to prevent automatic cleanup for debugging purposes.
 *
 * @example
 * ```typescript
 * clearCleanupRegistry(); // Files will not be removed by cleanup()
 * ```
 */
export function clearCleanupRegistry(): void {
    cleanupRegistry.length = 0;
}

/**
 * Get all paths currently registered for cleanup
 *
 * Useful for debugging or validation.
 *
 * @returns Array of paths that will be cleaned up
 */
export function getCleanupRegistry(): readonly string[] {
    return [...cleanupRegistry];
}
