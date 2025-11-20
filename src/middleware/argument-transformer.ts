/**
 * Argument Transformer - Transforms client arguments to backend arguments
 *
 * Supports two transformation modes:
 * 1. Template-based: Declarative parameter mappings (passthrough, constant, default, rename)
 * 2. JSONata: Expression-based transformations for complex cases
 */

import jsonata from 'jsonata';
import { dynamicLogger as logger } from '../utils/silent-logger.js';
import { isError, has, isObject, isArray, trim } from 'lodash';
import type {
    ArgumentMapping,
    TemplateMapping,
    JsonataMapping,
    ParameterMapping
} from '../types/config.js';

/**
 * Service for transforming tool call arguments from client to backend format
 */
export class ArgumentTransformer {
    /**
     * Transform client arguments to backend arguments using the specified mapping
     *
     * @param clientArgs - Arguments from the MCP client
     * @param mapping - Argument mapping configuration
     * @returns Transformed arguments ready for backend server
     * @throws Error if transformation fails
     */
    async transform(clientArgs: unknown, mapping: ArgumentMapping): Promise<Record<string, unknown>> {
        try {
            if(mapping.type === 'template') {
                return this.transformTemplate(clientArgs, mapping);
            } else if(mapping.type === 'jsonata') {
                return await this.transformJsonata(clientArgs, mapping);
            }

            // TypeScript should ensure we never get here, but just in case
            throw new Error(`Unknown mapping type: ${(mapping as { type: string }).type}`);
        } catch (error) {
            logger.error({ error, mapping }, 'Argument transformation failed');
            throw new Error(
                `Argument transformation failed: ${isError(error) ? error.message : String(error)}`
            );
        }
    }

    /**
     * Transform arguments using template-based parameter mappings
     *
     * Default behavior: All client parameters pass through unchanged unless explicitly mapped.
     * Mappings can override, rename, add constants, or omit parameters.
     */
    private transformTemplate(
        clientArgs: unknown,
        mapping: TemplateMapping
    ): Record<string, unknown> {
        // Ensure clientArgs is an object
        const args = (clientArgs && isObject(clientArgs) && !isArray(clientArgs))
            ? clientArgs as Record<string, unknown>
            : {};

        // Start with all client args (passthrough by default)
        const result: Record<string, unknown> = { ...args };

        // Track which source parameters have been consumed (for rename/default)
        const consumedSources = new Set<string>();

        // Apply each backend parameter mapping
        for(const [backendParam, paramMapping] of Object.entries(mapping.mappings)) {
            this.applyMapping(args, result, backendParam, paramMapping, consumedSources);
        }

        // Remove consumed source parameters (from rename/passthrough/default operations)
        for(const source of consumedSources) {
            delete result[source];
        }

        logger.debug({ clientArgs, backendArgs: result, mapping }, 'Template transformation completed');
        return result;
    }

    /**
     * Apply a single parameter mapping to the result object
     */
    private applyMapping(
        args: Record<string, unknown>,
        result: Record<string, unknown>,
        backendParam: string,
        paramMapping: ParameterMapping,
        consumedSources: Set<string>
    ): void {
        switch(paramMapping.type) {
            case 'passthrough':
                // Explicitly keep client param (already in result, but mark as consumed)
                if(has(args, paramMapping.source)) {
                    result[backendParam] = args[paramMapping.source];
                    if(backendParam !== paramMapping.source) {
                        consumedSources.add(paramMapping.source);
                    }
                }
                break;

            case 'rename':
                // Copy from source to new name, remove original
                if(has(args, paramMapping.source)) {
                    result[backendParam] = args[paramMapping.source];
                    consumedSources.add(paramMapping.source);
                }
                break;

            case 'constant':
                // Always use constant value (overrides any client input)
                result[backendParam] = paramMapping.value;
                break;

            case 'default':
                // Use client value if present, otherwise use default
                if(has(args, paramMapping.source)) {
                    result[backendParam] = args[paramMapping.source];
                    if(backendParam !== paramMapping.source) {
                        consumedSources.add(paramMapping.source);
                    }
                } else {
                    result[backendParam] = paramMapping.default;
                }
                break;

            case 'omit':
                // Remove parameter from backend args
                delete result[backendParam];
                break;

            default:
                // TypeScript should prevent this
                throw new Error(`Unknown parameter mapping type: ${(paramMapping as { type: string }).type}`);
        }
    }

    /**
     * Transform arguments using JSONata expression
     */
    private async transformJsonata(
        clientArgs: unknown,
        mapping: JsonataMapping
    ): Promise<Record<string, unknown>> {
        try {
            // Compile the JSONata expression
            const expression = jsonata(mapping.expression);

            // Evaluate the expression with client args as context (this returns a Promise)
            const result: unknown = await expression.evaluate(clientArgs);

            // Ensure result is an object
            if(!result || !isObject(result) || isArray(result)) {
                throw new Error(
                    `JSONata expression must return an object, got: ${typeof result}`
                );
            }

            logger.debug(
                { clientArgs, backendArgs: result, expression: mapping.expression },
                'JSONata transformation completed'
            );

            return result as Record<string, unknown>;
        } catch (error) {
            logger.error(
                { error, expression: mapping.expression, clientArgs },
                'JSONata transformation failed'
            );
            throw new Error(
                `JSONata transformation failed: ${isError(error) ? error.message : String(error)}`
            );
        }
    }

    /**
     * Validate that a mapping configuration is syntactically correct
     * Does not guarantee semantic correctness (e.g., that it produces valid backend args)
     *
     * @param mapping - Argument mapping to validate
     * @returns Validation result with any errors
     */
    validate(mapping: ArgumentMapping): { valid: boolean, errors: string[] } {
        const errors: string[] = [];

        try {
            if(mapping.type === 'jsonata') {
                // Try to compile the JSONata expression
                jsonata(mapping.expression);
            } else if(mapping.type === 'template') {
                // Validate template mappings
                for(const [backendParam, paramMapping] of Object.entries(mapping.mappings)) {
                    if(!backendParam || trim(backendParam) === '') {
                        errors.push('Backend parameter name cannot be empty');
                    }

                    if(paramMapping.type === 'passthrough' || paramMapping.type === 'rename' || paramMapping.type === 'default') {
                        if(!paramMapping.source || trim(paramMapping.source) === '') {
                            errors.push(`Source parameter name cannot be empty for ${backendParam}`);
                        }
                    }
                }
            }
        } catch (error) {
            errors.push(isError(error) ? error.message : String(error));
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }

    /**
     * Test a mapping with sample input to see what output it produces
     * Useful for UI preview and debugging
     *
     * @param sampleInput - Sample client arguments
     * @param mapping - Argument mapping to test
     * @returns Transformed arguments or error
     */
    async test(
        sampleInput: unknown,
        mapping: ArgumentMapping
    ): Promise<{ success: true, output: Record<string, unknown> } | { success: false, error: string }> {
        try {
            const output = await this.transform(sampleInput, mapping);
            return { success: true, output };
        } catch (error) {
            return {
                success: false,
                error:   isError(error) ? error.message : String(error),
            };
        }
    }
}
