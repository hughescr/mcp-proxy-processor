/**
 * TypeScript declarations for uri-templates
 */

declare module 'uri-templates' {
    class UriTemplate {
        constructor(template: string);

        /**
         * Fill template with variables
         */
        fill(variables: Record<string, string | number | boolean>): string;

        /**
         * Extract variables from a URI matching this template
         * Returns null if URI doesn't match, or object with extracted variables
         */
        fromUri(uri: string): Record<string, string> | null;
    }

    export default UriTemplate;
}
