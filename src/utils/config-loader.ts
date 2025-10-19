/**
 * Shared Configuration Loading Utility
 *
 * Provides generic config loading with:
 * - JSON parsing
 * - Zod schema validation
 * - Optional transformation (e.g., environment variable substitution)
 * - Consistent error handling
 */

import { readFile } from 'node:fs/promises';
import { access, constants } from 'node:fs/promises';
import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';
import _ from 'lodash';
import { dynamicLogger as logger } from './silent-logger.js';

/**
 * Options for loading JSON configuration
 */
export interface LoadJsonConfigOptions<T> {
    /** Path to the configuration file */
    path: string

    /** Zod schema for validation */
    schema: ZodSchema<T>

    /** Optional transformation function applied after parsing but before validation */
    transform?: (data: unknown) => unknown

    /** Whether to return a default value if the file doesn't exist */
    fallbackOnMissing?: boolean

    /** Default value to return if file is missing (only used if fallbackOnMissing is true) */
    defaultValue?: T

    /** Optional example file path to copy from if config doesn't exist */
    examplePath?: string
}

/**
 * Process and validate configuration data
 */
async function processConfigData<T>(
    data: unknown,
    schema: ZodSchema<T>,
    transform?: (data: unknown) => unknown
): Promise<T> {
    let processedData = data;
    if(transform) {
        processedData = transform(processedData);
    }
    return schema.parse(processedData);
}

/**
 * Handle missing configuration file
 */
async function handleMissingConfig<T>(
    path: string,
    examplePath?: string,
    fallbackOnMissing?: boolean,
    defaultValue?: T,
    schema?: ZodSchema<T>,
    transform?: (data: unknown) => unknown
): Promise<{ configExists: boolean, config?: T }> {
    // Try to copy from example file if provided
    if(examplePath) {
        try {
            await access(examplePath, constants.F_OK);
            logger.warn({ configPath: path, examplePath }, 'Config file not found, copying from example');
            const { writeFile } = await import('node:fs/promises');
            const exampleContent = await readFile(examplePath, 'utf-8');
            await writeFile(path, exampleContent, 'utf-8');
            return { configExists: true };
        } catch{
            // Example file doesn't exist, continue
        }
    }

    // Use fallback if configured
    if(fallbackOnMissing && defaultValue !== undefined && schema) {
        logger.debug({ path }, 'Config file not found, using default value');
        const config = await processConfigData(
            _.cloneDeep(defaultValue),
            schema,
            transform
        );
        return { configExists: false, config };
    }

    throw new Error(`Config file not found: ${path}`);
}

/**
 * Load and validate a JSON configuration file
 *
 * @template T - The type of the configuration object
 * @param options - Configuration loading options
 * @returns Validated configuration object
 * @throws Error if file doesn't exist (and no fallback), is invalid JSON, or fails validation
 *
 * @example
 * ```typescript
 * const config = await loadJsonConfig({
 *   path: '/path/to/config.json',
 *   schema: MyConfigSchema,
 *   fallbackOnMissing: true,
 *   defaultValue: { items: [] }
 * });
 * ```
 */
export async function loadJsonConfig<T>(options: LoadJsonConfigOptions<T>): Promise<T> {
    const { path, schema, transform, fallbackOnMissing = false, defaultValue, examplePath } = options;

    try {
        // Check if config file exists
        try {
            await access(path, constants.F_OK);
        } catch{
            // File doesn't exist, handle missing config
            const result = await handleMissingConfig(
                path,
                examplePath,
                fallbackOnMissing,
                defaultValue,
                schema,
                transform
            );
            if(result.config) {
                return result.config;
            }
            // If configExists is true, fall through to read the newly created file
        }

        // Read and parse JSON
        const content = await readFile(path, 'utf-8');
        let data: unknown;
        try {
            data = JSON.parse(content);
        } catch (error) {
            throw new Error(
                `Invalid JSON in config file ${path}: ${_.isError(error) ? error.message : String(error)}`
            );
        }

        // Process and validate
        return await processConfigData(data, schema, transform);
    } catch (error) {
        // Provide detailed error messages for Zod validation errors
        if(error instanceof ZodError) {
            const zodError = error;
            logger.error({ error: zodError.issues, configPath: path }, 'Invalid configuration file');
            const errorMessages = _.map(
                zodError.issues,
                (issue: { path: (string | number)[], message: string }) =>
                    `${_.join(issue.path, '.')}: ${issue.message}`
            );
            throw new Error(`Invalid configuration in ${path}: ${errorMessages.join(', ')}`);
        }

        // Re-throw other errors
        throw error;
    }
}
