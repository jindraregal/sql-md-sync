export interface TableConfig {
  pk: string;
  bodyColumns: string[];
  displayColumn?: string;
  largeTextThreshold?: number;
  excludeColumns?: string[];
}

export type BlobEncoding = 'binary_sidecar' | 'base64_sidecar';

export interface SyncConfig {
  version: number;
  largeTextThreshold: number;
  tables: Record<string, TableConfig>;
  schemaFingerprint: string;
  dbPath?: string;
  dataDir?: string;
  schemaDir?: string;
  blobEncoding?: BlobEncoding;
  commitTemplate?: string;
}

// Raw JSON shape (snake_case, as stored on disk)
export interface RawTableConfig {
  body_columns?: string[];
  display_column?: string;
  large_text_threshold?: number;
  exclude_columns?: string[];
}

export interface RawSyncConfig {
  version: number;
  db_path?: string;
  data_dir?: string;
  schema_dir?: string;
  tables?: Record<string, RawTableConfig>;
  blob_encoding?: BlobEncoding;
  commit_template?: string;
  schema_fingerprint?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface TableMeta {
  table: string;
  rowCount: number;
  pk: string;
  indexes: IndexInfo[];
}

export type RowData = Record<string, unknown>;
