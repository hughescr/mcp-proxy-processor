/**
 * URI Template Matching Utilities
 *
 * Provides utilities for matching URIs against RFC 6570 URI templates
 * Used for resource URI pattern matching in the priority system
 */

import UriTemplate from 'uri-templates';
import _ from 'lodash';

/**
 * Check if a string is a URI template (contains RFC 6570 template syntax)
 */
export function isUriTemplate(uri: string): boolean {
    // URI templates contain {variable} syntax
    return /\{[^}]+\}/.test(uri);
}

/**
 * Parse and validate a URI template
 */
export function parseTemplate(template: string): UriTemplate {
    try {
        return new UriTemplate(template);
    } catch (error) {
        throw new Error(`Invalid URI template "${template}": ${_.isError(error) ? error.message : String(error)}`);
    }
}

/**
 * Check if a URI matches a template pattern
 * For templates, extracts variables and returns match data
 * For exact URIs, performs string comparison
 */
export function matchesTemplate(uri: string, pattern: string): { matches: boolean, variables?: Record<string, string> } {
    // If pattern is not a template, do exact match
    if(!isUriTemplate(pattern)) {
        return { matches: uri === pattern };
    }

    try {
        const template = parseTemplate(pattern);
        const result = template.fromUri(uri);

        // fromUri returns null if no match, or an object with extracted variables
        if(result === null) {
            return { matches: false };
        }

        return { matches: true, variables: result };
    } catch{
        return { matches: false };
    }
}

/**
 * Expand a URI template with variables
 */
export function expandTemplate(template: string, variables: Record<string, string>): string {
    try {
        const tmpl = parseTemplate(template);
        // eslint-disable-next-line lodash/prefer-lodash-method -- This is UriTemplate.fill(), not Array.fill()
        return tmpl.fill(variables);
    } catch (error) {
        throw new Error(`Failed to expand template "${template}": ${_.isError(error) ? error.message : String(error)}`);
    }
}

/**
 * Extract variable names from a URI template
 */
export function extractTemplateVariables(template: string): string[] {
    const matches = template.match(/\{[^}]+\}/g);
    if(!matches) {
        return [];
    }

    return _.map(matches, (match) => {
        // Remove braces and any modifiers (*, +, #, etc.)
        const variable = _.replace(match.slice(1, -1), /^[*+#./;?&]/, '');
        // Handle explode operator (*)
        return _.replace(variable, /\*$/, '');
    });
}

/**
 * Check if two URI templates could potentially match some of the same URIs
 * (overlap detection for conflict checking)
 */
export function templatesCanOverlap(template1: string, template2: string): boolean {
    const vars1 = extractTemplateVariables(template1);
    const vars2 = extractTemplateVariables(template2);

    // If templates have no variables, they're exact URIs - check equality
    if(_.isEmpty(vars1) && _.isEmpty(vars2)) {
        return template1 === template2;
    }

    // If only one is a template, check if the exact URI matches the template
    if(_.isEmpty(vars1) && !_.isEmpty(vars2)) {
        return matchesTemplate(template1, template2).matches;
    }
    if(!_.isEmpty(vars1) && _.isEmpty(vars2)) {
        return matchesTemplate(template2, template1).matches;
    }

    // Both are templates - they could overlap if their static parts are compatible
    // This is a conservative check - we assume templates with different variable names
    // can still overlap (they might be semantically different but match same URIs)

    // Remove all template variables to get static parts
    const static1 = _.replace(template1, /\{[^}]+\}/g, '');
    const static2 = _.replace(template2, /\{[^}]+\}/g, '');

    // If static parts are different, they likely don't overlap
    // But this is conservative - templates could still overlap with different static parts
    // For now, we'll return true (conservative - flag as potential overlap)
    return static1 === static2 || static1.includes(static2) || static2.includes(static1);
}

/**
 * Generate an example URI from a template for conflict reporting
 */
export function generateExampleUri(template: string): string {
    if(!isUriTemplate(template)) {
        return template;
    }

    const variables = extractTemplateVariables(template);
    const exampleVars: Record<string, string> = {};

    // Generate example values for each variable
    _.forEach(variables, (varName) => {
        exampleVars[varName] = `example-${varName}`;
    });

    return expandTemplate(template, exampleVars);
}
