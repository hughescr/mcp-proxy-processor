/**
 * Prompt Browser Screen Component
 * Browse backend prompts organized by server with fuzzy search and multi-select
 */

import React, { useMemo } from 'react';
import { Text } from 'ink';
import type { Prompt } from '@modelcontextprotocol/sdk/types.js';
import type { PromptRef } from '../../types/config.js';
import { useBackend } from '../BackendContext.js';
import { createBrowserScreen, type BrowserConfig } from './browser/index.js';
import { trim, replace, map } from 'lodash';

interface PromptBrowserScreenProps {
    onBack:           () => void
    onSubmit:         (prompts: PromptRef[]) => void
    existingPrompts?: PromptRef[] // Pre-selected prompts
}

interface PromptItem {
    serverName: string
    prompt:     Prompt
}

/**
 * Browse backend prompts with grouping, search, and multi-select
 */
export function PromptBrowserScreen({
    onBack,
    onSubmit,
    existingPrompts = [],
}: PromptBrowserScreenProps) {
    const { discoverAllPrompts } = useBackend();

    // Create browser configuration
    const config: BrowserConfig<PromptItem, PromptRef> = useMemo(() => ({
        fetchItems: async () => {
            const promptsMap = await discoverAllPrompts();
            // Convert Map<string, Prompt[]> to Map<string, PromptItem[]>
            const result = new Map<string, PromptItem[]>();
            for(const [serverName, prompts] of promptsMap.entries()) {
                result.set(
                    serverName,
                    map(prompts, prompt => ({ serverName, prompt }))
                );
            }
            return result;
        },

        title: ({ total, selected }) =>
            `Browse Backend Prompts (${total} total prompts, ${selected} selected)`,

        pluralLabel: 'prompts',

        emptyMessage: query =>
            (query
                ? `No prompts found matching "${query}"`
                : 'No prompts available from backend servers'),

        searchFields: [
            'prompt.name',
            'prompt.description',
            'serverName',
        ],

        getItemKey: item => item.prompt.name,

        getServerName: item => item.serverName,

        toRef: (serverName, item) => ({
            serverName,
            name: item.prompt.name,
        }),

        parseRef: ref => ({
            serverName: ref.serverName,
            key:        ref.name,
        }),

        renderItem: ({ item, isSelected, isHighlighted, terminalWidth }) => {
            const checkbox = isSelected ? '☑' : '☐';
            const indicator = isHighlighted ? '❯' : ' ';

            // Show prompt arguments if any
            const argCount = item.prompt.arguments?.length ?? 0;
            const argText = argCount > 0 ? ` (${argCount} args)` : '';

            // Truncate description to fit terminal
            const descText = item.prompt.description ?? 'No description';
            const cleanDesc = trim(replace(replace(descText, /[\r\n]+/g, ' '), /\s+/g, ' '));
            const maxDescLength = Math.max(30, terminalWidth - item.prompt.name.length - argText.length - 20);
            const truncatedDesc = cleanDesc.length > maxDescLength
                ? `${cleanDesc.slice(0, maxDescLength)}...`
                : cleanDesc;

            return (
                <Text color={isHighlighted ? 'cyan' : undefined}>
                    {indicator}
                    {' '}
                    {checkbox}
                    {' '}
                    <Text bold>{item.prompt.name}</Text>
                    {argCount > 0 && <Text color="yellow">{argText}</Text>}
                    {' - '}
                    {truncatedDesc}
                </Text>
            );
        },
    }), [discoverAllPrompts]);

    // Create the browser component with the config
    const BrowserComponent = useMemo(() => createBrowserScreen(config), [config]);

    return (
        <BrowserComponent
          onBack={onBack}
          onSubmit={onSubmit}
          existingRefs={existingPrompts}
        />
    );
}
