/**
 * Schema Transformation Viewer - Shows how parameter mappings transform backend schema to client schema
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { SelectInput } from './SelectInput.js';
import { repeat, isArray as _isArray, truncate, isString, filter as _filter, map as _map, padEnd } from 'lodash';
import type { ArgumentMapping, TemplateMapping } from '../../types/config.js';
import { SchemaGenerator } from '../../middleware/schema-generator.js';

interface SchemaTransformationViewerProps {
    /** Backend input schema */
    backendSchema:    Record<string, unknown> | undefined
    /** Argument mapping configuration */
    argumentMapping?: ArgumentMapping
    /** Tool name for display */
    toolName:         string
    /** Called when user closes the viewer (optional for compact mode) */
    onClose?:         () => void
    /** Compact mode for inline display (no navigation, just table) */
    compact?:         boolean
}

type ViewMode = 'overview' | 'detail' | 'full-json';

interface ParameterInfo {
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
function analyzeParameters(
    backendSchema: Record<string, unknown> | undefined,
    clientSchema: Record<string, unknown>,
    argumentMapping: TemplateMapping
): ParameterInfo[] {
    if(!backendSchema?.properties) {
        return [];
    }

    const backendProps = backendSchema.properties as Record<string, Record<string, unknown>>;
    const backendRequired = (backendSchema.required ?? []) as string[];
    const clientProps = (clientSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const clientRequired = (clientSchema.required ?? []) as string[];

    const params: ParameterInfo[] = [];

    for(const [backendName, backendProp] of Object.entries(backendProps)) {
        const clientName = getClientParamName(argumentMapping, backendName);
        const isHidden = isParameterHidden(argumentMapping, backendName);
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
            mappingType:     getMappingTypeName(argumentMapping, backendName),
            mappingDetails:  getMappingDetails(argumentMapping, backendName),
            isHidden,
        });
    }

    return params;
}

/**
 * Schema Transformation Viewer Component
 */
