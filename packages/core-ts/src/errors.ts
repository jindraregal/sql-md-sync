export class SqlMdSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlMdSyncError';
  }
}

export class SchemaMismatchError extends SqlMdSyncError {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaMismatchError';
  }
}

export class EncodingError extends SqlMdSyncError {
  constructor(
    message: string,
    public readonly file?: string,
    public readonly column?: string
  ) {
    const ctx =
      file || column ? ` (${[file, column].filter(Boolean).join(':')})` : '';
    super(message + ctx);
    this.name = 'EncodingError';
  }
}

export class RoundTripError extends SqlMdSyncError {
  constructor(message: string) {
    super(message);
    this.name = 'RoundTripError';
  }
}

export class ConfigError extends SqlMdSyncError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
