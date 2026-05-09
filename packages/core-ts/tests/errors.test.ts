import { describe, it, expect } from 'vitest';
import {
  SqlMdSyncError,
  SchemaMismatchError,
  EncodingError,
  RoundTripError,
  ConfigError,
} from '../src/errors.js';

describe('error classes', () => {
  it('SqlMdSyncError has correct name and message', () => {
    const e = new SqlMdSyncError('base error');
    expect(e.message).toBe('base error');
    expect(e.name).toBe('SqlMdSyncError');
    expect(e).toBeInstanceOf(Error);
  });

  it('SchemaMismatchError is a SqlMdSyncError', () => {
    const e = new SchemaMismatchError('schema mismatch');
    expect(e.message).toBe('schema mismatch');
    expect(e.name).toBe('SchemaMismatchError');
    expect(e).toBeInstanceOf(SqlMdSyncError);
    expect(e).toBeInstanceOf(Error);
  });

  it('EncodingError without context', () => {
    const e = new EncodingError('encoding failed');
    expect(e.message).toBe('encoding failed');
    expect(e.name).toBe('EncodingError');
    expect(e).toBeInstanceOf(SqlMdSyncError);
  });

  it('EncodingError with file context', () => {
    const e = new EncodingError('bad encoding', 'data/users/0001-alice.md');
    expect(e.message).toContain('data/users/0001-alice.md');
    expect(e.file).toBe('data/users/0001-alice.md');
    expect(e.column).toBeUndefined();
  });

  it('EncodingError with file and column context', () => {
    const e = new EncodingError('bad value', 'data/users/0001-alice.md', 'email');
    expect(e.message).toContain('data/users/0001-alice.md');
    expect(e.message).toContain('email');
    expect(e.file).toBe('data/users/0001-alice.md');
    expect(e.column).toBe('email');
  });

  it('RoundTripError is a SqlMdSyncError', () => {
    const e = new RoundTripError('round-trip mismatch');
    expect(e.message).toBe('round-trip mismatch');
    expect(e.name).toBe('RoundTripError');
    expect(e).toBeInstanceOf(SqlMdSyncError);
  });

  it('ConfigError is a SqlMdSyncError', () => {
    const e = new ConfigError('bad config');
    expect(e.message).toBe('bad config');
    expect(e.name).toBe('ConfigError');
    expect(e).toBeInstanceOf(SqlMdSyncError);
  });
});
