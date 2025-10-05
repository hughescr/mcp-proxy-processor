/**
 * ScreenFooter Component
 * Standardized footer with help text/controls
 */

import React from 'react';
import { Box, Text } from 'ink';
import { map } from 'lodash';

interface ScreenFooterProps {
    /** Help text or control instructions */
    text:       string
    /** Additional lines of help text */
    lines?:     string[]
    /** Top margin (default: 1) */
    marginTop?: number
}

/**
 * Standardized screen footer with help/control text
 */
export function ScreenFooter({ text, lines, marginTop = 1 }: ScreenFooterProps) {
    return (
        <Box flexDirection="column" marginTop={marginTop}>
            <Text>{text}</Text>
            {map(lines, (line, index) => (
                <Text key={index}>{line}</Text>
            ))}
        </Box>
    );
}
