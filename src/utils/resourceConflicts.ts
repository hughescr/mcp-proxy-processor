/**
 * Resource and Prompt Conflict Detection Utilities
 */

import { includes } from 'lodash';
import _ from 'lodash';
import type { ResourceRef, ResourceConflict, PromptRef, PromptConflict } from '../types/config.js';

/**
 * Check if a URI is a template (contains {variables})
 */
function isTemplate(uri: string): boolean {
    return includes(uri, '{') && includes(uri, '}');
}

/**
 * Check if a template pattern could match an exact URI
 * Very basic check - just removes {variables} and checks if the rest matches
 */
function templateMatchesExact(template: string, exact: string): boolean {
    // Convert template to regex pattern
    const pattern = _.replace(
        _.replace(template, /[.*+?^${}()|[\]\\]/g, '\\$&'), // Escape special regex chars except {}
        /\\\{[^}]+\\\}/g, '.*'); // Replace {var} with .*

    const regex = new RegExp(`^${pattern}$`);
    return regex.test(exact);
}

/**
 * Check if two templates could potentially match the same URI
 */
function templatesOverlap(template1: string, template2: string): boolean {
    // If templates are identical, they definitely overlap
    if(template1 === template2) {
        return true;
    }

    // Create example URIs from templates by replacing variables with example values
    const example1 = _.replace(template1, /\{[^}]+\}/g, 'example');
    const example2 = _.replace(template2, /\{[^}]+\}/g, 'example');

    // Check if either template could match the other's example
    return templateMatchesExact(template1, example2) || templateMatchesExact(template2, example1);
}

/**
 * Generate an example URI from a template
 */
function generateExampleUri(template: string): string {
    let counter = 1;
    return _.replace(template, /\{([^}]+)\}/g, (_, _varName) => {
        return `value${counter++}`;
    });
}

/**
 * Detect resource conflicts in a priority-ordered list
 */
export function detectResourceConflicts(resources: ResourceRef[]): ResourceConflict[] {
    const conflicts: ResourceConflict[] = [];

    for(let i = 0; i < resources.length; i++) {
        for(let j = i + 1; j < resources.length; j++) {
            const resource1 = resources[i];
            const resource2 = resources[j];

            const isTemplate1 = isTemplate(resource1.uri);
            const isTemplate2 = isTemplate(resource2.uri);

            // Check for exact duplicates
            if(resource1.uri === resource2.uri) {
                conflicts.push({
                    type:       'exact-duplicate',
                    resources:  [resource1, resource2],
                    exampleUri: resource1.uri,
                    priority:   [i, j],
                });
                continue;
            }

            // Check if template covers exact URI
            if(isTemplate1 && !isTemplate2) {
                if(templateMatchesExact(resource1.uri, resource2.uri)) {
                    conflicts.push({
                        type:       'template-covers-exact',
                        resources:  [resource1, resource2],
                        exampleUri: resource2.uri,
                        priority:   [i, j],
                    });
                }
            } else if(!isTemplate1 && isTemplate2) {
                if(templateMatchesExact(resource2.uri, resource1.uri)) {
                    conflicts.push({
                        type:       'exact-covered-by-template',
                        resources:  [resource1, resource2],
                        exampleUri: resource1.uri,
                        priority:   [i, j],
                    });
                }
            }

            // Check if two templates overlap
            if(isTemplate1 && isTemplate2) {
                if(templatesOverlap(resource1.uri, resource2.uri)) {
                    conflicts.push({
                        type:       'template-overlap',
                        resources:  [resource1, resource2],
                        exampleUri: generateExampleUri(resource1.uri),
                        priority:   [i, j],
                    });
                }
            }
        }
    }

    return conflicts;
}

/**
 * Detect prompt conflicts (duplicate names)
 */
export function detectPromptConflicts(prompts: PromptRef[]): PromptConflict[] {
    const conflicts: PromptConflict[] = [];

    for(let i = 0; i < prompts.length; i++) {
        for(let j = i + 1; j < prompts.length; j++) {
            const prompt1 = prompts[i];
            const prompt2 = prompts[j];

            // Check for duplicate names
            if(prompt1.name === prompt2.name) {
                conflicts.push({
                    prompts:  [prompt1, prompt2],
                    priority: [i, j],
                });
            }
        }
    }

    return conflicts;
}
