/**
 * Unified Conflict Detection and Resource/Prompt Utilities
 *
 * This module consolidates all conflict detection, matching, and deduplication
 * logic for resources and prompts in the MCP Proxy Processor.
 *
 * Features:
 * - Conflict detection for resources (exact duplicates, template overlaps, etc.)
 * - Conflict detection for prompts (duplicate names)
 * - Resource/prompt matching for incoming requests
 * - Deduplication by URI/name with priority preservation
 *
 * @module conflict-detection
 */

import _ from 'lodash';
import type { Resource, Prompt, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ResourceRef, PromptRef, ResourceConflict, PromptConflict } from '../types/config.js';
import { isUriTemplate, matchesTemplate, templatesCanOverlap, generateExampleUri } from '../middleware/uri-matcher.js';

// ============================================================================
// Resource Conflict Detection
// ============================================================================

/**
 * Detect conflicts in resource references
 *
 * Resources can conflict in several ways:
 * - Exact duplicate: Two resources with identical URIs
 * - Template covers exact: A template pattern matches an exact URI
 * - Template overlap: Two templates could match the same URIs
 *
 * @param resources - Array of resource references in priority order
 * @returns Array of conflicts found (empty if no conflicts)
 */
export function detectResourceConflicts(resources: ResourceRef[]): ResourceConflict[] {
    const conflicts: ResourceConflict[] = [];

    // Compare each pair of resources
    for(let i = 0; i < resources.length; i++) {
        for(let j = i + 1; j < resources.length; j++) {
            const resource1 = resources[i];
            const resource2 = resources[j];

            if(!resource1 || !resource2) {
                continue;
            }

            const conflict = detectResourcePairConflict(resource1, resource2, i, j);
            if(conflict) {
                conflicts.push(conflict);
            }
        }
    }

    return conflicts;
}

/**
 * Detect conflict between a pair of resources
 * @internal
 */
function detectResourcePairConflict(
    resource1: ResourceRef,
    resource2: ResourceRef,
    index1: number,
    index2: number
): ResourceConflict | null {
    const uri1 = resource1.uri;
    const uri2 = resource2.uri;

    const isTemplate1 = isUriTemplate(uri1);
    const isTemplate2 = isUriTemplate(uri2);

    // Case 1: Both are exact URIs - check for duplicates
    if(!isTemplate1 && !isTemplate2) {
        if(uri1 === uri2) {
            return {
                type:       'exact-duplicate',
                resources:  [resource1, resource2],
                exampleUri: uri1,
                priority:   [index1, index2],
            };
        }
        return null;
    }

    // Case 2: One is template, one is exact - check if template covers exact
    if(isTemplate1 && !isTemplate2) {
        const match = matchesTemplate(uri2, uri1);
        if(match.matches) {
            return {
                type:       'template-covers-exact',
                resources:  [resource1, resource2],
                exampleUri: uri2,
                priority:   [index1, index2],
            };
        }
        return null;
    }

    if(!isTemplate1 && isTemplate2) {
        const match = matchesTemplate(uri1, uri2);
        if(match.matches) {
            return {
                type:       'exact-covered-by-template',
                resources:  [resource1, resource2],
                exampleUri: uri1,
                priority:   [index1, index2],
            };
        }
        return null;
    }

    // Case 3: Both are templates - check for overlap
    if(isTemplate1 && isTemplate2) {
        if(templatesCanOverlap(uri1, uri2)) {
            // Generate an example URI that both templates could match
            const exampleUri = generateExampleUri(uri1);
            return {
                type:      'template-overlap',
                resources: [resource1, resource2],
                exampleUri,
                priority:  [index1, index2],
            };
        }
        return null;
    }

    // Coverage: Final return when no conflicts detected (templates don't overlap)
    // All conflict cases handled above; this is the "no conflict" path
    return null;
}

// ============================================================================
// Prompt Conflict Detection
// ============================================================================

/**
 * Detect conflicts in prompt references
 *
 * Prompts conflict when they have the same name, since prompt names
 * must be unique within a group.
 *
 * @param prompts - Array of prompt references in priority order
 * @returns Array of conflicts found (empty if no conflicts)
 */
