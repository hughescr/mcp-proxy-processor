/**
 * ScrollableJsonViewer Component
 * Displays JSON with line-by-line scrolling for long content
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { split, map as _map } from 'lodash';

interface ScrollableJsonViewerProps {
    /** JSON object to display */
    data:            Record<string, unknown> | undefined
    /** Viewport height in lines (default: 10) */
    viewportHeight?: number
    /** Color for JSON text (default: 'green') */
    color?:          string
}

/**
 * Scrollable JSON viewer with fixed viewport
 * Handles Ctrl+arrow key navigation and shows scroll indicators
 * Uses Ctrl+Up/Down to avoid conflicting with text editor navigation
 */
export function ScrollableJsonViewer({
    data,
    viewportHeight = 10,
    color = 'green',
}: ScrollableJsonViewerProps) {
    const [scrollOffset, setScrollOffset] = useState(0);

    // Convert JSON to lines
    const lines = useMemo(() => {
        if(!data) {
            return ['(no schema)'];
        }
        return split(JSON.stringify(data, null, 2), '\n');
    }, [data]);

    const totalLines = lines.length;
    const maxOffset = Math.max(0, totalLines - viewportHeight);

    // Handle keyboard navigation - use Ctrl+arrows to avoid conflicts with text editor
    useInput((input, key) => {
        if(key.ctrl && key.upArrow) {
            // IMPORTANT: Use functional setState for rapid input support
            setScrollOffset(prevOffset => Math.max(0, prevOffset - 1));
        } else if(key.ctrl && key.downArrow) {
            // IMPORTANT: Use functional setState for rapid input support
            setScrollOffset(prevOffset => Math.min(maxOffset, prevOffset + 1));
        } else if(key.pageUp) {
            setScrollOffset(prevOffset => Math.max(0, prevOffset - viewportHeight));
        } else if(key.pageDown) {
            setScrollOffset(prevOffset => Math.min(maxOffset, prevOffset + viewportHeight));
        }
    });

    // Get visible lines
    const visibleLines = lines.slice(scrollOffset, scrollOffset + viewportHeight);

    return (
        <Box flexDirection="column">
            {scrollOffset > 0
                ? (
                    <Text dimColor>
                        ... (
                        {scrollOffset}
                        {' '}
                        more above)
                    </Text>
                )
                : <Text> </Text>}

            <Box height={viewportHeight} flexDirection="column">
                {_map(visibleLines, (line, index) => (
                    <Text key={scrollOffset + index} color={color}>
                        {line}
                    </Text>
                ))}
            </Box>

            {scrollOffset + viewportHeight < totalLines
                ? (
                    <Text dimColor>
                        ... (
                        {totalLines - scrollOffset - viewportHeight}
                        {' '}
                        more below)
                    </Text>
                )
                : <Text> </Text>}
        </Box>
    );
}
