/**
 * Schema Generator - Generates client input schemas from parameter mappings
 *
 * This module is responsible for:
 * - Generating the inputSchema that agents see based on argument mappings
 * - Hiding constant parameters from agent view
 * - Making parameters with defaults optional
 * - Applying name/description overrides to parameters
 */

import { dynamicLogger as logger } from '../utils/silent-logger.js';
import { cloneDeep, isObject, isArray, keys } from 'lodash';
import type { TemplateMapping, ParameterMapping } from '../types/config.js';

/**
 * JSON Schema property definition
 */
interface JsonSchemaProperty {
    type?:         string | string[]
    description?:  string
    [key: string]: unknown
}

/**
 * JSON Schema object definition
 */
interface JsonSchema {
    type:          'object'
    properties?:   Record<string, JsonSchemaProperty>
    required?:     string[]
    [key: string]: unknown
}

/**
 * Service for generating client-facing input schemas from parameter mappings
 */
export class SchemaGenerator {
    /**
     * Generate a client input schema from a backend schema and argument mapping
     *
     * @param backendSchema - The original schema from the backend tool
     * @param argumentMapping - The template mapping configuration
     * @returns The schema that should be presented to agents
     */
    generateClientSchema(
        backendSchema: Record<string, unknown> | undefined,
        argumentMapping: TemplateMapping
    ): Record<string, unknown> {
        // If no backend schema, return a basic object schema
        if(!backendSchema || !isObject(backendSchema) || isArray(backendSchema)) {
            logger.debug('No valid backend schema provided, generating minimal schema');
            return { type: 'object', properties: {}, required: [] };
        }

        const schema = backendSchema as JsonSchema;
        const clientSchema = this.initializeClientSchema(schema);
        const backendProperties = (schema.properties ?? {});
        const backendRequired = (schema.required ?? []);

        // Process mapped parameters
        this.processMappedParameters(
            argumentMapping,
            backendProperties,
            backendRequired,
            clientSchema
        );

        // Include unmapped backend parameters (passthrough by default)
        this.processUnmappedParameters(
            argumentMapping,
            backendProperties,
            backendRequired,
            clientSchema
        );

        logger.debug(
            {
                backendParamCount: keys(backendProperties).length,
                clientParamCount:  keys(clientSchema.properties!).length,
                hiddenParamCount:  keys(backendProperties).length - keys(clientSchema.properties!).length,
            },
            'Generated client schema from argument mapping'
        );

        return clientSchema;
    }

    /**
     * Initialize client schema with base properties from backend schema
     */
    private initializeClientSchema(schema: JsonSchema): JsonSchema {
        const clientSchema: JsonSchema = {
            type:       'object',
            properties: {},
            required:   [],
        };

        // Copy over non-property/required fields from backend schema
        for(const [key, value] of Object.entries(schema)) {
            if(key !== 'properties' && key !== 'required') {
                clientSchema[key] = value;
            }
        }

        return clientSchema;
    }

    /**
     * Process parameters that have explicit mappings
     */
    private processMappedParameters(
        argumentMapping: TemplateMapping,
        backendProperties: Record<string, JsonSchemaProperty>,
        backendRequired: string[],
        clientSchema: JsonSchema
    ): void {
        for(const [backendParam, mapping] of Object.entries(argumentMapping.mappings)) {
            const backendProperty = backendProperties[backendParam];

            if(!backendProperty) {
                // Backend parameter doesn't exist in schema, skip it

                logger.warn(
                    { backendParam, mapping },
                    'Parameter mapping references non-existent backend parameter'
                );
                continue;
            }

            const clientParam = this.getClientParameterInfo(backendParam, mapping, backendProperty);

            if(!clientParam) {
                // Parameter should be hidden (constant or omit)
                continue;
            }

            // Add to client schema
            clientSchema.properties![clientParam.name] = clientParam.property;

            // Handle required status
            const isRequired = this.isParameterRequired(backendParam, mapping, backendRequired);
            if(isRequired) {
                clientSchema.required!.push(clientParam.name);
            }
        }
    }

    /**
     * Process parameters that don't have explicit mappings (passthrough by default)
     */
    private processUnmappedParameters(
        argumentMapping: TemplateMapping,
        backendProperties: Record<string, JsonSchemaProperty>,
        backendRequired: string[],
        clientSchema: JsonSchema
    ): void {
        for(const [backendParam, backendProperty] of Object.entries(backendProperties)) {
            if(!argumentMapping.mappings[backendParam]) {
                // Parameter not in mapping, include as-is
                clientSchema.properties![backendParam] = cloneDeep(backendProperty);

                if(backendRequired.includes(backendParam)) {
                    clientSchema.required!.push(backendParam);
                }
            }
        }
    }

    /**
     * Get client parameter information (name and property definition)
     * Returns null if parameter should be hidden
     */
    private getClientParameterInfo(
        backendParam: string,
        mapping: ParameterMapping,
        backendProperty: JsonSchemaProperty
    ): { name: string, property: JsonSchemaProperty } | null {
        switch(mapping.type) {
            case 'constant':
            case 'omit':
                // These parameters are hidden from agents
                return null;

            case 'passthrough':
            case 'rename':
            case 'default':
            {
                // Determine the client parameter name
                const clientName = mapping.name ?? mapping.source;

                // Clone the backend property
                const clientProperty = cloneDeep(backendProperty);

                // Apply description override if provided
                if(mapping.description) {
                    clientProperty.description = mapping.description;
                }

                return { name: clientName, property: clientProperty };
            }

            default:
                // TypeScript should prevent this

                logger.error(
                    { mapping },
                    `Unknown parameter mapping type: ${(mapping as { type: string }).type}`
                );
                return null;
        }
    }

    /**
     * Determine if a parameter should be required in the client schema
     * Note: This is only called for parameters that are visible in the client schema
     * (constant and omit are filtered out before this method is called)
     */
    private isParameterRequired(
        backendParam: string,
        mapping: ParameterMapping,
        backendRequired: string[]
    ): boolean {
        // Parameters with defaults are optional
        if(mapping.type === 'default') {
            return false;
        }

        // Passthrough and rename preserve required status from backend
        if(mapping.type === 'passthrough' || mapping.type === 'rename') {
            return backendRequired.includes(backendParam);
        }

        // All other types are optional by default
        return false;
    }
}
