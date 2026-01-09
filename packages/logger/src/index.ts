export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export interface LogContext {
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service?: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface LoggerConfig {
  service?: string;
  level?: LogLevel;
  pretty?: boolean;
  redactKeys?: string[];
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

// Keys to redact from logs (security)
const DEFAULT_REDACT_KEYS = [
  "password",
  "token",
  "secret",
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
  "creditCard",
  "credit_card",
  "ssn",
  "otp",
];

class Logger {
  private service: string;
  private level: LogLevel;
  private pretty: boolean;
  private redactKeys: Set<string>;

  constructor(config: LoggerConfig = {}) {
    this.service = config.service || "app";
    this.level = config.level || (process.env.LOG_LEVEL as LogLevel) || "info";
    this.pretty = config.pretty ?? process.env.NODE_ENV !== "production";
    this.redactKeys = new Set([
      ...DEFAULT_REDACT_KEYS,
      ...(config.redactKeys || []),
    ]);
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private redact(obj: unknown, depth = 0): unknown {
    if (depth > 10) return "[MAX_DEPTH]";
    
    if (obj === null || obj === undefined) return obj;
    
    if (typeof obj === "string") return obj;
    
    if (Array.isArray(obj)) {
      return obj.map((item) => this.redact(item, depth + 1));
    }
    
    if (typeof obj === "object") {
      const redacted: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (this.redactKeys.has(key.toLowerCase())) {
          redacted[key] = "[REDACTED]";
        } else {
          redacted[key] = this.redact(value, depth + 1);
        }
      }
      return redacted;
    }
    
    return obj;
  }

  private formatError(error: Error): LogEntry["error"] {
    return {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV !== "production" ? error.stack : undefined,
    };
  }

  private formatPretty(entry: LogEntry): string {
    const colors = {
      debug: "\x1b[36m", // cyan
      info: "\x1b[32m",  // green
      warn: "\x1b[33m",  // yellow
      error: "\x1b[31m", // red
      fatal: "\x1b[35m", // magenta
      reset: "\x1b[0m",
      dim: "\x1b[2m",
      bold: "\x1b[1m",
    };

    const levelColor = colors[entry.level];
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const level = entry.level.toUpperCase().padEnd(5);
    const service = entry.service ? `[${entry.service}]` : "";
    
    let output = `${colors.dim}${time}${colors.reset} ${levelColor}${level}${colors.reset} ${colors.bold}${service}${colors.reset} ${entry.message}`;
    
    if (entry.context && Object.keys(entry.context).length > 0) {
      output += ` ${colors.dim}${JSON.stringify(entry.context)}${colors.reset}`;
    }
    
    if (entry.error) {
      output += `\n${colors.dim}  Error: ${entry.error.name}: ${entry.error.message}${colors.reset}`;
      if (entry.error.stack) {
        output += `\n${colors.dim}${entry.error.stack}${colors.reset}`;
      }
    }
    
    return output;
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.service,
    };

    if (context) {
      entry.context = this.redact(context) as LogContext;
    }

    if (error) {
      entry.error = this.formatError(error);
    }

    const output = this.pretty ? this.formatPretty(entry) : JSON.stringify(entry);

    switch (level) {
      case "debug":
      case "info":
        console.log(output);
        break;
      case "warn":
        console.warn(output);
        break;
      case "error":
      case "fatal":
        console.error(output);
        break;
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log("warn", message, context);
  }

  error(message: string, error?: Error | LogContext, context?: LogContext): void {
    if (error instanceof Error) {
      this.log("error", message, context, error);
    } else {
      this.log("error", message, error);
    }
  }

  fatal(message: string, error?: Error | LogContext, context?: LogContext): void {
    if (error instanceof Error) {
      this.log("fatal", message, context, error);
    } else {
      this.log("fatal", message, error);
    }
  }

  child(config: Partial<LoggerConfig>): Logger {
    return new Logger({
      service: config.service || this.service,
      level: config.level || this.level,
      pretty: config.pretty ?? this.pretty,
      redactKeys: [...this.redactKeys, ...(config.redactKeys || [])],
    });
  }

  // HTTP request logging helper
  request(method: string, path: string, statusCode: number, durationMs: number, context?: LogContext): void {
    const level: LogLevel = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
    this.log(level, `${method} ${path} ${statusCode} ${durationMs}ms`, context);
  }
}

// Default logger instance
export const logger = new Logger({ service: "tails" });

// Factory function for creating service-specific loggers
export function createLogger(service: string, config?: Omit<LoggerConfig, "service">): Logger {
  return new Logger({ ...config, service });
}

// Export the Logger class for type usage
export { Logger };