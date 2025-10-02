/**
 * Enhanced Tool Editor Component - Edit tool overrides with full context
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { EnhancedSelectInput } from 'ink-enhanced-select-input';
import TextInput from 'ink-text-input';
import { trim, repeat, isError, find, keys, map } from 'lodash';
import type { Tool } from '@modelcontextprotocol/sdk/types';
import type { ToolOverride, ArgumentMapping } from '../../types/config.js';
import { loadBackendServersConfig } from '../config-utils.js';
import { ClientManager } from '../../backend/client-manager.js';
import { DiscoveryService } from '../../backend/discovery.js';
import { MultiLineTextEditor } from './MultiLineTextEditor.js';
import { ParameterMappingEditor } from './ParameterMappingEditor.js';

interface EnhancedToolEditorProps {
    tool:      ToolOverride
    groupName: string
    onSave:    (tool: ToolOverride) => void
    onRemove?: () => void
    onCancel:  () => void
}

type EditMode = 'loading' | 'menu' | 'edit-name' | 'edit-description' | 'edit-argument-mapping';

const DESCRIPTION_GUIDANCE = `
✨ Writing Effective Tool Descriptions

Example:
"Searches the web using Tavily API. Accepts a query string and returns relevant results with URLs and snippets. Use for factual information and current events. Requires TAVILY_API_KEY."

Keep descriptions concise but informative (aim for 1-3 sentences):

✓ DO:
  • Start with what the tool does (action verb)
  • Specify key parameters and their purpose
  • Note important constraints or requirements
  • Mention when to use (or not use) this tool

✗ DON'T:
  • Repeat information from the tool name
  • Include implementation details
  • Use overly technical jargon
  • Make assumptions about context
`;

/**
 * Enhanced tool override editor with backend tool context
 */
