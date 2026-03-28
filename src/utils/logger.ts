type LogLevel = 'query' | 'info' | 'warn' | 'error';

const COLORS = {
  query: '\x1b[36m',   // cyan
  info:  '\x1b[32m',   // green
  warn:  '\x1b[33m',   // yellow
  error: '\x1b[31m',   // red
  reset: '\x1b[0m',
  dim:   '\x1b[2m',
};

export class Logger {
  private enabled: boolean;

  constructor(enabled: boolean = false) {
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  query(sql: string, params?: any[], duration?: number): void {
    if (!this.enabled) return;
    const time = duration !== undefined ? ` ${COLORS.dim}+${duration}ms${COLORS.reset}` : '';
    console.log(
      `${COLORS.query}[QuickORM:query]${COLORS.reset} ${sql}${
        params?.length ? `\n  params: ${JSON.stringify(params)}` : ''
      }${time}`
    );
  }

  info(message: string): void {
    if (!this.enabled) return;
    console.log(`${COLORS.info}[QuickORM:info]${COLORS.reset} ${message}`);
  }

  warn(message: string): void {
    console.warn(`${COLORS.warn}[QuickORM:warn]${COLORS.reset} ${message}`);
  }

  error(message: string, err?: Error): void {
    console.error(`${COLORS.error}[QuickORM:error]${COLORS.reset} ${message}`, err ?? '');
  }
}

export const logger = new Logger();
