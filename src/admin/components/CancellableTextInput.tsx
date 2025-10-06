/**
 * Cancellable Text Input Component
 * Wraps ink-text-input to add ESC key support for cancellation
 */

import React from 'react';
import { useInput } from 'ink';
import TextInput from 'ink-text-input';

interface CancellableTextInputProps {
    /** Current input value */
    value:        string
    /** Placeholder text when empty */
    placeholder?: string
    /** Called when value changes */
    onChange:     (value: string) => void
    /** Called when user submits (Enter) */
    onSubmit:     (value: string) => void
    /** Called when user cancels (ESC) */
    onCancel:     () => void
}

/**
 * Text input with ESC key support for cancellation
 *
 * Controls:
 * - Type normally to edit
 * - Enter: Submit
 * - ESC: Cancel without submitting
 */
export function CancellableTextInput({
    value,
    placeholder,
    onChange,
    onSubmit,
    onCancel,
}: CancellableTextInputProps) {
    // Handle ESC key separately since TextInput doesn't support it
    useInput((input, key) => {
        if(key.escape) {
            onCancel();
        }
    });

    return (
        <TextInput
          value={value}
          placeholder={placeholder}
          onChange={onChange}
          onSubmit={onSubmit}
        />
    );
}
