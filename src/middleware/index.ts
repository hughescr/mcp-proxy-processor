/**
 * Middleware - Group Mapping and Tool Override Logic
 *
 * This module is responsible for:
 * - Loading group configurations
 * - Mapping backend tools/resources to groups
 * - Applying overrides (name, description, schema changes)
 * - Determining which backend servers are needed for a group
 */

import { readFile } from 'node:fs/promises';
import { logger } from '@hughescr/logger';
import { uniq, keys, isError, map, find, isArray } from 'lodash';
import { GroupsConfigSchema, type GroupConfig, type GroupsConfig, type ToolOverride, type ResourceOverride } from '../types/config.js';
import type { Tool, Resource } from '@modelcontextprotocol/sdk/types';

/**
 * Manages group configurations and applies overrides to backend tools/resources
 */
export class GroupManager {
    private groupsConfig: GroupsConfig;

    /**
     * Create a new GroupManager
     * @param configPath - Path to the groups.json configuration file
     */
    constructor(private configPath: string) {
        this.groupsConfig = { groups: {} };
    }

    /**
     * Load and validate the groups configuration from disk
     * @throws Error if configuration is invalid or cannot be read
     */
    async load(): Promise<void> {
        try {
            const content = await readFile(this.configPath, 'utf-8');
            const rawConfig: unknown = JSON.parse(content);
            this.groupsConfig = GroupsConfigSchema.parse(rawConfig);
            logger.info({ groupCount: keys(this.groupsConfig.groups).length, path: this.configPath }, 'Loaded groups configuration');
        } catch (error) {
            logger.error({ error, path: this.configPath }, 'Failed to load groups configuration');
            throw new Error(`Failed to load groups configuration from ${this.configPath}: ${isError(error) ? error.message : String(error)}`);
        }
    }

    /**
     * Get a group configuration by name
     * @param name - The name of the group to retrieve
     * @returns The group configuration, or undefined if not found
     */
    getGroup(name: string): GroupConfig | undefined {
        return this.groupsConfig.groups[name];
    }

    /**
     * Get the list of backend server names required for a group
     * @param groupName - The name of the group
     * @returns Array of unique backend server names, or empty array if group not found
     */
    getRequiredServers(groupName: string): string[] {
        const group = this.getGroup(groupName);
        if(!group) {
            logger.warn({ groupName }, 'Group not found');
            return [];
        }

        const toolServers = map(group.tools, 'serverName');
        const resourceServers = map(group.resources ?? [], 'serverName');
        const allServers = [...toolServers, ...resourceServers];

        return uniq(allServers);
    }

    /**
     * Get tools for a group with overrides applied
     * @param groupName - The name of the group
     * @param backendTools - Map of backend server name to list of tools from that server
     * @returns Array of tools with overrides applied, or empty array if group not found
     */
    getToolsForGroup(groupName: string, backendTools: Map<string, Tool[]>): Tool[] {
        const group = this.getGroup(groupName);
        if(!group) {
            logger.warn({ groupName }, 'Group not found');
            return [];
        }

        const result: Tool[] = [];

        for(const toolOverride of group.tools) {
            const serverTools = backendTools.get(toolOverride.serverName);
            if(!serverTools) {
                logger.warn({ serverName: toolOverride.serverName, groupName }, 'Backend server tools not found');
                continue;
            }

            const backendTool = find(serverTools, { name: toolOverride.originalName });
            if(!backendTool) {
                logger.warn({ toolName: toolOverride.originalName, serverName: toolOverride.serverName, groupName }, 'Backend tool not found');
                continue;
            }

            // Apply overrides
            const finalTool = this.applyToolOverrides(backendTool, toolOverride);
            result.push(finalTool);
        }

        logger.debug({ groupName, toolCount: result.length }, 'Built tools for group');
        return result;
    }

    /**
     * Get resources for a group with overrides applied
     * @param groupName - The name of the group
     * @param backendResources - Map of backend server name to list of resources from that server
     * @returns Array of resources with overrides applied, or empty array if group not found
     */
    getResourcesForGroup(groupName: string, backendResources: Map<string, Resource[]>): Resource[] {
        const group = this.getGroup(groupName);
        if(!group) {
            logger.warn({ groupName }, 'Group not found');
            return [];
        }

        const result: Resource[] = [];
        const resources = group.resources ?? [];

        for(const resourceOverride of resources) {
            const serverResources = backendResources.get(resourceOverride.serverName);
            if(!serverResources) {
                logger.warn({ serverName: resourceOverride.serverName, groupName }, 'Backend server resources not found');
                continue;
            }

            const backendResource = find(serverResources, { uri: resourceOverride.originalUri });
            if(!backendResource) {
                logger.warn({ resourceUri: resourceOverride.originalUri, serverName: resourceOverride.serverName, groupName }, 'Backend resource not found');
                continue;
            }

            // Apply overrides
            const finalResource = this.applyResourceOverrides(backendResource, resourceOverride);
            result.push(finalResource);
        }

        logger.debug({ groupName, resourceCount: result.length }, 'Built resources for group');
        return result;
    }

    /**
     * Apply overrides to a backend tool
     * @param backendTool - The original tool from the backend server
     * @param override - The override configuration
     * @returns A new tool with overrides applied
     */
    private applyToolOverrides(backendTool: Tool, override: ToolOverride): Tool {
        return {
            name:        override.name ?? backendTool.name,
            description: override.description ?? backendTool.description,
            inputSchema: override.inputSchema
                ? {
                    type:       'object' as const,
                    properties: override.inputSchema,
                    ...(override.inputSchema.required && isArray(override.inputSchema.required) ? { required: override.inputSchema.required as string[] } : {}),
                }
                : backendTool.inputSchema,
        };
    }

    /**
     * Apply overrides to a backend resource
     * @param backendResource - The original resource from the backend server
     * @param override - The override configuration
     * @returns A new resource with overrides applied
     */
    private applyResourceOverrides(backendResource: Resource, override: ResourceOverride): Resource {
        return {
            uri:         backendResource.uri,
            name:        override.name ?? backendResource.name,
            description: override.description ?? backendResource.description,
            mimeType:    override.mimeType ?? backendResource.mimeType,
        };
    }

    /**
     * Get all group names
     * @returns Array of all group names
     */
    getAllGroupNames(): string[] {
        return keys(this.groupsConfig.groups);
    }
}
