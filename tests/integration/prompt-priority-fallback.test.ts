/**
 * Integration tests for prompt priority fallback system
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { detectPromptConflicts } from '../../src/utils/conflict-detection.js';
import type { PromptConflict } from '../../src/types/config.js';
import { GroupManager } from '../../src/middleware/index.js';
import { createTempConfigFile } from '../fixtures/mock-configs.js';
import _ from 'lodash';
import type { GroupsConfig } from '../../src/types/config.js';
import type { Prompt } from '@modelcontextprotocol/sdk/types';

describe('Prompt Priority Fallback System', () => {
    let groupManager: GroupManager;
    let configPath: string;

    describe('Duplicate Prompt Name Handling', () => {
        beforeEach(async () => {
            const config: GroupsConfig = {
                groups: {
                    'duplicate-prompts': {
                        name:      'duplicate-prompts',
                        tools:     [],
                        resources: [],
                        prompts:   [
                            // Server 1 has priority (first in array)
                            {
                                name:       'code-review',
                                serverName: 'ai-assistant-v2',
                            },
                            // Server 2 has the same prompt - should be deduplicated
                            {
                                name:       'code-review',
                                serverName: 'ai-assistant-v1',
                            },
                            // Server 3 has the same prompt - should also be deduplicated
                            {
                                name:       'code-review',
                                serverName: 'legacy-assistant',
                            },
                        ],
                    },
                },
            };
            configPath = await createTempConfigFile(config);
            groupManager = new GroupManager(configPath);
            await groupManager.load();
        });

        it('should keep only the first occurrence in prompts/list', () => {
            const mockBackendPrompts = new Map<string, Prompt[]>([
                [
                    'ai-assistant-v2',
                    [
                        {
                            name:        'code-review',
                            description: 'Advanced code review with AI v2',
                            arguments:   [
                                {
                                    name:        'language',
                                    description: 'Programming language',
                                    required:    true,
                                },
                                {
                                    name:        'style',
                                    description: 'Review style',
                                    required:    false,
                                },
                            ],
                        },
                    ],
                ],
                [
                    'ai-assistant-v1',
                    [
                        {
                            name:        'code-review',
                            description: 'Basic code review with AI v1',
                            arguments:   [
                                {
                                    name:        'language',
                                    description: 'Code language',
                                    required:    true,
                                },
                            ],
                        },
                    ],
                ],
                [
                    'legacy-assistant',
                    [
                        {
                            name:        'code-review',
                            description: 'Legacy code review',
                            arguments:   [],
                        },
                    ],
                ],
            ]);

            const prompts = groupManager.getPromptsForGroup('duplicate-prompts', mockBackendPrompts);

            // Should only have one prompt (deduplicated)
            expect(prompts).toHaveLength(1);
            expect(prompts[0].name).toBe('code-review');
            // Should use the metadata from the highest priority server (ai-assistant-v2)
            expect(prompts[0].description).toBe('Advanced code review with AI v2');
            expect(prompts[0].arguments).toHaveLength(2);
        });

        it('should provide fallback chain for prompt execution', () => {
            const group = groupManager.getGroup('duplicate-prompts');
            expect(group).toBeDefined();

            // Get the server priority for this prompt
            const promptRef = group?.prompts?.[0];
            expect(promptRef?.serverName).toBe('ai-assistant-v2');

            // When ai-assistant-v2 fails, it should try v1, then legacy
            const allRefs = _.filter(group?.prompts, { name: 'code-review' });
            expect(allRefs).toHaveLength(3);
            expect(allRefs?.[0]?.serverName).toBe('ai-assistant-v2');
            expect(allRefs?.[1]?.serverName).toBe('ai-assistant-v1');
            expect(allRefs?.[2]?.serverName).toBe('legacy-assistant');
        });
    });

    describe('Prompt Conflict Detection', () => {
        beforeEach(async () => {
            const config: GroupsConfig = {
                groups: {
                    'conflicting-prompts': {
                        name:      'conflicting-prompts',
                        tools:     [],
                        resources: [],
                        prompts:   [
                            {
                                name:       'summarize',
                                serverName: 'text-processor',
                            },
                            {
                                name:       'translate',
                                serverName: 'language-service',
                            },
                            {
                                name:       'summarize',
                                serverName: 'ai-writer',
                            },
                            {
                                name:       'analyze',
                                serverName: 'data-service',
                            },
                            {
                                name:       'translate',
                                serverName: 'translation-api',
                            },
                        ],
                    },
                },
            };
            configPath = await createTempConfigFile(config);
            groupManager = new GroupManager(configPath);
            await groupManager.load();
        });

        it('should detect duplicate prompt names', () => {
            const group = groupManager.getGroup('conflicting-prompts');
            const conflicts = detectPromptConflicts(group?.prompts ?? []);

            // Should detect conflicts for duplicate names
            expect(conflicts.length).toBeGreaterThan(0);

            // Should find conflicts for 'summarize' and 'translate'
            const summarizeConflicts = _.filter(conflicts, (c: PromptConflict) =>
                _.some(c.prompts, { name: 'summarize' })
            );
            const translateConflicts = _.filter(conflicts, (c: PromptConflict) =>
                _.some(c.prompts, { name: 'translate' })
            );

            expect(summarizeConflicts.length).toBeGreaterThan(0);
            expect(translateConflicts.length).toBeGreaterThan(0);

            // Should not find conflicts for unique 'analyze'
            const analyzeConflicts = _.filter(conflicts, (c: PromptConflict) =>
                _.some(c.prompts, { name: 'analyze' })
            );
            expect(analyzeConflicts).toHaveLength(0);
        });

        it('should report correct priority indices in conflicts', () => {
            const group = groupManager.getGroup('conflicting-prompts');
            const conflicts = detectPromptConflicts(group?.prompts ?? []);

            _.forEach(conflicts, (conflict: PromptConflict) => {
                // Priority indices should be different
                expect(conflict.priority[0]).not.toBe(conflict.priority[1]);

                // Lower index = higher priority
                const higherPriority = Math.min(...conflict.priority);
                const lowerPriority = Math.max(...conflict.priority);
                expect(higherPriority).toBeLessThan(lowerPriority);
            });
        });
    });

    describe('Prompt Arguments Pass-through', () => {
        beforeEach(async () => {
            const config: GroupsConfig = {
                groups: {
                    'prompt-args': {
                        name:      'prompt-args',
                        tools:     [],
                        resources: [],
                        prompts:   [
                            {
                                name:       'generate-code',
                                serverName: 'code-gen-advanced',
                            },
                            {
                                name:       'generate-code',
                                serverName: 'code-gen-basic',
                            },
                        ],
                    },
                },
            };
            configPath = await createTempConfigFile(config);
            groupManager = new GroupManager(configPath);
            await groupManager.load();
        });

        it('should pass through prompt arguments correctly', () => {
            const mockBackendPrompts = new Map<string, Prompt[]>([
                [
                    'code-gen-advanced',
                    [
                        {
                            name:        'generate-code',
                            description: 'Generate code with advanced features',
                            arguments:   [
                                {
                                    name:        'language',
                                    description: 'Target programming language',
                                    required:    true,
                                },
                                {
                                    name:        'framework',
                                    description: 'Framework to use',
                                    required:    false,
                                },
                                {
                                    name:        'tests',
                                    description: 'Include unit tests',
                                    required:    false,
                                },
                            ],
                        },
                    ],
                ],
                [
                    'code-gen-basic',
                    [
                        {
                            name:        'generate-code',
                            description: 'Basic code generation',
                            arguments:   [
                                {
                                    name:        'language',
                                    description: 'Programming language',
                                    required:    true,
                                },
                            ],
                        },
                    ],
                ],
            ]);

            const prompts = groupManager.getPromptsForGroup('prompt-args', mockBackendPrompts);

            // Should use arguments from the highest priority prompt
            expect(prompts).toHaveLength(1);
            expect(prompts[0].arguments).toHaveLength(3);

            // Verify all arguments are present
            const argNames = _.map(prompts[0].arguments, 'name') ?? [];
            expect(argNames).toContain('language');
            expect(argNames).toContain('framework');
            expect(argNames).toContain('tests');

            // Verify required flags
            const languageArg = _.find(prompts[0].arguments, { name: 'language' });
            const frameworkArg = _.find(prompts[0].arguments, { name: 'framework' });
            expect(languageArg?.required).toBe(true);
            expect(frameworkArg?.required).toBe(false);
        });

        it('should determine correct server for prompt get', () => {
            const group = groupManager.getGroup('prompt-args');
            expect(group).toBeDefined();

            // Get server mapping for prompt directly from group config
            const promptRef = group?.prompts?.[0];
            expect(promptRef?.serverName).toBe('code-gen-advanced');

            // All servers providing this prompt from group config
            const allServers = _(group?.prompts)
                .filter({ name: 'generate-code' })
                .map('serverName')
                .value();
            expect(allServers).toEqual(['code-gen-advanced', 'code-gen-basic']);
        });
    });

    describe('Mixed Prompts', () => {
        beforeEach(async () => {
            const config: GroupsConfig = {
                groups: {
                    'mixed-prompts': {
                        name:      'mixed-prompts',
                        tools:     [],
                        resources: [],
                        prompts:   [
                            {
                                name:       'analyze-code',
                                serverName: 'static-analyzer',
                            },
                            {
                                name:       'format-code',
                                serverName: 'formatter-service',
                            },
                            {
                                name:       'analyze-code',
                                serverName: 'ai-analyzer',
                            },
                            {
                                name:       'lint-code',
                                serverName: 'linter-service',
                            },
                            {
                                name:       'optimize-code',
                                serverName: 'optimizer-service',
                            },
                            {
                                name:       'format-code',
                                serverName: 'prettier-service',
                            },
                        ],
                    },
                },
            };
            configPath = await createTempConfigFile(config);
            groupManager = new GroupManager(configPath);
            await groupManager.load();
        });

        it('should handle multiple unique and duplicate prompts', () => {
            const mockBackendPrompts = new Map<string, Prompt[]>([
                ['static-analyzer', [
                    { name: 'analyze-code', description: 'Static code analysis' },
                ]],
                ['formatter-service', [
                    { name: 'format-code', description: 'Code formatting service' },
                ]],
                ['ai-analyzer', [
                    { name: 'analyze-code', description: 'AI-powered code analysis' },
                ]],
                ['linter-service', [
                    { name: 'lint-code', description: 'Code linting' },
                ]],
                ['optimizer-service', [
                    { name: 'optimize-code', description: 'Code optimization' },
                ]],
                ['prettier-service', [
                    { name: 'format-code', description: 'Prettier formatting' },
                ]],
            ]);

            const prompts = groupManager.getPromptsForGroup('mixed-prompts', mockBackendPrompts);

            // Should deduplicate to unique prompt names only
            const uniqueNames = new Set(_.map(prompts, 'name'));
            expect(uniqueNames.size).toBe(4); // analyze-code, format-code, lint-code, optimize-code

            // Verify priority is maintained (first occurrence wins)
            const analyzePrompt = _.find(prompts, { name: 'analyze-code' });
            expect(analyzePrompt?.description).toBe('Static code analysis');

            const formatPrompt = _.find(prompts, { name: 'format-code' });
            expect(formatPrompt?.description).toBe('Code formatting service');
        });

        it('should maintain correct fallback chains for each unique prompt', () => {
            const group = groupManager.getGroup('mixed-prompts');

            // Check analyze-code fallback chain
            const analyzeServers = _(group?.prompts)
                .filter({ name: 'analyze-code' })
                .map('serverName')
                .value();
            expect(analyzeServers).toEqual(['static-analyzer', 'ai-analyzer']);

            // Check format-code fallback chain
            const formatServers = _(group?.prompts)
                .filter({ name: 'format-code' })
                .map('serverName')
                .value();
            expect(formatServers).toEqual(['formatter-service', 'prettier-service']);

            // Check unique prompts have no fallback
            const lintServers = _(group?.prompts)
                .filter({ name: 'lint-code' })
                .map('serverName')
                .value();
            expect(lintServers).toEqual(['linter-service']);

            const optimizeServers = _(group?.prompts)
                .filter({ name: 'optimize-code' })
                .map('serverName')
                .value();
            expect(optimizeServers).toEqual(['optimizer-service']);
        });
    });

    describe('Empty Prompts Handling', () => {
        beforeEach(async () => {
            const config: GroupsConfig = {
                groups: {
                    'no-prompts': {
                        name:      'no-prompts',
                        tools:     [],
                        resources: [],
                        prompts:   [],
                    },
                    'undefined-prompts': {
                        name:      'undefined-prompts',
                        tools:     [],
                        resources: [],
                        prompts:   [], // Always initialize as empty array
                    },
                },
            };
            configPath = await createTempConfigFile(config);
            groupManager = new GroupManager(configPath);
            await groupManager.load();
        });

        it('should handle groups with no prompts', () => {
            const mockBackendPrompts = new Map<string, Prompt[]>();

            const noPrompts = groupManager.getPromptsForGroup('no-prompts', mockBackendPrompts);
            expect(noPrompts).toHaveLength(0);

            const undefinedPrompts = groupManager.getPromptsForGroup('undefined-prompts', mockBackendPrompts);
            expect(undefinedPrompts).toHaveLength(0);
        });

        it('should return empty conflicts for empty prompt lists', () => {
            const noPromptsGroup = groupManager.getGroup('no-prompts');
            const conflicts1 = detectPromptConflicts(noPromptsGroup?.prompts ?? []);
            expect(conflicts1).toHaveLength(0);

            const undefinedPromptsGroup = groupManager.getGroup('undefined-prompts');
            const conflicts2 = detectPromptConflicts(undefinedPromptsGroup?.prompts ?? []);
            expect(conflicts2).toHaveLength(0);
        });
    });
});
