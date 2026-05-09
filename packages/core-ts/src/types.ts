export interface TableConfig {
  pk: string;
  bodyColumns: string[];
  displayColumn?: string;
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