export function EnhancedToolEditor({ tool, groupName, onSave, onRemove, onCancel }: EnhancedToolEditorProps) {
    const [mode, setMode] = useState<EditMode>('loading');
    const [currentTool, setCurrentTool] = useState<ToolOverride>(tool);
    const [backendTool, setBackendTool] = useState<Tool | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Handle Esc for navigation - only works in menu and loading modes
    // In edit modes, let the input components handle Esc themselves
    useInput((input, key) => {
        if(mode === 'menu') {
            if(key.escape || key.leftArrow) {
                onCancel();
            }
        } else if(mode === 'edit-name') {
            if(key.escape) {
                setMode('menu');
            }
        }
        // Note: edit-description mode is handled by the MultiLineTextEditor component
    });

    // Load backend tool information on mount
    useEffect(() => {
        void (async () => {
            try {
                const backendConfig = await loadBackendServersConfig();
                const serverConfigs = new Map(Object.entries(backendConfig.mcpServers));
                const clientManager = new ClientManager(serverConfigs);

                await clientManager.connectAll();

                const discoveryService = new DiscoveryService(clientManager);
                const toolsMap = await discoveryService.discoverAllTools();

                const serverTools = toolsMap.get(tool.serverName);
                const foundTool = find(serverTools, { name: tool.originalName });

                if(foundTool) {
                    setBackendTool(foundTool);
                    // Debug logging to see what we received
                    if(process.env.LOG_LEVEL !== 'silent') {
                        // eslint-disable-next-line no-console -- Debug logging for tool discovery
                        console.error(`[DEBUG] Found tool ${tool.originalName} from ${tool.serverName}:`, {
                            hasDescription: !!foundTool.description,
                            description:    foundTool.description,
                            hasInputSchema: !!foundTool.inputSchema,
                            inputSchema:    foundTool.inputSchema,
                        });
                    }
                } else if(process.env.LOG_LEVEL !== 'silent') {
                    // eslint-disable-next-line no-console -- Debug logging for tool discovery
                    console.error(`[DEBUG] Tool ${tool.originalName} not found in server ${tool.serverName}. Available tools:`, map(serverTools, 'name'));
                }

                await clientManager.disconnectAll();
                setMode('menu');
            } catch (err) {
                setError(isError(err) ? err.message : String(err));
                setMode('menu');
            }
        })();
    }, [tool.serverName, tool.originalName]);

    const handleMenuSelect = (item: { value: string }) => {
        switch(item.value) {
            case 'save':
                onSave(currentTool);
                break;
            case 'remove':
                if(onRemove) {
                    onRemove();
                }
                break;
            case 'cancel':
                onCancel();
                break;
            case 'edit-name':
                setInputValue(currentTool.name ?? currentTool.originalName);
                setMode('edit-name');
                break;
            case 'edit-description':
                setInputValue(currentTool.description ?? backendTool?.description ?? '');
                setMode('edit-description');
                break;
            case 'edit-argument-mapping':
                setMode('edit-argument-mapping');
                break;
            case 'clear-name':
                setCurrentTool({ ...currentTool, name: undefined });
                break;
            case 'clear-description':
                setCurrentTool({ ...currentTool, description: undefined });
                break;
            case 'clear-argument-mapping':
                setCurrentTool({ ...currentTool, argumentMapping: undefined });
                break;
            default:
                break;
        }
    };

    const handleNameSubmit = (value: string) => {
        setCurrentTool({ ...currentTool, name: trim(value) || undefined });
        setMode('menu');
    };

    const handleDescriptionSubmit = (value: string) => {
        setCurrentTool({ ...currentTool, description: trim(value) || undefined });
        setMode('menu');
    };

    const renderLoadingState = () => (
        <Box flexDirection="column" padding={1}>
            <Text bold color="cyan">
                Loading Tool Information...
            </Text>
        </Box>
    );

    // Loading state
    if(mode === 'loading') {
        return renderLoadingState();
    }

    const renderNameEditor = () => (
        <Box flexDirection="column" padding={1}>
            <Text bold color="cyan">
                Edit Tool Name
            </Text>
            <Box marginTop={1}>
                <Text dimColor>
                    Original:
                    {' '}
                    {currentTool.originalName}
                </Text>
            </Box>
            <Box marginTop={1}>
                <Text>Override: </Text>
                <TextInput
                  value={inputValue}
                  onChange={setInputValue}
                  onSubmit={handleNameSubmit}
                />
            </Box>
            <Text dimColor>Press Enter to save, Esc to cancel</Text>
        </Box>
    );

    // Name input
    if(mode === 'edit-name') {
        return renderNameEditor();
    }

    const renderDescriptionEditor = () => {
        const originalDesc = backendTool?.description ?? '(no description)';

        return (
            <Box flexDirection="column" padding={1}>
                <Box marginBottom={1}>
                    <Text bold color="cyan">
                        Edit Tool Description - Group:
                        {' '}
                        {groupName}
                        {' '}
                        | Tool:
                        {' '}
                        {currentTool.name ?? currentTool.originalName}
                    </Text>
                </Box>

                <Box flexDirection="row" gap={2}>
                    {/* Left side - Editor */}
                    <Box flexDirection="column" flexGrow={1} minWidth="50%">
                        <Text bold underline>
                            Edit Description:
                        </Text>
                        <Box marginTop={1}>
                            <MultiLineTextEditor
                              value={inputValue}
                              onSubmit={handleDescriptionSubmit}
                              onCancel={() => setMode('menu')}
                              showLineNumbers={false}
                            />
                        </Box>
                    </Box>

                    {/* Right side - Context */}
                    <Box flexDirection="column" flexGrow={1} minWidth="40%" borderStyle="single" paddingX={1}>
                        <Text bold underline>
                            Original Description:
                        </Text>
                        <Text wrap="wrap">
                            {originalDesc}
                        </Text>

                        {backendTool?.inputSchema && (
                            <>
                                <Box marginTop={1}>
                                    <Text bold underline>
                                        Input Schema:
                                    </Text>
                                </Box>
                                <Box height={10} flexDirection="column">
                                    <Text color="green">
                                        {JSON.stringify(backendTool.inputSchema, null, 2)}
                                    </Text>
                                </Box>
                            </>
                        )}

                        <Box marginTop={1}>
                            <Text color="yellow">
                                {DESCRIPTION_GUIDANCE}
                            </Text>
                        </Box>
                    </Box>
                </Box>
            </Box>
        );
    };

    // Description input with guidance
    if(mode === 'edit-description') {
        return renderDescriptionEditor();
    }

    // Argument mapping editor
    if(mode === 'edit-argument-mapping') {
        const handleMappingSave = (mapping: ArgumentMapping | undefined) => {
            setCurrentTool({ ...currentTool, argumentMapping: mapping });
            setMode('menu');
        };

        return (
            <ParameterMappingEditor
              mapping={currentTool.argumentMapping}
              clientSchema={currentTool.inputSchema}
              backendSchema={backendTool?.inputSchema}
              onSave={handleMappingSave}
              onCancel={() => setMode('menu')}
            />
        );
    }

    const buildMenuItems = () => {
        const effectiveName = currentTool.name ?? currentTool.originalName;
        const effectiveDescription = currentTool.description ?? backendTool?.description ?? '(no description)';

        const menuItems: { label: string, value: string, disabled?: boolean }[] = [];

        // Add info items as regular text (not disabled menu items)
        // These will be rendered but the first selectable item will get focus

        const descPreview = effectiveDescription.length > 80
            ? effectiveDescription.slice(0, 80) + '...'
            : effectiveDescription;

        menuItems.push(
            {
                label: `Tool Name: ${effectiveName}${currentTool.name ? ' (overridden)' : ''}`,
                value: 'edit-name',
            }
        );

        if(currentTool.name) {
            menuItems.push({ label: '  ✕ Clear Name Override', value: 'clear-name' });
        }

        menuItems.push({
            label: `Description: ${descPreview}${currentTool.description ? ' (overridden)' : ''}`,
            value: 'edit-description',
        });

        if(currentTool.description) {
            menuItems.push({ label: '  ✕ Clear Description Override', value: 'clear-description' });
        }

        // Argument mapping status
        let mappingStatus = '(none)';
        if(currentTool.argumentMapping) {
            if(currentTool.argumentMapping.type === 'template') {
                const paramCount = keys(currentTool.argumentMapping.mappings).length;
                mappingStatus = `Template (${paramCount} params)`;
            } else {
                mappingStatus = 'JSONata';
            }
        }
        menuItems.push({
            label: `Argument Mapping: ${mappingStatus}`,
            value: 'edit-argument-mapping',
        });

        if(currentTool.argumentMapping) {
            menuItems.push({ label: '  ✕ Clear Argument Mapping', value: 'clear-argument-mapping' });
        }

        menuItems.push(
            { label: repeat('─', 60), value: 'sep2', disabled: true },
            { label: '💾 Save Tool', value: 'save' }
        );

        if(onRemove) {
            menuItems.push({ label: '🗑️  Remove from Group', value: 'remove' });
        }

        menuItems.push({ label: '← Cancel', value: 'cancel' });

        return menuItems;
    };

    // Build menu items
    const menuItems = buildMenuItems();
    const effectiveName = currentTool.name ?? currentTool.originalName;

    const infoSection = (
        <Box flexDirection="column" marginBottom={1}>
            <Text>
                📦 Group:
                {' '}
                <Text bold color="cyan">{groupName}</Text>
            </Text>
            <Text>
                🔧 Backend Server:
                {' '}
                <Text bold color="yellow">{currentTool.serverName}</Text>
            </Text>
            <Text>
                📝 Original Tool Name:
                {' '}
                <Text bold color="green">{currentTool.originalName}</Text>
            </Text>
            {backendTool?.inputSchema && (
                <Box flexDirection="column" marginTop={1}>
                    <Text bold>
                        📋 Input Schema:
                    </Text>
                    <Box marginLeft={2}>
                        <Text dimColor>
                            {JSON.stringify(backendTool.inputSchema, null, 2)}
                        </Text>
                    </Box>
                </Box>
            )}
            {error && (
                <Text color="red">
                    ⚠️  Error loading backend tool:
                    {' '}
                    {error}
                </Text>
            )}
            <Text dimColor>{repeat('─', 60)}</Text>
        </Box>
    );

    return (
        <Box flexDirection="column" padding={1}>
            <Box marginBottom={1}>
                <Text bold color="cyan">
                    Edit Tool:
                    {' '}
                    {effectiveName}
                </Text>
            </Box>
            {infoSection}
            <EnhancedSelectInput items={menuItems} onSelect={handleMenuSelect} />
        </Box>
    );
}
