/**
 * Resource Browser Screen Component
 * Browse backend resources organized by server with fuzzy search and multi-select
 */

import React, { useMemo } from 'react';
import { Text } from 'ink';
import type { Resource } from '@modelcontextprotocol/sdk/types.js';
import type { ResourceRef } from '../../types/config.js';
import { useBackend } from '../BackendContext.js';
import { createBrowserScreen, type BrowserConfig } from './browser/index.js';
import { trim, replace, map } from 'lodash';

interface ResourceBrowserScreenProps {
    onBack:             () => void
    onSubmit:           (resources: ResourceRef[]) => void
    existingResources?: ResourceRef[] // Pre-selected resources
}

interface ResourceItem {
    serverName: string
    resource:   Resource
}

/**
 * Browse backend resources with grouping, search, and multi-select
 */
export function ResourceBrowserScreen({
    onBack,
    onSubmit,
    existingResources = [],
}: ResourceBrowserScreenProps) {
    const { discoverAllResources } = useBackend();

    // Create browser configuration
    const config: BrowserConfig<ResourceItem, ResourceRef> = useMemo(() => ({
        fetchItems: async () => {
            const resourcesMap = await discoverAllResources();
            // Convert Map<string, Resource[]> to Map<string, ResourceItem[]>
            const result = new Map<string, ResourceItem[]>();
            for(const [serverName, resources] of resourcesMap.entries()) {
                result.set(
                    serverName,
                    map(resources, resource => ({ serverName, resource }))
                );
            }
            return result;
        },

        title: ({ total, selected }) =>
            `Browse Backend Resources (${total} total resources, ${selected} selected)`,

        pluralLabel: 'resources',

        emptyMessage: query =>
            (query
                ? `No resources found matching "${query}"`
                : 'No resources available from backend servers'),

        searchFields: [
            'resource.uri',
            'resource.name',
            'resource.description',
            'resource.mimeType',
            'serverName',
        ],

        getItemKey: item => item.resource.uri,

        getServerName: item => item.serverName,

        toRef: (serverName, item) => ({
            serverName,
            uri: item.resource.uri,
        }),

        parseRef: ref => ({
            serverName: ref.serverName,
            key:        ref.uri,
        }),

        renderItem: ({ item, isSelected, isHighlighted, terminalWidth }) => {
            const checkbox = isSelected ? '☑' : '☐';
            const indicator = isHighlighted ? '❯' : ' ';
            const hasTemplate = item.resource.uri.includes('{');

            // Format URI (may be template with {variables})
            const uriDisplay = item.resource.uri;

            // Truncate description to fit terminal
            const descText = item.resource.description ?? item.resource.name ?? 'No description';
            const cleanDesc = trim(replace(replace(descText, /[\r\n]+/g, ' '), /\s+/g, ' '));
            const maxDescLength = Math.max(30, terminalWidth - uriDisplay.length - 20);
            const truncatedDesc = cleanDesc.length > maxDescLength
                ? `${cleanDesc.slice(0, maxDescLength)}...`
                : cleanDesc;

            return (
                <Text color={isHighlighted ? 'cyan' : undefined}>
                    {indicator}
                    {' '}
                    {checkbox}
                    {' '}
                    <Text bold>{uriDisplay}</Text>
                    {hasTemplate && <Text color="yellow"> (template)</Text>}
                    {' - '}
                    {truncatedDesc}
                </Text>
            );
        },
    }), [discoverAllResources]);

    // Create the browser component with the config
    const BrowserComponent = useMemo(() => createBrowserScreen(config), [config]);

    return (
        <BrowserComponent
          onBack={onBack}
          onSubmit={onSubmit}
          existingRefs={existingResources}
        />
    );
}
