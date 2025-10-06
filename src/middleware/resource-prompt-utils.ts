/**
 * Resource and Prompt Priority and Conflict Detection Utilities
 *
 * Provides utilities for:
 * - Detecting conflicts between resources/prompts in priority lists
 * - Finding matching resources/prompts for incoming requests
 * - Deduplicating resources/prompts by URI/name
 */

import _, { uniqBy } from 'lodash';
import type { Resource, Prompt } from '@modelcontextprotocol/sdk/types.js';
import type { ResourceRef, ResourceConflict, PromptRef, PromptConflict } from '../types/config.js';
import { isUriTemplate, matchesTemplate, templatesCanOverlap, generateExampleUri } from './uri-matcher.js';

/**
 * Detect conflicts in a list of resource references
 * Returns all conflicts found, with priority indices
 */
export function detectResourceConflicts(resources: ResourceRef[]): ResourceConflict[] {
    const conflicts: ResourceConflict[] = [];

    for(let i = 0; i < resources.length; i++) {
        for(let j = i + 1; j < resources.length; j++) {
            const ref1 = resources[i];
            const ref2 = resources[j];

            const isTemplate1 = isUriTemplate(ref1.uri);
            const isTemplate2 = isUriTemplate(ref2.uri);

            // Exact duplicate - both are exact URIs and they match
            if(!isTemplate1 && !isTemplate2) {
                if(ref1.uri === ref2.uri) {
                    conflicts.push({
                        type:       'exact-duplicate',
                        resources:  [ref1, ref2],
                        exampleUri: ref1.uri,
                        priority:   [i, j],
                    });
                }
                continue;
            }

            // Template covers exact - ref1 is template, ref2 is exact
            if(isTemplate1 && !isTemplate2) {
                const match = matchesTemplate(ref2.uri, ref1.uri);
                if(match.matches) {
                    conflicts.push({
                        type:       'template-covers-exact',
                        resources:  [ref1, ref2],
                        exampleUri: ref2.uri,
                        priority:   [i, j],
                    });
                }
                continue;
            }

            // Exact covered by template - ref1 is exact, ref2 is template
            if(!isTemplate1 && isTemplate2) {
                const match = matchesTemplate(ref1.uri, ref2.uri);
                if(match.matches) {
                    conflicts.push({
                        type:       'exact-covered-by-template',
                        resources:  [ref1, ref2],
                        exampleUri: ref1.uri,
                        priority:   [i, j],
                    });
                }
                continue;
            }

            // Both are templates - check for overlap
            if(isTemplate1 && isTemplate2) {
                if(templatesCanOverlap(ref1.uri, ref2.uri)) {
                    conflicts.push({
                        type:       'template-overlap',
                        resources:  [ref1, ref2],
                        exampleUri: generateExampleUri(ref1.uri),
                        priority:   [i, j],
                    });
                }
            }
        }
    }

    return conflicts;
}

/**
 * Detect conflicts in a list of prompt references
 * Prompts conflict if they have the same name
 */
export function detectPromptConflicts(prompts: PromptRef[]): PromptConflict[] {
    const conflicts: PromptConflict[] = [];

    for(let i = 0; i < prompts.length; i++) {
        for(let j = i + 1; j < prompts.length; j++) {
            const ref1 = prompts[i];
            const ref2 = prompts[j];

            if(ref1.name === ref2.name) {
                conflicts.push({
                    prompts:  [ref1, ref2],
                    priority: [i, j],
                });
            }
        }
    }

    return conflicts;
}

/**
 * Find all resource references that match a given URI, in priority order
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
 * @param name - The prompt name to match
 * @param promptRefs - Array of prompt references in priority order
 * @returns Array of matching prompt references in priority order
 */
export function findMatchingPromptRefs(name: string, promptRefs: PromptRef[]): PromptRef[] {
    return _.filter(promptRefs, { name });
}

/**
 * Deduplicate resources by URI
 * Keeps first occurrence (highest priority) when duplicates are found
 * Handles both exact URIs and templates
 */
export function deduplicateResources(resources: Resource[]): Resource[] {
    // For resources, we deduplicate by URI
    // The first occurrence in the array has highest priority
    return uniqBy(resources, 'uri');
}

/**
 * Deduplicate prompts by name
 * Keeps first occurrence (highest priority) when duplicates are found
 */
export function deduplicatePrompts(prompts: Prompt[]): Prompt[] {
    // For prompts, we deduplicate by name
    // The first occurrence in the array has highest priority
    return uniqBy(prompts, 'name');
}
