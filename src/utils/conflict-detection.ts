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
 * Categorize resources into exact URIs and templates
 * @internal
 */
function categorizeResources(resources: ResourceRef[]): {
    exactUris: { resource: ResourceRef, index: number }[]
    templates: { resource: ResourceRef, index: number }[]
} {
    const exactUris: { resource: ResourceRef, index: number }[] = [];
    const templates: { resource: ResourceRef, index: number }[] = [];

    for(let i = 0; i < resources.length; i++) {
        const resource = resources[i];
        if(!resource) {
            continue;
        }

        if(isUriTemplate(resource.uri)) {
            templates.push({ resource, index: i });
        } else {
            exactUris.push({ resource, index: i });
        }
    }

    return { exactUris, templates };
}

/**
 * Find exact duplicate conflicts using Map-based O(n) lookup
 * @internal
 */
function findExactDuplicateConflicts(
    exactUris: { resource: ResourceRef, index: number }[]
): ResourceConflict[] {
    const conflicts: ResourceConflict[] = [];
    const exactUriMap = new Map<string, { resource: ResourceRef, index: number }[]>();

    // Build map of exact URIs
    for(const item of exactUris) {
        const existing = exactUriMap.get(item.resource.uri);
        if(existing) {
            existing.push(item);
        } else {
            exactUriMap.set(item.resource.uri, [item]);
        }
    }

    // Find conflicts in groups with 2+ items
    for(const [uri, items] of exactUriMap) {
        if(items.length > 1) {
            for(let i = 0; i < items.length; i++) {
                for(let j = i + 1; j < items.length; j++) {
                    const item1 = items[i];
                    const item2 = items[j];
                    if(!item1 || !item2) {
                        continue;
                    }

                    conflicts.push({
                        type:       'exact-duplicate',
                        resources:  [item1.resource, item2.resource],
                        exampleUri: uri,
                        priority:   [item1.index, item2.index],
                    });
                }
            }
        }
    }

    return conflicts;
}

/**
 * Find template-exact conflicts
 * @internal
 */
function findTemplateExactConflicts(
    templates: { resource: ResourceRef, index: number }[],
    exactUris: { resource: ResourceRef, index: number }[]
): ResourceConflict[] {
    const conflicts: ResourceConflict[] = [];

    for(const templateItem of templates) {
        for(const exactItem of exactUris) {
            const match = matchesTemplate(exactItem.resource.uri, templateItem.resource.uri);
            if(match.matches) {
                // Determine conflict type based on ordering in original array
                // If template comes first, it's "template-covers-exact"
                // If exact comes first, it's "exact-covered-by-template"
                const templateFirst = templateItem.index < exactItem.index;

                conflicts.push({
                    type:      templateFirst ? 'template-covers-exact' : 'exact-covered-by-template',
                    resources: templateFirst
                        ? [templateItem.resource, exactItem.resource]
                        : [exactItem.resource, templateItem.resource],
                    exampleUri: exactItem.resource.uri,
                    priority:   templateFirst
                        ? [templateItem.index, exactItem.index]
                        : [exactItem.index, templateItem.index],
                });
            }
        }
    }

    return conflicts;
}

/**
 * Find template-template overlap conflicts
 * @internal
 */
function findTemplateOverlapConflicts(
    templates: { resource: ResourceRef, index: number }[]
): ResourceConflict[] {
    const conflicts: ResourceConflict[] = [];

    for(let i = 0; i < templates.length; i++) {
        for(let j = i + 1; j < templates.length; j++) {
            const template1 = templates[i];
            const template2 = templates[j];
            if(!template1 || !template2) {
                continue;
            }

            if(templatesCanOverlap(template1.resource.uri, template2.resource.uri)) {
                const exampleUri = generateExampleUri(template1.resource.uri);
                conflicts.push({
                    type:      'template-overlap',
                    resources: [template1.resource, template2.resource],
                    exampleUri,
                    priority:  [template1.index, template2.index],
                });
            }
        }
    }

    return conflicts;
}

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
    // Categorize resources O(n)
    const { exactUris, templates } = categorizeResources(resources);

    // Find all types of conflicts using optimized algorithms
    const exactDuplicates = findExactDuplicateConflicts(exactUris);
    const templateExact = findTemplateExactConflicts(templates, exactUris);
    const templateOverlaps = findTemplateOverlapConflicts(templates);

    // Combine all conflicts
    return [...exactDuplicates, ...templateExact, ...templateOverlaps];
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

    // Build map of prompt names to their entries with indices O(n)
    const promptsByName = new Map<string, { prompt: PromptRef, index: number }[]>();

    for(let i = 0; i < prompts.length; i++) {
        const prompt = prompts[i];
        if(!prompt) {
            continue;
        }

        const existing = promptsByName.get(prompt.name);
        if(existing) {
            existing.push({ prompt, index: i });
        } else {
            promptsByName.set(prompt.name, [{ prompt, index: i }]);
        }
    }

    // Find conflicts in groups with 2+ prompts O(n)
    for(const items of promptsByName.values()) {
        if(items.length > 1) {
            // Create conflicts for each pair
            for(let i = 0; i < items.length; i++) {
                for(let j = i + 1; j < items.length; j++) {
                    const item1 = items[i];
                    const item2 = items[j];
                    if(!item1 || !item2) {
                        continue;
                    }

                    conflicts.push({
                        prompts:  [item1.prompt, item2.prompt],
                        priority: [item1.index, item2.index],
                    });
                }
            }
        }
    }

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
