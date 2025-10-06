/**
 * Unit tests for URI template matching utilities
 */

import { describe, it, expect } from 'bun:test';
import _ from 'lodash';
import {
    isUriTemplate,
    parseTemplate,
    matchesTemplate,
    expandTemplate,
    extractTemplateVariables,
    templatesCanOverlap,
    generateExampleUri
} from '../../src/middleware/uri-matcher.js';

describe('URI Matcher Utilities', () => {
    describe('isUriTemplate()', () => {
        it('should correctly identify URI templates', () => {
            // Templates with variables
            expect(isUriTemplate('file:///{+path}')).toBe(true);
            expect(isUriTemplate('http://api.{domain}/v1/{endpoint}')).toBe(true);
            expect(isUriTemplate('https://github.com/{owner}/{repo}')).toBe(true);
            expect(isUriTemplate('/users/{id}')).toBe(true);
            expect(isUriTemplate('{+path}')).toBe(true);
            expect(isUriTemplate('{#fragment}')).toBe(true);
            expect(isUriTemplate('{?query*}')).toBe(true);
            expect(isUriTemplate('{&params*}')).toBe(true);

            // Exact URIs (not templates)
            expect(isUriTemplate('file:///etc/hosts')).toBe(false);
            expect(isUriTemplate('https://example.com')).toBe(false);
            expect(isUriTemplate('sqlite:///data.db')).toBe(false);
            expect(isUriTemplate('/users/123')).toBe(false);
            expect(isUriTemplate('')).toBe(false);

            // Edge cases
            expect(isUriTemplate('{')).toBe(false); // Incomplete bracket
            expect(isUriTemplate('}')).toBe(false); // Just closing bracket
            expect(isUriTemplate('{}')).toBe(false); // Empty variable name
        });
    });

    describe('parseTemplate()', () => {
        it('should parse valid URI templates', () => {
            const template1 = parseTemplate('file:///{+path}');
            expect(template1).toBeDefined();

            const template2 = parseTemplate('http://api.{domain}/v1/{endpoint}');
            expect(template2).toBeDefined();

            const template3 = parseTemplate('/users/{id}/posts/{postId}');
            expect(template3).toBeDefined();
        });

        it('should parse templates with RFC 6570 operators', () => {
            const reserved = parseTemplate('{+reserved}');
            expect(reserved).toBeDefined();

            const fragment = parseTemplate('{#section}');
            expect(fragment).toBeDefined();

            const query = parseTemplate('{?page,limit}');
            expect(query).toBeDefined();

            const continuation = parseTemplate('{&sort,order}');
            expect(continuation).toBeDefined();

            const explode = parseTemplate('{/path*}');
            expect(explode).toBeDefined();
        });

        it('should handle malformed templates gracefully', () => {
            // Note: uri-templates library is very permissive and doesn't throw on most patterns
            // It treats them as valid templates with extracted variable names
            const template1 = parseTemplate('{{invalid}}');
            expect(template1).toBeDefined();

            const template2 = parseTemplate('{unclosed');
            expect(template2).toBeDefined();

            // Even unmatched braces are accepted
            const template3 = parseTemplate('unmatched}');
            expect(template3).toBeDefined();
        });
    });

    describe('matchesTemplate()', () => {
        describe('exact URI matching', () => {
            it('should match exact URIs correctly', () => {
                const result1 = matchesTemplate('file:///etc/hosts', 'file:///etc/hosts');
                expect(result1.matches).toBe(true);
                expect(result1.variables).toBeUndefined();

                const result2 = matchesTemplate('file:///etc/hosts', 'file:///etc/passwd');
                expect(result2.matches).toBe(false);

                const result3 = matchesTemplate('https://api.example.com', 'https://api.example.com');
                expect(result3.matches).toBe(true);
            });
        });

        describe('template matching', () => {
            it('should match URIs against simple templates', () => {
                const result1 = matchesTemplate('file:///etc/hosts', 'file:///{+path}');
                expect(result1.matches).toBe(true);
                expect(result1.variables).toEqual({ path: 'etc/hosts' });

                const result2 = matchesTemplate('file:///var/log/app.log', 'file:///{+path}');
                expect(result2.matches).toBe(true);
                expect(result2.variables).toEqual({ path: 'var/log/app.log' });

                const result3 = matchesTemplate('https://example.com', 'file:///{+path}');
                expect(result3.matches).toBe(false);
            });

            it('should match URIs with multiple variables', () => {
                const template = 'https://api.{domain}/v{version}/{endpoint}';

                const result1 = matchesTemplate('https://api.github.com/v3/users', template);
                expect(result1.matches).toBe(true);
                expect(result1.variables).toEqual({
                    domain:   'github.com',
                    version:  '3',
                    endpoint: 'users',
                });

                const result2 = matchesTemplate('https://api.example.org/v2/posts', template);
                expect(result2.matches).toBe(true);
                expect(result2.variables).toEqual({
                    domain:   'example.org',
                    version:  '2',
                    endpoint: 'posts',
                });

                const result3 = matchesTemplate('https://www.example.com/v1/data', template);
                expect(result3.matches).toBe(false); // Different pattern
            });

            it('should match with path segments', () => {
                const template = 'file:///{dir}/{file}';

                const result1 = matchesTemplate('file:///etc/hosts', template);
                expect(result1.matches).toBe(true);
                expect(result1.variables).toEqual({
                    dir:  'etc',
                    file: 'hosts',
                });

                const result2 = matchesTemplate('file:///var/app.config', template);
                expect(result2.matches).toBe(true);
                expect(result2.variables).toEqual({
                    dir:  'var',
                    file: 'app.config',
                });

                // The library allows greedy matching - last variable captures remaining path
                const result3 = matchesTemplate('file:///var/log/app.log', template);
                expect(result3.matches).toBe(true);
                expect(result3.variables).toEqual({
                    dir:  'var',
                    file: 'log/app.log',
                });
            });

            it('should handle edge cases', () => {
                // Empty path variable
                const result1 = matchesTemplate('file:///', 'file:///{+path}');
                expect(result1.matches).toBe(true);
                expect(result1.variables).toEqual({ path: '' });

                // Invalid template syntax should not match
                const result2 = matchesTemplate('test', '{invalid}}');
                expect(result2.matches).toBe(false);

                // Non-matching scheme
                const result3 = matchesTemplate('http://example.com', 'https://{domain}');
                expect(result3.matches).toBe(false);
            });
        });
    });

    describe('expandTemplate()', () => {
        it('should expand templates with variables', () => {
            const expanded1 = expandTemplate('file:///{+path}', { path: 'etc/hosts' });
            expect(expanded1).toBe('file:///etc/hosts');

            const expanded2 = expandTemplate(
                'https://api.{domain}/v{version}/{endpoint}',
                { domain: 'github.com', version: '3', endpoint: 'users' }
            );
            expect(expanded2).toBe('https://api.github.com/v3/users');

            const expanded3 = expandTemplate(
                '/users/{id}/posts/{postId}',
                { id: '123', postId: '456' }
            );
            expect(expanded3).toBe('/users/123/posts/456');
        });

        it('should handle missing variables', () => {
            const expanded = expandTemplate('file:///{+path}', {});
            expect(expanded).toBe('file:///'); // Variable is omitted when not provided
        });

        it('should handle special characters in variables', () => {
            const expanded = expandTemplate(
                'file:///{+path}',
                { path: 'dir/with spaces/file.txt' }
            );
            expect(expanded).toBe('file:///dir/with%20spaces/file.txt');
        });

        it('should handle unusual templates', () => {
            // Note: uri-templates library is very permissive
            // Even unusual patterns like {unclosed are accepted and expanded
            const expanded = expandTemplate('{unclosed', { unclosed: 'test' });
            expect(expanded).toBe('test');
        });
    });

    describe('extractTemplateVariables()', () => {
        it('should extract simple variable names', () => {
            expect(extractTemplateVariables('file:///{+path}')).toEqual(['path']);
            expect(extractTemplateVariables('/users/{id}')).toEqual(['id']);
            expect(extractTemplateVariables('{variable}')).toEqual(['variable']);
        });

        it('should extract multiple variables', () => {
            expect(extractTemplateVariables('/users/{id}/posts/{postId}')).toEqual(['id', 'postId']);
            expect(extractTemplateVariables('https://api.{domain}/v{version}/{endpoint}')).toEqual([
                'domain',
                'version',
                'endpoint',
            ]);
        });

        it('should handle RFC 6570 operators', () => {
            expect(extractTemplateVariables('{+reserved}')).toEqual(['reserved']);
            expect(extractTemplateVariables('{#fragment}')).toEqual(['fragment']);
            expect(extractTemplateVariables('{?page,limit}')).toEqual(['page,limit']);
            expect(extractTemplateVariables('{&sort,order}')).toEqual(['sort,order']);
            expect(extractTemplateVariables('{/path*}')).toEqual(['path']);
            expect(extractTemplateVariables('{.format}')).toEqual(['format']);
            expect(extractTemplateVariables('{;params*}')).toEqual(['params']);
        });

        it('should return empty array for non-templates', () => {
            expect(extractTemplateVariables('file:///etc/hosts')).toEqual([]);
            expect(extractTemplateVariables('https://example.com')).toEqual([]);
            expect(extractTemplateVariables('')).toEqual([]);
        });

        it('should handle malformed templates gracefully', () => {
            expect(extractTemplateVariables('{')).toEqual([]);
            expect(extractTemplateVariables('}')).toEqual([]);
            expect(extractTemplateVariables('{}')).toEqual([]);
        });
    });

    describe('templatesCanOverlap()', () => {
        describe('exact URI comparisons', () => {
            it('should detect identical exact URIs as overlapping', () => {
                expect(templatesCanOverlap('file:///etc/hosts', 'file:///etc/hosts')).toBe(true);
                expect(templatesCanOverlap('https://api.com', 'https://api.com')).toBe(true);
            });

            it('should detect different exact URIs as non-overlapping', () => {
                expect(templatesCanOverlap('file:///etc/hosts', 'file:///etc/passwd')).toBe(false);
                expect(templatesCanOverlap('https://api.com', 'https://example.com')).toBe(false);
            });
        });

        describe('template vs exact URI', () => {
            it('should detect when template covers exact URI', () => {
                expect(templatesCanOverlap('file:///{+path}', 'file:///etc/hosts')).toBe(true);
                expect(templatesCanOverlap('file:///etc/hosts', 'file:///{+path}')).toBe(true);
                expect(templatesCanOverlap('https://api.{domain}/users', 'https://api.github.com/users')).toBe(true);
            });

            it('should detect when template does not cover exact URI', () => {
                expect(templatesCanOverlap('file:///{dir}/{file}', 'file:///singlepath')).toBe(false);
                expect(templatesCanOverlap('https://{domain}', 'http://example.com')).toBe(false);
            });
        });

        describe('template vs template', () => {
            it('should detect overlapping templates with same static parts', () => {
                expect(templatesCanOverlap('file:///{+path}', 'file:///{+filename}')).toBe(true);
                expect(templatesCanOverlap('/api/{version}/users', '/api/{v}/users')).toBe(true);
                expect(templatesCanOverlap('https://api.{domain}/data', 'https://api.{site}/data')).toBe(true);
            });

            it('should detect templates with compatible static parts', () => {
                // Conservative approach - these could potentially overlap
                expect(templatesCanOverlap('file:///{+path}', 'file:///{dir}/{file}')).toBe(true);
                expect(templatesCanOverlap('/api/{resource}', '/api/users/{id}')).toBe(true);
            });

            it('should handle templates with no static parts', () => {
                expect(templatesCanOverlap('{scheme}://{+path}', '{protocol}://{uri}')).toBe(true);
                expect(templatesCanOverlap('{anything}', '{something}')).toBe(true);
            });

            it('should detect non-overlapping templates', () => {
                // Different schemes
                expect(templatesCanOverlap('http://{domain}', 'https://{domain}')).toBe(false);
                // Different static prefixes
                expect(templatesCanOverlap('/api/{+path}', '/v2/{+path}')).toBe(false);
                // Different static parts entirely
                expect(templatesCanOverlap('file:///{+path}', 'sqlite:///{db}')).toBe(false);
            });
        });

        describe('edge cases', () => {
            it('should handle empty strings', () => {
                expect(templatesCanOverlap('', '')).toBe(true);
                expect(templatesCanOverlap('', 'file:///{+path}')).toBe(false);
                expect(templatesCanOverlap('{path}', '')).toBe(false);
            });

            it('should handle complex templates', () => {
                const template1 = 'https://api.{domain}/v{version}/{resource}/{id}';
                const template2 = 'https://api.{host}/v{v}/{type}/{identifier}';
                expect(templatesCanOverlap(template1, template2)).toBe(true);
            });
        });
    });

    describe('generateExampleUri()', () => {
        it('should return exact URIs unchanged', () => {
            expect(generateExampleUri('file:///etc/hosts')).toBe('file:///etc/hosts');
            expect(generateExampleUri('https://api.github.com')).toBe('https://api.github.com');
            expect(generateExampleUri('')).toBe('');
        });

        it('should generate examples for simple templates', () => {
            const example1 = generateExampleUri('file:///{+path}');
            expect(example1).toBe('file:///example-path');

            const example2 = generateExampleUri('/users/{id}');
            expect(example2).toBe('/users/example-id');

            const example3 = generateExampleUri('{scheme}://{domain}');
            expect(example3).toBe('example-scheme://example-domain');
        });

        it('should generate examples for multi-variable templates', () => {
            const example1 = generateExampleUri('https://api.{domain}/v{version}/{endpoint}');
            expect(example1).toBe('https://api.example-domain/vexample-version/example-endpoint');

            const example2 = generateExampleUri('/users/{userId}/posts/{postId}/comments/{commentId}');
            expect(example2).toBe('/users/example-userId/posts/example-postId/comments/example-commentId');
        });

        it('should handle templates with operators', () => {
            const example1 = generateExampleUri('{+reserved}');
            expect(example1).toBe('example-reserved');

            const example2 = generateExampleUri('{#fragment}');
            expect(example2).toBe('#example-fragment');

            const example3 = generateExampleUri('{/path*}');
            expect(example3).toBe('/example-path');
        });

        it('should generate valid URIs', () => {
            const example1 = generateExampleUri('file:///{dir}/{file}.{ext}');
            const components1 = _.split(example1, '/');
            expect(components1).toHaveLength(5); // 'file:', '', '', 'example-dir', 'example-file.example-ext'

            const example2 = generateExampleUri('https://api.{subdomain}.{domain}.com/{resource}');
            expect(example2).toContain('example-subdomain');
            expect(example2).toContain('example-domain');
            expect(example2).toContain('example-resource');
        });
    });
});
