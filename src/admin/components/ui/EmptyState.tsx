/**
 * EmptyState Component
 * Standardized empty state message
 */

import React from 'react';
import { Box, Text } from 'ink';

interface EmptyStateProps {
    /** Empty state message */
    message:       string
    /** Optional action hint */
    actionHint?:   string
    /** Bottom margin (default: 1) */
    marginBottom?: number
}

/**
 * Standardized empty state component
 */
export function EmptyState({ message, actionHint, marginBottom = 1 }: EmptyStateProps) {
    return (
        <Box flexDirection="column" marginBottom={marginBottom}>
            <Text>{message}</Text>
            {actionHint && (
                <Text>{actionHint}</Text>
            )}
        </Box>
    );
}
