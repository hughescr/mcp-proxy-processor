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
import { dynamicLogger as logger } from '../utils/silent-logger.js';
import _ from 'lodash';
import { deduplicatePrompts, deduplicateResources, deduplicateTools } from '../utils/conflict-detection.js';
import type { Tool, Resource, Prompt } from '@modelcontextprotocol/sdk/types.js';
import { GroupsConfigSchema, type GroupConfig, type GroupsConfig, type ToolOverride } from '../types/config.js';
import { SchemaGenerator } from './schema-generator.js';

/**
 * Manages group configurations and applies overrides to backend tools/resources
 */
export class GroupManager {
    private groupsConfig:    GroupsConfig;
    private schemaGenerator: SchemaGenerator;

    /**
     * Create a new GroupManager
     * @param configPath - Path to the groups.json configuration file
     */
    constructor(private configPath: string) {
        this.groupsConfig = { groups: {} };
        this.schemaGenerator = new SchemaGenerator();
    }

    /**
     * Load and validate the groups configuration from disk
     * @throws Error if configuration is invalid or cannot be read
     */
    async load(): Promise<void> {
        try {
            const content = await readFile(this.configPath, 'utf-8');
            const rawConfig: unknown = JSON.parse(content);
            const result = GroupsConfigSchema.safeParse(rawConfig);
            if(!result.success) {
                const errorMessages = _(result.error.issues)
                    .map(issue => `${_.join(issue.path, '.')}: ${issue.message}`)
                    .join(', ');
                throw new Error(`Invalid configuration: ${errorMessages}`);
            }
            this.groupsConfig = result.data;
            logger.info({ groupCount: _.keys(this.groupsConfig.groups).length, path: this.configPath }, 'Loaded groups configuration');
        } catch (error) {
            logger.error({ error, path: this.configPath }, 'Failed to load groups configuration');
            throw new Error(`Failed to load groups configuration from ${this.configPath}: ${_.isError(error) ? error.message : String(error)}`);
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

        const toolServers = _.map(group.tools ?? [], 'serverName');
        const resourceServers = _.map(group.resources ?? [], 'serverName');
        const promptServers = _.map(group.prompts ?? [], 'serverName');
        const allServers = [...toolServers, ...resourceServers, ...promptServers];

        return _.uniq(allServers);
    }

    /**
     * Get a list of groups by names
     * @param names - Array of group names to retrieve
     * @returns Array of group configurations (skips groups that don't exist)
     */
    getGroups(names: string[]): GroupConfig[] {
        const groups: GroupConfig[] = [];
        for(const name of names) {
            const group = this.getGroup(name);
            if(group) {
                groups.push(group);
            } else {
                logger.warn({ groupName: name }, 'Group not found');
            }
        }
        return groups;
    }

    /**
     * Get the list of backend server names required for multiple groups
     * @param groupNames - Array of group names
     * @returns Array of unique backend server names
     */
    getRequiredServersForGroups(groupNames: string[]): string[] {
        const allServers: string[] = [];
        for(const groupName of groupNames) {
            const servers = this.getRequiredServers(groupName);
            allServers.push(...servers);
        }
        return _.uniq(allServers);
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

            const backendTool = _.find(serverTools, { name: toolOverride.originalName });
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

        // ResourceRef uses simple inclusion - no overrides applied
        for(const resourceRef of resources) {
            const serverResources = backendResources.get(resourceRef.serverName);
            if(!serverResources) {
                logger.warn({ serverName: resourceRef.serverName, groupName }, 'Backend server resources not found');
                continue;
            }

            const backendResource = _.find(serverResources, { uri: resourceRef.uri });
            if(!backendResource) {
                logger.warn({ resourceUri: resourceRef.uri, serverName: resourceRef.serverName, groupName }, 'Backend resource not found');
                continue;
            }

            // No overrides - use resource as-is from backend
            result.push(backendResource);
        }

        // Deduplicate resources by URI (first occurrence wins)
        const deduplicated = deduplicateResources(result);

        logger.debug({ groupName, resourceCount: deduplicated.length }, 'Built resources for group');
        return deduplicated;
    }

    /**
     * Get prompts for a group
     * @param groupName - The name of the group
     * @param backendPrompts - Map of backend server name to list of prompts from that server
     * @returns Array of prompts, or empty array if group not found
     */
    getPromptsForGroup(groupName: string, backendPrompts: Map<string, Prompt[]>): Prompt[] {
        const group = this.getGroup(groupName);
        if(!group) {
            logger.warn({ groupName }, 'Group not found');
            return [];
        }

        const result: Prompt[] = [];
        const prompts = group.prompts ?? [];

        // PromptRef uses simple inclusion - no overrides applied
        for(const promptRef of prompts) {
            const serverPrompts = backendPrompts.get(promptRef.serverName);
            if(!serverPrompts) {
                logger.warn({ serverName: promptRef.serverName, groupName }, 'Backend server prompts not found');
                continue;
            }

            const backendPrompt = _.find(serverPrompts, { name: promptRef.name });
            if(!backendPrompt) {
                logger.warn({ promptName: promptRef.name, serverName: promptRef.serverName, groupName }, 'Backend prompt not found');
                continue;
            }

            // No overrides - use prompt as-is from backend
            result.push(backendPrompt);
        }
        // Deduplicate prompts by name (first occurrence wins)
        const deduplicated = deduplicatePrompts(result);

        logger.debug({ groupName, promptCount: deduplicated.length }, 'Built prompts for group');
        return deduplicated;
    }

    /**
     * Get tools for multiple groups with overrides applied
     * Tools from earlier groups in the array take priority over later groups.
     * @param groupNames - Array of group names
     * @param backendTools - Map of backend server name to list of tools from that server
     * @returns Array of tools with overrides applied, deduplicated by name
     */
    getToolsForGroups(groupNames: string[], backendTools: Map<string, Tool[]>): Tool[] {
        const allTools: Tool[] = [];

        for(const groupName of groupNames) {
            const groupTools = this.getToolsForGroup(groupName, backendTools);
            allTools.push(...groupTools);
        }

        // Deduplicate by name - first occurrence wins (highest priority)
        const deduplicated = deduplicateTools(allTools);

        logger.debug({ groupNames, toolCount: deduplicated.length }, 'Built tools for multiple groups');
        return deduplicated;
    }

    /**
     * Get resources for multiple groups with overrides applied
     * Resources from earlier groups in the array take priority over later groups.
     * @param groupNames - Array of group names
     * @param backendResources - Map of backend server name to list of resources from that server
     * @returns Array of resources with overrides applied, deduplicated by URI
     */
    getResourcesForGroups(groupNames: string[], backendResources: Map<string, Resource[]>): Resource[] {
        const allResources: Resource[] = [];

        for(const groupName of groupNames) {
            const groupResources = this.getResourcesForGroup(groupName, backendResources);
            allResources.push(...groupResources);
        }

        // Deduplicate by URI - first occurrence wins (highest priority)
        const deduplicated = deduplicateResources(allResources);

        logger.debug({ groupNames, resourceCount: deduplicated.length }, 'Built resources for multiple groups');
        return deduplicated;
    }

    /**
     * Get prompts for multiple groups
     * Prompts from earlier groups in the array take priority over later groups.
     * @param groupNames - Array of group names
     * @param backendPrompts - Map of backend server name to list of prompts from that server
     * @returns Array of prompts, deduplicated by name
     */
    getPromptsForGroups(groupNames: string[], backendPrompts: Map<string, Prompt[]>): Prompt[] {
        const allPrompts: Prompt[] = [];

        for(const groupName of groupNames) {
            const groupPrompts = this.getPromptsForGroup(groupName, backendPrompts);
            allPrompts.push(...groupPrompts);
        }

        // Deduplicate by name - first occurrence wins (highest priority)
        const deduplicated = deduplicatePrompts(allPrompts);

        logger.debug({ groupNames, promptCount: deduplicated.length }, 'Built prompts for multiple groups');
        return deduplicated;
    }

    /**
     * Apply overrides to a backend tool
     * @param backendTool - The original tool from the backend server
     * @param override - The override configuration
     * @returns A new tool with overrides applied
     */
    private applyToolOverrides(backendTool: Tool, override: ToolOverride): Tool {
        // Determine the input schema to use
        let inputSchema: { type: 'object', properties?: Record<string, unknown>, required?: string[] } & Record<string, unknown>;

        if(override.argumentMapping?.type === 'template') {
            // Generate schema from argument mapping
            const generated = this.schemaGenerator.generateClientSchema(
                backendTool.inputSchema,
                override.argumentMapping
            );
            inputSchema = { type: 'object' as const, ...generated };
        } else if(override.inputSchema) {
            // Use explicit override
            inputSchema = { type: 'object' as const, ...override.inputSchema };
        } else {
            // Use backend schema as-is (ensure it has the required type)
            inputSchema = backendTool.inputSchema as { type: 'object', properties?: Record<string, unknown>, required?: string[] } & Record<string, unknown>;
        }

        return {
            name:        override.name ?? backendTool.name,
            description: override.description ?? backendTool.description,
            inputSchema,
        };
    }

    /**
     * Get all group names
     * @returns Array of all group names
     */
    getAllGroupNames(): string[] {
        return _.keys(this.groupsConfig.groups);
    }
}
