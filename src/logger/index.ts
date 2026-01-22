/**
 * Structured Logging System
 *
 * Provides centralized logging with:
 * - Log levels (debug, info, warn, error)
 * - Structured context (requestId, diagramId, operation)
 * - JSON output in production, pretty console in development
 * - Timing utilities for performance tracking
 */

// Log levels
export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Log context
export interface LogContext {
  /** Request/connection ID for tracing */
  requestId?: string;
  /** Diagram ID being operated on */
  diagramId?: string;
  /** Operation being performed */
  operation?: string;
  /** User or participant ID */
  userId?: string;
  /** Additional context data */
  [key: string]: unknown;
}

// Log entry structure
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  duration?: number;
}

// Logger configuration
interface LoggerConfig {
  level: LogLevel;
  isProduction: boolean;
  appName: string;
}

class Logger {
  private config: LoggerConfig;

  constructor(config?: Partial<LoggerConfig>) {
    this.config = {
      level: (process.env.LOG_LEVEL as LogLevel) || "info",
      isProduction: process.env.NODE_ENV === "production",
      appName: "vizcraft",
      ...config,
    };
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.level];
  }

  /**
   * Format and output a log entry
   */
  private output(entry: LogEntry): void {
    if (this.config.isProduction) {
      // JSON output for production (easy to parse by log aggregators)
      console.log(JSON.stringify({
        ...entry,
        app: this.config.appName,
      }));
    } else {
      // Pretty console output for development
      const timestamp = new Date(entry.timestamp).toLocaleTimeString();
      const levelColors: Record<LogLevel, string> = {
        debug: "\x1b[36m", // cyan
        info: "\x1b[32m", // green
        warn: "\x1b[33m", // yellow
        error: "\x1b[31m", // red
      };
      const reset = "\x1b[0m";
      const color = levelColors[entry.level];

      let output = `${color}[${entry.level.toUpperCase()}]${reset} ${timestamp}`;

      if (entry.context?.operation) {
        output += ` [${entry.context.operation}]`;
      }

      output += ` ${entry.message}`;

      if (entry.duration !== undefined) {
        output += ` (${entry.duration.toFixed(2)}ms)`;
      }

      if (entry.context) {
        const { operation, ...rest } = entry.context;
        if (Object.keys(rest).length > 0) {
          output += ` ${JSON.stringify(rest)}`;
        }
      }

      console.log(output);

      if (entry.error?.stack && entry.level === "error") {
        console.error(entry.error.stack);
      }
    }
  }

  /**
   * Create a log entry
   */
  private createEntry(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error,
    duration?: number
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (context && Object.keys(context).length > 0) {
      entry.context = context;
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    if (duration !== undefined) {
      entry.duration = duration;
    }

    return entry;
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog("debug")) return;
    this.output(this.createEntry("debug", message, context));
  }

  /**
   * Log an info message
   */
  info(message: string, context?: LogContext): void {
    if (!this.shouldLog("info")) return;
    this.output(this.createEntry("info", message, context));
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog("warn")) return;
    this.output(this.createEntry("warn", message, context));
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error, context?: LogContext): void {
    if (!this.shouldLog("error")) return;
    this.output(this.createEntry("error", message, context, error));
  }

  /**
   * Time an async operation and log the result
   */
  async time<T>(
    operation: string,
    fn: () => Promise<T>,
    context?: LogContext
  ): Promise<T> {
    const start = performance.now();
    const ctx = { ...context, operation };

    try {
      this.debug(`Starting ${operation}`, ctx);
      const result = await fn();
      const duration = performance.now() - start;
      this.info(`Completed ${operation}`, { ...ctx, duration });
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      const error = err instanceof Error ? err : new Error(String(err));
      this.error(`Failed ${operation}`, error, { ...ctx, duration });
      throw err;
    }
  }

  /**
   * Time a sync operation and log the result
   */
  timeSync<T>(
    operation: string,
    fn: () => T,
    context?: LogContext
  ): T {
    const start = performance.now();
    const ctx = { ...context, operation };

    try {
      this.debug(`Starting ${operation}`, ctx);
      const result = fn();
      const duration = performance.now() - start;
      this.info(`Completed ${operation}`, { ...ctx, duration });
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      const error = err instanceof Error ? err : new Error(String(err));
      this.error(`Failed ${operation}`, error, { ...ctx, duration });
      throw err;
    }
  }

  /**
   * Create a child logger with preset context
   */
  child(context: LogContext): ChildLogger {
    return new ChildLogger(this, context);
  }

  /**
   * Set the log level at runtime
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.config.level;
  }
}

/**
 * Child logger with preset context
 */
class ChildLogger {
  constructor(
    private parent: Logger,
    private context: LogContext
  ) {}

  private mergeContext(additionalContext?: LogContext): LogContext {
    return { ...this.context, ...additionalContext };
  }

  debug(message: string, context?: LogContext): void {
    this.parent.debug(message, this.mergeContext(context));
  }

  info(message: string, context?: LogContext): void {
    this.parent.info(message, this.mergeContext(context));
  }

  warn(message: string, context?: LogContext): void {
    this.parent.warn(message, this.mergeContext(context));
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.parent.error(message, error, this.mergeContext(context));
  }

  async time<T>(
    operation: string,
    fn: () => Promise<T>,
    context?: LogContext
  ): Promise<T> {
    return this.parent.time(operation, fn, this.mergeContext(context));
  }

  timeSync<T>(
    operation: string,
    fn: () => T,
    context?: LogContext
  ): T {
    return this.parent.timeSync(operation, fn, this.mergeContext(context));
  }

  child(context: LogContext): ChildLogger {
    return new ChildLogger(this.parent, this.mergeContext(context));
  }
}

// Singleton logger instance
export const logger = new Logger();

// Export Logger class for testing/custom instances
export { Logger, ChildLogger };

// Convenience functions
export const log = {
  debug: (message: string, context?: LogContext) => logger.debug(message, context),
  info: (message: string, context?: LogContext) => logger.info(message, context),
  warn: (message: string, context?: LogContext) => logger.warn(message, context),
  error: (message: string, error?: Error, context?: LogContext) => logger.error(message, error, context),
  time: <T>(operation: string, fn: () => Promise<T>, context?: LogContext) => logger.time(operation, fn, context),
  timeSync: <T>(operation: string, fn: () => T, context?: LogContext) => logger.timeSync(operation, fn, context),
};
