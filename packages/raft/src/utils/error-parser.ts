/**
 * Utility for parsing and extracting error information for logging
 */
export function parseError(error: unknown): Record<string, unknown> {
  if (!error) return {};

  if (error instanceof Error) {
    const parsed: Record<string, unknown> = {
      name: error.name,
      message: error.message,
    };

    if (error.stack) {
      parsed.stack = error.stack;
    }

    // Check for cause property (modern Error API)
    if ("cause" in error && error.cause !== undefined) {
      parsed.cause = parseError(error.cause);
    }

    // Handle additional properties that might exist on custom error types
    const errorProps = Object.getOwnPropertyNames(error);
    for (const prop of errorProps) {
      if (!["name", "message", "stack"].includes(prop)) {
        try {
          const value = (error as any)[prop];
          if (value !== undefined) {
            parsed[prop] = value;
          }
        } catch {
          // Ignore properties that can't be accessed
        }
      }
    }

    return parsed;
  }

  // Handle non-Error objects that might be thrown
  if (typeof error === "object") {
    return { value: error, type: "non-error-object" };
  }

  // Handle primitive values that might be thrown
  return { value: error, type: typeof error };
}
