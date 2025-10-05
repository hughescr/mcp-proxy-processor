/**
 * Workflow Breadcrumb Component
 * Displays step-by-step progress in multi-step workflows
 */

import React from 'react';
import { Box, Text } from 'ink';
import { map } from 'lodash';
import { ScreenHeader } from './ui/ScreenHeader.js';

interface WorkflowStep {
    /** Step label */
    label:      string
    /** Whether this step is completed */
    completed?: boolean
    /** Whether this is the current step */
    isCurrent?: boolean
}

interface WorkflowBreadcrumbProps {
    /** Workflow title */
    title: string
    /** Array of workflow steps */
    steps: WorkflowStep[]
}

/**
 * Breadcrumb navigation for multi-step workflows
 *
 * Shows user's progress through a multi-step process with visual indicators
 */
export function WorkflowBreadcrumb({ title, steps }: WorkflowBreadcrumbProps) {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <ScreenHeader title={title} marginBottom={0} />
            <Box flexDirection="row" gap={1} marginTop={1}>
                {map(steps, (step, index) => {
                    const isLast = index === steps.length - 1;

                    // Determine icon based on step state
                    let icon = '○';
                    if(step.completed) {
                        icon = '✓';
                    } else if(step.isCurrent) {
                        icon = '→';
                    }

                    // Determine color based on step state
                    let color: 'green' | 'yellow' | 'gray' = 'gray';
                    if(step.completed) {
                        color = 'green';
                    } else if(step.isCurrent) {
                        color = 'yellow';
                    }

                    return (
                        <React.Fragment key={index}>
                            <Text color={color}>
                                {icon}
                                {' '}
                                {step.label}
                            </Text>
                            {!isLast && (
                                <Text dimColor>
                                    {'>'}
                                </Text>
                            )}
                        </React.Fragment>
                    );
                })}
            </Box>
        </Box>
    );
}
