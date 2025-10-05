/**
 * Parameter Analysis Utilities
 * Shared logic for analyzing parameter transformations from backend to client schemas
 */

import { isArray as _isArray, truncate, isString } from 'lodash';
import type { ArgumentMapping, TemplateMapping } from '../../types/config.js';

export interface ParameterInfo {
    backendName:     string
    clientName:      string | null
    backendType:     string
    clientType:      string | null
    backendRequired: boolean
    clientRequired:  boolean
    backendDesc:     string
    clientDesc:      string | null
    mappingType:     string
    mappingDetails:  string
    isHidden:        boolean
}

/**
 * Extract type from JSON Schema property
 */
function extractType(property: Record<string, unknown> | undefined): string {
    if(!property) {
        return 'unknown';
    }
    const type = property.type;
    if(isString(type)) {
        return type;
    }
    if(_isArray(type)) {
        return type.join('|');
    }
    return 'unknown';
}

/**
 * Extract description from JSON Schema property
 */
function extractDescription(property: Record<string, unknown> | undefined): string {
    if(!property?.description) {
        return '';
    }
    const desc = property.description;
    return isString(desc) ? desc : JSON.stringify(desc);
}

/**
 * Get mapping type display name
 */
function getMappingTypeName(mapping: TemplateMapping, backendParam: string): string {
    const paramMapping = mapping.mappings[backendParam];
    if(!paramMapping) {
        return 'Passthrough';
    }
    switch(paramMapping.type) {
        case 'passthrough':
            return 'Passthrough';
        case 'constant':
            return 'Constant';
        case 'default':
            return 'Default';
        case 'rename':
            return 'Rename';
        case 'omit':
            return 'Omit';
    }
}

/**
 * Get mapping details for display
 */
function getMappingDetails(mapping: TemplateMapping, backendParam: string): string {
    const paramMapping = mapping.mappings[backendParam];
    if(!paramMapping) {
        return 'No changes';
    }
    switch(paramMapping.type) {
        case 'passthrough':
            if(paramMapping.name && paramMapping.name !== backendParam) {
                return `Renamed to "${paramMapping.name}"`;
            }
            return 'No changes';
        case 'constant':
            return `Value: ${truncate(JSON.stringify(paramMapping.value), { length: 30 })}`;
        case 'default':
            if(paramMapping.name && paramMapping.name !== backendParam) {
                return `Default: ${truncate(JSON.stringify(paramMapping.default), { length: 20 })}, Renamed`;
            }
            return `Default: ${truncate(JSON.stringify(paramMapping.default), { length: 30 })}`;
        case 'rename':
            return `Renamed to "${paramMapping.name ?? backendParam}"`;
        case 'omit':
            return 'Not visible to agent';
    }
}

/**
 * Get client parameter name from mapping
 */
function getClientParamName(mapping: TemplateMapping, backendParam: string): string | null {
    const paramMapping = mapping.mappings[backendParam];
    if(!paramMapping) {
        return backendParam; // Passthrough by default
    }
    switch(paramMapping.type) {
        case 'passthrough':
        case 'default':
        case 'rename':
            return paramMapping.name ?? paramMapping.source;
        case 'constant':
        case 'omit':
            return null; // Hidden from client
    }
}

/**
 * Check if parameter is hidden from client
 */
function isParameterHidden(mapping: TemplateMapping, backendParam: string): boolean {
    const paramMapping = mapping.mappings[backendParam];
    if(!paramMapping) {
        return false; // Passthrough by default
    }
    return paramMapping.type === 'constant' || paramMapping.type === 'omit';
}

/**
 * Analyze parameter transformations
 */
export function analyzeParameters(
    backendSchema: Record<string, unknown> | undefined,
    clientSchema: Record<string, unknown>,
    argumentMapping?: ArgumentMapping
): ParameterInfo[] {
    if(!backendSchema?.properties) {
        return [];
    }

    if(argumentMapping?.type === 'jsonata') {
        return []; // JSONata doesn't have per-parameter mappings
    }

    // If no mapping, create an empty template mapping so all params show as passthrough
    const mapping: TemplateMapping = argumentMapping?.type === 'template'
        ? argumentMapping
        : { type: 'template', mappings: {} };

    const backendProps = backendSchema.properties as Record<string, Record<string, unknown>>;
    const backendRequired = (backendSchema.required ?? []) as string[];
    const clientProps = (clientSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const clientRequired = (clientSchema.required ?? []) as string[];

    const params: ParameterInfo[] = [];

    for(const [backendName, backendProp] of Object.entries(backendProps)) {
        const clientName = getClientParamName(mapping, backendName);
        const isHidden = isParameterHidden(mapping, backendName);
        const clientProp = clientName ? clientProps[clientName] : undefined;

        params.push({
            backendName,
            clientName,
            backendType:     extractType(backendProp),
            clientType:      clientName ? extractType(clientProp) : null,
            backendRequired: backendRequired.includes(backendName),
            clientRequired:  clientName ? clientRequired.includes(clientName) : false,
            backendDesc:     extractDescription(backendProp),
            clientDesc:      clientName ? extractDescription(clientProp) : null,
            mappingType:     getMappingTypeName(mapping, backendName),
            mappingDetails:  getMappingDetails(mapping, backendName),
            isHidden,
        });
    }

    return params;
}