export function SchemaTransformationViewer({
    backendSchema,
    argumentMapping,
    toolName,
    onClose,
    compact = false,
}: SchemaTransformationViewerProps) {
    const [mode, setMode] = useState<ViewMode>('overview');
    const [selectedParamIndex, setSelectedParamIndex] = useState(0);

    const schemaGenerator = useMemo(() => new SchemaGenerator(), []);

    // Generate client schema using SchemaGenerator
    const clientSchema = useMemo(() => {
        if(!argumentMapping) {
            return backendSchema ?? {};
        }
        if(argumentMapping.type === 'jsonata') {
            // For JSONata, we can't generate a schema - show backend schema as-is
            return backendSchema ?? {};
        }
        return schemaGenerator.generateClientSchema(backendSchema, argumentMapping);
    }, [backendSchema, argumentMapping, schemaGenerator]);

    // Analyze parameters
    const parameters = useMemo(() => {
        if(argumentMapping?.type === 'jsonata') {
            return [];
        }
        // If no mapping, create an empty template mapping so all params show as passthrough
        const mapping: TemplateMapping = argumentMapping?.type === 'template'
            ? argumentMapping
            : { type: 'template', mappings: {} };
        return analyzeParameters(backendSchema, clientSchema, mapping);
    }, [backendSchema, clientSchema, argumentMapping]);

    // Handle keyboard navigation (disabled in compact mode)
    useInput((input, key) => {
        if(compact) {
            return; // No navigation in compact mode
        }
        if(key.escape) {
            if(mode === 'detail' || mode === 'full-json') {
                setMode('overview');
            } else if(onClose) {
                onClose();
            }
        } else if(input === 'v' || input === 'V') {
            if(mode === 'overview') {
                setMode('full-json');
            } else if(mode === 'full-json') {
                setMode('overview');
            }
        } else if(key.upArrow && mode === 'detail') {
            // IMPORTANT: Use functional setState for rapid input support
            setSelectedParamIndex(prevIndex => Math.max(0, prevIndex - 1));
        } else if(key.downArrow && mode === 'detail') {
            // IMPORTANT: Use functional setState for rapid input support
            setSelectedParamIndex(prevIndex => Math.min(parameters.length - 1, prevIndex + 1));
        }
    });

    const renderJsonataOverview = () => {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="cyan">
                    Schema Transformation -
                    {' '}
                    {toolName}
                </Text>
                <Box marginTop={1} marginBottom={1}>
                    <Text bold color="yellow">
                        JSONata Expression Mapping
                    </Text>
                </Box>
                <Box marginBottom={1} borderStyle="single" paddingX={1} flexDirection="column">
                    <Text bold>Expression:</Text>
                    <Text color="green">
                        {argumentMapping?.type === 'jsonata' ? argumentMapping.expression : ''}
                    </Text>
                </Box>
                <Box marginTop={1} marginBottom={1}>
                    <Text>
                        JSONata expressions perform complex transformations that restructure the
                        entire argument object. The backend schema shows the input, and the expression
                        defines how it's transformed before being sent to the backend server.
                    </Text>
                </Box>
                <Box marginTop={1}>
                    <Text dimColor>
                        Press V to view full schemas | Esc to close
                    </Text>
                </Box>
            </Box>
        );
    };

    const renderOverview = () => {
        if(argumentMapping?.type === 'jsonata') {
            return renderJsonataOverview();
        }

        const totalBackend = parameters.length;
        const totalClient = _filter(parameters, p => !p.isHidden).length;
        const totalHidden = totalBackend - totalClient;

        const menuItems = _map(parameters, (param, index) => {
            return {
                label: `${padEnd(param.backendName, 15)} → ${padEnd(param.clientName ?? '(hidden)', 15)} | ${padEnd(param.mappingType, 12)} | ${param.mappingDetails}`,
                value: String(index),
            };
        });

        menuItems.push(
            { label: repeat('─', 80), value: 'sep', disabled: true } as { label: string, value: string, disabled?: boolean },
            { label: '← Back', value: 'back' }
        );

        const handleSelect = (item: { value: string }) => {
            if(item.value === 'back') {
                onClose?.();
            } else {
                const index = parseInt(item.value, 10);
                setSelectedParamIndex(index);
                setMode('detail');
            }
        };

        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="cyan">
                    Schema Transformation -
                    {' '}
                    {toolName}
                </Text>
                <Box marginTop={1} marginBottom={1}>
                    <Text>
                        Backend:
                        {' '}
                        <Text bold>{totalBackend}</Text>
                        {' '}
                        parameters → Client:
                        {' '}
                        <Text bold>{totalClient}</Text>
                        {' '}
                        parameters
                        {totalHidden > 0 && (
                            <>
                                {' '}
                                (
                                <Text color="red">
{totalHidden}
{' '}
hidden
                                </Text>
                                )
                            </>
                        )}
                    </Text>
                </Box>
                <Box marginBottom={1} borderStyle="single" paddingX={1}>
                    <Box flexDirection="column">
                        <Box>
                            <Text bold>
                                {padEnd('Backend Param', 16)}
                                {padEnd('Client Param', 17)}
                                {padEnd('Mapping', 13)}
                                Details
                            </Text>
                        </Box>
                        <Text>{repeat('─', 80)}</Text>
                    </Box>
                </Box>
                <SelectInput items={menuItems} onSelect={handleSelect} />
                <Box marginTop={1}>
                    <Text dimColor>
                        Enter: View Details | V: Full JSON | Esc: Close
                    </Text>
                </Box>
            </Box>
        );
    };

    const renderDetail = () => {
        const param = parameters[selectedParamIndex];
        if(!param) {
            return null;
        }

        const backendProp = (backendSchema?.properties as Record<string, Record<string, unknown>> | undefined)?.[param.backendName];
        const clientProp = param.clientName
            ? (clientSchema.properties as Record<string, Record<string, unknown>> | undefined)?.[param.clientName]
            : undefined;

        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="cyan">
                    Parameter Detail:
                    {' '}
                    {param.backendName}
                    {' '}
                    →
                    {' '}
                    {param.clientName ?? '(hidden)'}
                </Text>
                <Box marginTop={1} flexDirection="row" gap={2}>
                    {/* Backend Schema */}
                    <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
                        <Text bold underline color="yellow">
                            BACKEND SCHEMA
                        </Text>
                        <Box marginTop={1} flexDirection="column">
                            <Text>
                                Parameter:
                                {' '}
                                <Text bold>{param.backendName}</Text>
                            </Text>
                            <Text>
                                Type:
                                {' '}
                                <Text bold>{param.backendType}</Text>
                            </Text>
                            <Text>
                                Required:
                                {' '}
                                <Text bold>{param.backendRequired ? '✓' : '✗'}</Text>
                            </Text>
                            {param.backendDesc && (
                                <Box marginTop={1} flexDirection="column">
                                    <Text bold>Description:</Text>
                                    <Text wrap="wrap">{param.backendDesc}</Text>
                                </Box>
                            )}
                        </Box>
                    </Box>

                    {/* Client Schema */}
                    <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
                        <Text bold underline color="green">
                            CLIENT SCHEMA
                        </Text>
                        {param.isHidden
                            ? (
                                <Box marginTop={1} flexDirection="column">
                                    <Text color="red" bold>
                                        (not visible to agent)
                                    </Text>
                                    <Box marginTop={1}>
                                        <Text wrap="wrap">
                                            This parameter is filled automatically by the proxy and
                                            is not exposed to the agent.
                                        </Text>
                                    </Box>
                                </Box>
                            )
                            : (
                                <Box marginTop={1} flexDirection="column">
                                    <Text>
                                        Parameter:
                                        {' '}
                                        <Text bold>{param.clientName}</Text>
                                    </Text>
                                    <Text>
                                        Type:
                                        {' '}
                                        <Text bold>{param.clientType}</Text>
                                    </Text>
                                    <Text>
                                        Required:
                                        {' '}
                                        <Text bold>{param.clientRequired ? '✓' : '✗'}</Text>
                                    </Text>
                                    {param.clientDesc && (
                                        <Box marginTop={1} flexDirection="column">
                                            <Text bold>Description:</Text>
                                            <Text wrap="wrap">{param.clientDesc}</Text>
                                        </Box>
                                    )}
                                </Box>
                            )}
                    </Box>
                </Box>

                {/* Mapping Details */}
                <Box marginTop={1} borderStyle="single" paddingX={1} flexDirection="column">
                    <Text bold color="cyan">
                        🔀 Mapping Details
                    </Text>
                    <Box marginTop={1}>
                        <Text>
                            Type:
                            {' '}
                            <Text bold>{param.mappingType}</Text>
                        </Text>
                    </Box>
                    <Box>
                        <Text>
                            Effect:
                            {' '}
                            {param.mappingDetails}
                        </Text>
                    </Box>
                </Box>

                {/* Full JSON schemas */}
                <Box marginTop={1} flexDirection="row" gap={2}>
                    <Box flexDirection="column" flexGrow={1}>
                        <Text bold dimColor>
                            Backend JSON Schema:
                        </Text>
                        <Box borderStyle="single" paddingX={1}>
                            <Text color="yellow">
                                {JSON.stringify(backendProp, null, 2)}
                            </Text>
                        </Box>
                    </Box>
                    {!param.isHidden && (
                        <Box flexDirection="column" flexGrow={1}>
                            <Text bold dimColor>
                                Client JSON Schema:
                            </Text>
                            <Box borderStyle="single" paddingX={1}>
                                <Text color="green">
                                    {JSON.stringify(clientProp, null, 2)}
                                </Text>
                            </Box>
                        </Box>
                    )}
                </Box>

                <Box marginTop={1}>
                    <Text dimColor>
                        ↑/↓: Other params (
                        {selectedParamIndex + 1}
                        /
                        {parameters.length}
                        ) | Esc: Overview
                    </Text>
                </Box>
            </Box>
        );
    };

    const renderFullJson = () => {
        return (
            <Box flexDirection="column" padding={1}>
                <Text bold color="cyan">
                    Full Schema View -
                    {' '}
                    {toolName}
                </Text>
                <Box marginTop={1} flexDirection="row" gap={2}>
                    <Box flexDirection="column" flexGrow={1}>
                        <Text bold underline color="yellow">
                            BACKEND SCHEMA (Full JSON)
                        </Text>
                        <Box marginTop={1} borderStyle="single" paddingX={1}>
                            <Text color="yellow">
                                {JSON.stringify(backendSchema, null, 2)}
                            </Text>
                        </Box>
                    </Box>
                    <Box flexDirection="column" flexGrow={1}>
                        <Text bold underline color="green">
                            CLIENT SCHEMA (Full JSON)
                        </Text>
                        <Box marginTop={1} borderStyle="single" paddingX={1}>
                            <Text color="green">
                                {JSON.stringify(clientSchema, null, 2)}
                            </Text>
                        </Box>
                    </Box>
                </Box>
                {argumentMapping?.type === 'jsonata' && (
                    <Box marginTop={1} borderStyle="single" paddingX={1} flexDirection="column">
                        <Text bold color="cyan">
                            JSONata Expression
                        </Text>
                        <Text color="green">
                            {argumentMapping.expression}
                        </Text>
                    </Box>
                )}
                <Box marginTop={1}>
                    <Text dimColor>
                        Press V to return to overview | Esc to close
                    </Text>
                </Box>
            </Box>
        );
    };

    // Compact inline rendering (just the table, no navigation)
    const renderCompact = () => {
        if(!argumentMapping) {
            return null; // No mapping to show
        }

        if(argumentMapping.type === 'jsonata') {
            return (
                <Box flexDirection="column" marginTop={1}>
                    <Text bold color="yellow">JSONata Expression:</Text>
                    <Box borderStyle="single" paddingX={1} marginTop={1}>
                        <Text color="green">{argumentMapping.expression}</Text>
                    </Box>
                </Box>
            );
        }

        const totalBackend = parameters.length;
        const totalClient = _filter(parameters, p => !p.isHidden).length;
        const totalHidden = totalBackend - totalClient;

        return (
            <Box flexDirection="column" marginTop={1}>
                <Text>
                    Argument Mapping:
                    {' '}
                    <Text bold>{totalBackend}</Text>
                    {' '}
                    backend →
                    {' '}
                    <Text bold>{totalClient}</Text>
                    {' '}
                    client
                    {totalHidden > 0 && (
                        <>
                            {' '}
                            (
                            <Text color="red">
                                {totalHidden}
                                {' '}
                                hidden
                            </Text>
                            )
                        </>
                    )}
                </Text>
                <Box marginTop={1} borderStyle="single" paddingX={1}>
                    <Box flexDirection="column">
                        <Box>
                            <Text bold>
                                {padEnd('Backend', 16)}
                                {padEnd('Client', 17)}
                                {padEnd('Type', 13)}
                                Details
                            </Text>
                        </Box>
                        <Text>{repeat('─', 80)}</Text>
                        {_map(parameters, param => (
                            <Box key={param.backendName}>
                                <Text>
                                    {padEnd(param.backendName, 16)}
                                    {padEnd(param.clientName ?? '(hidden)', 17)}
                                    {padEnd(param.mappingType, 13)}
                                    {param.mappingDetails}
                                </Text>
                            </Box>
                        ))}
                    </Box>
                </Box>
            </Box>
        );
    };

    // Render based on mode
    if(compact) {
        return renderCompact();
    }
    if(mode === 'detail') {
        return renderDetail();
    }
    if(mode === 'full-json') {
        return renderFullJson();
    }
    return renderOverview();
}
