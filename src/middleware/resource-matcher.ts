/**
 * Resource and Prompt Matching
 *
 * Finds matching resources and prompts from priority-ordered lists
 * Supports URI template matching for resources
 */

import _ from 'lodash';
import type { ResourceRef, PromptRef } from '../types/config.js';
import { matchesTemplate } from './uri-matcher.js';

/**
 * Find all resources that match a given URI, in priority order
 * Returns empty array if no matches found
 *
 * @param uri - The URI to match against
 * @param resources - Priority-ordered array of resource references (first = highest priority)
 * @returns Array of matching resources in priority order (first match = highest priority)
 */
export function findMatchingResources(uri: string, resources: ResourceRef[]): ResourceRef[] {
    const matches: ResourceRef[] = [];

    for(const resource of resources) {
        const match = matchesTemplate(uri, resource.uri);
        if(match.matches) {
            matches.push(resource);
        }
    }

    return matches;
}

/**
 * Find all prompts that match a given name, in priority order
 * Returns empty array if no matches found
 *
 * @param name - The prompt name to match
 * @param prompts - Priority-ordered array of prompt references (first = highest priority)
 * @returns Array of matching prompts in priority order (first match = highest priority)
 */
export function findMatchingPrompts(name: string, prompts: PromptRef[]): PromptRef[] {
    return _.filter(prompts, { name });
}

/**
 * Find the first (highest priority) resource that matches a URI
 * Returns undefined if no match found
 */
export function findFirstMatchingResource(uri: string, resources: ResourceRef[]): ResourceRef | undefined {
    const matches = findMatchingResources(uri, resources);
    return _.head(matches);
}

/**
 * Find the first (highest priority) prompt that matches a name
 * Returns undefined if no match found
 */
export function findFirstMatchingPrompt(name: string, prompts: PromptRef[]): PromptRef | undefined {
    const matches = findMatchingPrompts(name, prompts);
    return _.head(matches);
}
