/**
 * Grouped Multi-Select Tool Browser Component
 * Browse backend tools organized by server with fuzzy search and multi-select
 */

import React, { useMemo } from 'react';
import { Text } from 'ink';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolOverride } from '../../types/config.js';
import { useBackend } from '../BackendContext.js';
import { createBrowserScreen, type BrowserConfig } from './browser/index.js';
import { trim, replace, map, chain } from 'lodash';

interface GroupedMultiSelectToolBrowserProps {
    onBack:         () => void
    onSubmit:       (tools: ToolOverride[]) => void
    existingTools?: ToolOverride[] // Pre-selected tools
}

interface ToolItem {
    serverName: string
    tool:       Tool
}

/**
 * Browse backend tools with grouping, search, and multi-select
 */
export function GroupedMultiSelectToolBrowser({
    onBack,
    onSubmit,
    existingTools = [],
}: GroupedMultiSelectToolBrowserProps) {
    const { discoverAllTools } = useBackend();

    // Create browser configuration
    const config: BrowserConfig<ToolItem, ToolOverride> = useMemo(() => ({
        fetchItems: async () => {
            const toolsMap = await discoverAllTools();
            // Convert Map<string, Tool[]> to Map<string, ToolItem[]>
            const result = new Map<string, ToolItem[]>();
            for(const [serverName, tools] of toolsMap.entries()) {
                result.set(
                    serverName,
                    map(tools, tool => ({ serverName, tool }))
                );
            }
            return result;
        },

        title: ({ total, selected }) =>
            `Browse Backend Tools (${total} total tools, ${selected} selected)`,

        pluralLabel: 'tools',

        emptyMessage: query =>
            (query
                ? `No tools found matching "${query}"`
                : 'No tools available from backend servers'),

        searchFields: [
            'tool.name',
            'tool.description',
            'serverName',
        ],

        getItemKey: item => item.tool.name,

        getServerName: item => item.serverName,

        toRef: (serverName, item) => ({
            serverName,
            originalName: item.tool.name,
            name:         item.tool.name, // Override name defaults to original
            description:  item.tool.description,
            inputSchema:  item.tool.inputSchema,
        }),

        parseRef: ref => ({
            serverName: ref.serverName,
            key:        ref.originalName,
        }),

        renderItem: ({ item, isSelected, isHighlighted, terminalWidth }) => {
            const checkbox = isSelected ? '☑' : '☐';
            const indicator = isHighlighted ? '❯' : ' ';

            // Show input schema parameter count
            const paramCount = item.tool.inputSchema
                ? chain((item.tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {})
                    .keys()
                    .size()
                    .value()
                : 0;
            const schemaInfo = paramCount > 0 ? ` (${paramCount} params)` : ' (no params)';

            // Truncate description to fit terminal
            const descText = item.tool.description ?? 'No description';
            const cleanDesc = trim(replace(replace(descText, /[\r\n]+/g, ' '), /\s+/g, ' '));
            const maxDescLength = Math.max(30, terminalWidth - item.tool.name.length - schemaInfo.length - 20);
            const truncatedDesc = cleanDesc.length > maxDescLength
                ? `${cleanDesc.slice(0, maxDescLength)}...`
                : cleanDesc;

            return (
                <Text color={isHighlighted ? 'cyan' : undefined}>
                    {indicator}
                    {' '}
                    {checkbox}
                    {' '}
                    <Text bold>{item.tool.name}</Text>
                    <Text color="yellow">{schemaInfo}</Text>
                    {' - '}
                    {truncatedDesc}
                </Text>
            );
        },
    }), [discoverAllTools]);

    // Create the browser component with the config
    const BrowserComponent = useMemo(() => createBrowserScreen(config), [config]);

    return (
        <BrowserComponent
          onBack={onBack}
          onSubmit={onSubmit}
          existingRefs={existingTools}
        />
    );
}
