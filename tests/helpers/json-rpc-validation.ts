/**
 * JSON-RPC 2.0 Protocol Validation Helpers
 *
 * These helpers validate that messages conform to the JSON-RPC 2.0 specification.
 * They are used across multiple test suites to ensure protocol compliance.
 *
 * JSON-RPC 2.0 Spec: https://www.jsonrpc.org/specification
 */

import { isObject, isNumber, isString } from 'lodash';

/**
 * Validates basic JSON-RPC response structure
 * @param resp - Response object
 * @param requestId - Expected request ID
 */
function validateBasicStructure(resp: Record<string, unknown>, requestId: string | number): void {
    // Must have jsonrpc: "2.0"
    if(resp.jsonrpc !== '2.0') {
        throw new Error(`Invalid jsonrpc version: expected "2.0", got "${String(resp.jsonrpc)}"`);
    }

    // Must have id that matches request
    if(resp.id !== requestId) {
        throw new Error(`Invalid id: expected ${String(requestId)}, got ${String(resp.id)}`);
    }
}

/**
 * Validates error response structure
 * @param error - Error object
 */
function validateErrorStructure(error: unknown): void {
    if(!isObject(error)) {
        throw new Error('Error field must be an object');
    }

    const err = error as Record<string, unknown>;
    if(!isNumber(err.code)) {
        throw new Error(`Error code must be a number, got ${typeof err.code}`);
    }

    if(!isString(err.message)) {
        throw new Error(`Error message must be a string, got ${typeof err.message}`);
    }
}

/**
 * Validates that a response conforms to JSON-RPC 2.0 specification
 *
 * A valid JSON-RPC 2.0 response MUST:
 * - Have jsonrpc field set to "2.0"
 * - Have an id field that matches the request id
 * - Have EITHER a result field OR an error field, but not both
 * - If error is present, it must have code (number) and message (string)
 *
 * @param response - The response object to validate
 * @param requestId - The id from the original request
 * @param options - Optional validation options
 * @param options.expectError - If true, expects error field instead of result
 * @throws Error if validation fails
 */
export function validateJsonRpcResponse(
    response: unknown,
    requestId: string | number,
    options?: { expectError?: boolean }
): void {
    // Type guard: must be an object
    if(!isObject(response)) {
        throw new Error('JSON-RPC response must be an object');
    }

    const resp = response as Record<string, unknown>;

    validateBasicStructure(resp, requestId);

    // Must have either result or error, but not both
    const hasResult = 'result' in resp;
    const hasError = 'error' in resp;

    if(!hasResult && !hasError) {
        throw new Error('JSON-RPC response must have either result or error field');
    }

    if(hasResult && hasError) {
        throw new Error('JSON-RPC response cannot have both result and error fields');
    }

    // If expecting error, validate error structure
    if(options?.expectError) {
        if(!hasError) {
            throw new Error('Expected error response but got result');
        }
        validateErrorStructure(resp.error);
    } else {
        // Not expecting error
        if(hasError) {
            const error = resp.error as Record<string, unknown>;
            throw new Error(`Unexpected error response: ${String(error.message)} (code: ${String(error.code)})`);
        }
    }
}

/**
 * Validates that a request conforms to JSON-RPC 2.0 specification
 *
 * A valid JSON-RPC 2.0 request MUST:
 * - Have jsonrpc field set to "2.0"
 * - Have a method field (string)
 * - Have an id field (string, number, or null for notifications)
 * - Optionally have a params field (object or array)
 *
 * @param request - The request object to validate
 * @throws Error if validation fails
 */
export function validateJsonRpcRequest(request: unknown): void {
    // Type guard: must be an object
    if(!isObject(request)) {
        throw new Error('JSON-RPC request must be an object');
    }

    const req = request as Record<string, unknown>;

    // Must have jsonrpc: "2.0"
    if(req.jsonrpc !== '2.0') {
        throw new Error(`Invalid jsonrpc version: expected "2.0", got "${String(req.jsonrpc)}"`);
    }

    // Must have method
    if(!isString(req.method)) {
        throw new Error(`Method must be a string, got ${typeof req.method}`);
    }

    // Must have id (can be string, number, or null)
    if(!isString(req.id) && !isNumber(req.id) && req.id !== null) {
        throw new Error(`ID must be string, number, or null, got ${typeof req.id}`);
    }

    // If params exists, must be object or array
    if('params' in req && !isObject(req.params)) {
        throw new Error('Params must be an object or array if present');
    }
}

/**
 * Standard JSON-RPC 2.0 error codes
 *
 * From the spec:
 * -32700: Parse error (Invalid JSON was received)
 * -32600: Invalid Request (The JSON sent is not a valid Request object)
 * -32601: Method not found (The method does not exist / is not available)
 * -32602: Invalid params (Invalid method parameter(s))
 * -32603: Internal error (Internal JSON-RPC error)
 * -32000 to -32099: Server error (Reserved for implementation-defined server errors)
 */
export const JsonRpcErrorCode = {
    ParseError:     -32700,
    InvalidRequest: -32600,
    MethodNotFound: -32601,
    InvalidParams:  -32602,
    InternalError:  -32603,
} as const;

/**
 * Creates a standard JSON-RPC 2.0 error response
 *
 * @param id - Request id
 * @param code - Error code
 * @param message - Error message
 * @param data - Optional additional error data
 */
export function createJsonRpcError(
    id: string | number,
    code: number,
    message: string,
    data?: unknown
): object {
    return {
        jsonrpc: '2.0',
        id,
        error:   {
            code,
            message,
            ...(data !== undefined ? { data } : {}),
        },
    };
}

/**
 * Creates a standard JSON-RPC 2.0 success response
 *
 * @param id - Request id
 * @param result - Response result
 */
export function createJsonRpcResponse(
    id: string | number,
    result: unknown
): object {
    return {
        jsonrpc: '2.0',
        id,
        result,
    };
}
