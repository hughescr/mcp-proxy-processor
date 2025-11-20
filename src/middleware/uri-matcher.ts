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
        // Coverage: Error handler for malformed templates from third-party uri-templates library
        // Difficult to test as library validates internally; kept for defensive programming
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
        if(!result) {
            return { matches: false };
        }

        return { matches: true, variables: result };
    } catch{
        // Coverage: Defensive error handling for uri-templates library exceptions
        // parseTemplate already validates, but kept as safety net for runtime errors
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
        // Coverage: Error handler for template expansion failures from uri-templates library
        // Difficult to trigger as parseTemplate validates upfront; kept for defensive programming
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

    return _(matches)
        .map((match) => {
            // Remove braces and any modifiers (*, +, #, etc.)
            const variable = _.replace(match.slice(1, -1), /^[*+#./;?&]/, '');
            // Handle explode operator (*)
            return _.replace(variable, /\*$/, '');
        })
        .compact()
        .value();
}

/**
 * Check if two URI templates could potentially match some of the same URIs
 * (overlap detection for conflict checking)
 */
export function templatesCanOverlap(template1: string, template2: string): boolean {
    // Handle empty strings first
    if(_.isEmpty(template1) || _.isEmpty(template2)) {
        return template1 === template2;
    }

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

    // Both are templates - use cross-template matching
    // Generate example URIs from each template and test against the other
    try {
        const example1 = generateExampleUri(template1);
        const example2 = generateExampleUri(template2);

        // Test if example from template1 matches template2
        const example1MatchesTemplate2 = matchesTemplate(example1, template2).matches;

        // Test if example from template2 matches template1
        const example2MatchesTemplate1 = matchesTemplate(example2, template1).matches;

        // If either example matches the other template, they can overlap
        return example1MatchesTemplate2 || example2MatchesTemplate1;
    } catch{
        // If we can't generate examples, be conservative and assume overlap
        return true;
    }
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
