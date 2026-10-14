/**
 * @file logcat.ts
 * @description Zero-dependency Android Logcat structured logging engine for ygo-sim-core.
 * Formats messages into official Logcat format:
 *   MM-DD HH:mm:ss.SSS <PID> <TID> <PRIORITY>/<TAG>: <MESSAGE>
 * Writes to execution-differentiated log files (logs/ygo-sim-core_YYYYMMDD_HHMMSS_<PID>.log)
 * and supports correlation signatures ([LINE#<idx>:<hash>]) for grep-friendly filtering.
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export type LogPriority = 'V' | 'D' | 'I' | 'W' | 'E';
export type LogLevel = 'VERBOSE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'SILENT';

const PRIORITY_LEVELS: Record<LogPriority, number> = {
  V: 0,
  D: 1,
  I: 2,
  W: 3,
  E: 4
};

const LOG_LEVEL_MAP: Record<LogLevel, number> = {
  VERBOSE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  SILENT: 99
};

export interface LogcatOptions {
  logDir?: string;
  logFilePath?: string;
  logLevel?: LogLevel;
  enableConsole?: boolean;
  enableFile?: boolean;
  tid?: number;
}

export class LogcatLogger {
  private static instance: LogcatLogger | null = null;
  private logFilePath: string | null = null;
  private logLevel: LogLevel = 'DEBUG';
  private enableConsole: boolean = false;
  private enableFile: boolean = true;
  private pid: number = process.pid;
  private tid: number = 1;

  constructor(options: LogcatOptions = {}) {
    this.configure(options);
  }

  public static getInstance(options?: LogcatOptions): LogcatLogger {
    if (!LogcatLogger.instance) {
      LogcatLogger.instance = new LogcatLogger(options);
    } else if (options) {
      LogcatLogger.instance.configure(options);
    }
    return LogcatLogger.instance;
  }

  /**
   * Reset instance (mainly for isolated hermetic testing).
   */
  public static resetInstance(): void {
    LogcatLogger.instance = null;
  }

  /**
   * Configure or reconfigure the active logger session.
   */
  public configure(options: LogcatOptions = {}): void {
    if (options.logLevel) {
      this.logLevel = options.logLevel;
    }
    if (options.enableConsole !== undefined) {
      this.enableConsole = options.enableConsole;
    }
    if (options.enableFile !== undefined) {
      this.enableFile = options.enableFile;
    }
    if (options.tid !== undefined) {
      this.tid = options.tid;
    }

    if (this.enableFile && !this.logFilePath) {
      if (options.logFilePath) {
        this.logFilePath = resolve(options.logFilePath);
      } else {
        const dir = options.logDir ? resolve(options.logDir) : resolve(process.cwd(), 'logs');
        const timestamp = this.formatFileTimestamp(new Date());
        this.logFilePath = resolve(dir, `ygo-sim-core_${timestamp}_${this.pid}.log`);
      }

      // Ensure target directory exists
      const parentDir = dirname(this.logFilePath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      // Write session header
      const startHeader = `--------- beginning of main\n${this.formatLine(
        'I',
        'SimCore:Logcat',
        `Logcat session initiated. Log file: ${this.logFilePath} (PID: ${this.pid}, Level: ${this.logLevel})`
      )}\n`;
      try {
        appendFileSync(this.logFilePath, startHeader, 'utf-8');
      } catch {
        // Fallback gracefully if filesystem write is blocked
      }
    }
  }

  public getLogFilePath(): string | null {
    return this.logFilePath;
  }

  public getLogLevel(): LogLevel {
    return this.logLevel;
  }

  public setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Format a single logcat entry:
   *   MM-DD HH:mm:ss.SSS <PID> <TID> P/Tag: [LineSignature] Message
   */
  public formatLine(
    priority: LogPriority,
    tag: string,
    message: string,
    lineSignature?: string,
    date: Date = new Date()
  ): string {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');

    const timestamp = `${mm}-${dd} ${hh}:${min}:${ss}.${ms}`;
    const pidStr = String(this.pid).padStart(5, ' ');
    const tidStr = String(this.tid).padStart(4, ' ');
    const tagSection = `${priority}/${tag}`;
    const sigSection = lineSignature ? `[${lineSignature}] ` : '';

    return `${timestamp} ${pidStr} ${tidStr} ${tagSection}: ${sigSection}${message}`;
  }

  /**
   * Log a message with the specified priority and tag.
   */
  public log(
    priority: LogPriority,
    tag: string,
    message: string,
    lineSignature?: string
  ): string | null {
    const priorityVal = PRIORITY_LEVELS[priority];
    const thresholdVal = LOG_LEVEL_MAP[this.logLevel];

    if (priorityVal < thresholdVal) {
      return null;
    }

    const formatted = this.formatLine(priority, tag, message, lineSignature);

    if (this.enableConsole) {
      if (priority === 'E') {
        console.error(formatted);
      } else if (priority === 'W') {
        console.warn(formatted);
      } else {
        console.log(formatted);
      }
    }

    if (this.enableFile && this.logFilePath) {
      try {
        appendFileSync(this.logFilePath, formatted + '\n', 'utf-8');
      } catch {
        // Suppress secondary logging failures
      }
    }

    return formatted;
  }

  public v(tag: string, message: string, lineSignature?: string): string | null {
    return this.log('V', tag, message, lineSignature);
  }

  public d(tag: string, message: string, lineSignature?: string): string | null {
    return this.log('D', tag, message, lineSignature);
  }

  public i(tag: string, message: string, lineSignature?: string): string | null {
    return this.log('I', tag, message, lineSignature);
  }

  public w(tag: string, message: string, lineSignature?: string): string | null {
    return this.log('W', tag, message, lineSignature);
  }

  public e(tag: string, message: string, error?: unknown, lineSignature?: string): string | null {
    let msg = message;
    if (error) {
      if (error instanceof Error) {
        msg += ` | Error: ${error.message}\n${error.stack ?? ''}`;
      } else {
        msg += ` | Details: ${String(error)}`;
      }
    }
    return this.log('E', tag, msg, lineSignature);
  }

  private formatFileTimestamp(d: Date): string {
    const yyyy = String(d.getFullYear());
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
  }
}

// Global convenience facade
export const Logcat = {
  configure: (options?: LogcatOptions): LogcatLogger => LogcatLogger.getInstance(options),
  getLogFilePath: (): string | null => LogcatLogger.getInstance().getLogFilePath(),
  getLogLevel: (): LogLevel => LogcatLogger.getInstance().getLogLevel(),
  setLogLevel: (level: LogLevel): void => LogcatLogger.getInstance().setLogLevel(level),
  v: (tag: string, msg: string, lineSig?: string) => LogcatLogger.getInstance().v(tag, msg, lineSig),
  d: (tag: string, msg: string, lineSig?: string) => LogcatLogger.getInstance().d(tag, msg, lineSig),
  i: (tag: string, msg: string, lineSig?: string) => LogcatLogger.getInstance().i(tag, msg, lineSig),
  w: (tag: string, msg: string, lineSig?: string) => LogcatLogger.getInstance().w(tag, msg, lineSig),
  e: (tag: string, msg: string, err?: unknown, lineSig?: string) =>
    LogcatLogger.getInstance().e(tag, msg, err, lineSig)
};
