/**
 * Conflict Detection for Resources and Prompts
 *
 * Detects conflicts in priority-ordered resource and prompt references:
 * - Resources: Exact duplicates, template overlaps, template-covers-exact
 * - Prompts: Duplicate names across servers
 */

import _ from 'lodash';
import type { ResourceRef, PromptRef, ResourceConflict, PromptConflict } from '../types/config.js';
import { isUriTemplate, matchesTemplate, templatesCanOverlap, generateExampleUri } from './uri-matcher.js';

/**
 * Detect conflicts in resource references
 * Returns array of conflicts found (empty if no conflicts)
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

    return null;
}

/**
 * Detect conflicts in prompt references
 * Returns array of conflicts found (empty if no conflicts)
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
