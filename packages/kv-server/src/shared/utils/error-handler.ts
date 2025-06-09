export class ErrorHandler {
  static async safeExecute<T>(
    operation: () => Promise<T>,
    fallbackValue: T,
    errorHandler?: (error: Error) => void,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (errorHandler) {
        errorHandler(error as Error);
      }
      return fallbackValue;
    }
  }

  static async safeExecuteWithBoolean(
    operation: () => Promise<any>,
    errorHandler?: (error: Error) => void,
  ): Promise<boolean> {
    return this.safeExecute(
      async () => {
        await operation();
        return true;
      },
      false,
      errorHandler,
    );
  }
}