export function detectPromptConflicts(prompts: PromptRef[]): PromptConflict[] {
    const conflicts: PromptConflict[] = [];

    // Group prompts by name to find duplicates
    const promptsByName = _.groupBy(prompts, 'name');

    // Check each group for conflicts
    _.forEach(promptsByName, (group, _name) => {
        if(group.length > 1) {
            // Multiple prompts with same name - create conflicts for each pair
            for(let i = 0; i < group.length; i++) {
                for(let j = i + 1; j < group.length; j++) {
                    const prompt1 = group[i];
                    const prompt2 = group[j];

                    if(!prompt1 || !prompt2) {
                        continue;
                    }

                    // Find original indices in the array
                    const index1 = _.findIndex(prompts, p => p === prompt1);
                    const index2 = _.findIndex(prompts, p => p === prompt2);

                    if(index1 !== -1 && index2 !== -1) {
                        conflicts.push({
                            prompts:  [prompt1, prompt2],
                            priority: [index1, index2],
                        });
                    }
                }
            }
        }
    });

    return conflicts;
}

// ============================================================================
// Resource/Prompt Matching for Incoming Requests
// ============================================================================

/**
 * Find all resource references that match a given URI, in priority order
 *
 * This is used at runtime to find which backend servers can handle
 * a resource read request for a specific URI.
 *
 * @param uri - The URI to match against
 * @param resourceRefs - Array of resource references in priority order
 * @returns Array of matching resource references in priority order
 */
export function findMatchingResourceRefs(uri: string, resourceRefs: ResourceRef[]): ResourceRef[] {
    const matches: ResourceRef[] = [];

    for(const ref of resourceRefs) {
        const match = matchesTemplate(uri, ref.uri);
        if(match.matches) {
            matches.push(ref);
        }
    }

    return matches;
}

/**
 * Find all prompt references that match a given name, in priority order
 *
 * This is used at runtime to find which backend servers can handle
 * a prompt get request for a specific prompt name.
 *
 * @param name - The prompt name to match
 * @param promptRefs - Array of prompt references in priority order
 * @returns Array of matching prompt references in priority order
 */
export function findMatchingPromptRefs(name: string, promptRefs: PromptRef[]): PromptRef[] {
    return _.filter(promptRefs, { name });
}

// ============================================================================
// Deduplication for List Operations
// ============================================================================

/**
 * Deduplicate resources by URI
 *
 * Keeps first occurrence (highest priority) when duplicates are found.
 * This is used when generating the resources/list response to ensure
 * each URI appears only once.
 *
 * Handles both exact URIs and templates - two resources are considered
 * duplicates if they have the exact same URI string.
 *
 * @param resources - Array of resources to deduplicate
 * @returns Deduplicated array with first occurrence of each URI
 */
export function deduplicateResources(resources: Resource[]): Resource[] {
    // For resources, we deduplicate by URI
    // The first occurrence in the array has highest priority
    return _.uniqBy(resources, 'uri');
}

/**
 * Deduplicate prompts by name
 *
 * Keeps first occurrence (highest priority) when duplicates are found.
 * This is used when generating the prompts/list response to ensure
 * each prompt name appears only once.
 *
 * @param prompts - Array of prompts to deduplicate
 * @returns Deduplicated array with first occurrence of each name
 */
export function deduplicatePrompts(prompts: Prompt[]): Prompt[] {
    // For prompts, we deduplicate by name
    // The first occurrence in the array has highest priority
    return _.uniqBy(prompts, 'name');
}

/**
 * Deduplicate tools by name
 *
 * Keeps first occurrence (highest priority) when duplicates are found.
 * This is used when merging tools from multiple groups to ensure
 * each tool name appears only once.
 *
 * @param tools - Array of tools to deduplicate
 * @returns Deduplicated array with first occurrence of each name
 */
export function deduplicateTools(tools: Tool[]): Tool[] {
    // For tools, we deduplicate by name
    // The first occurrence in the array has highest priority
    return _.uniqBy(tools, 'name');
}
