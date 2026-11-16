/**
 * One error type for every parser in this directory. Each parser is a trust boundary: its input may be
 * an uploaded file, so failures are typed (`code`) and carry a short, value-free message. Callers map
 * the code to their own response; nothing here echoes attacker-controlled text beyond a line number.
 */
export type FormatErrorCode =
  | 'entry_name_invalid'
  | 'entry_name_duplicate'
  | 'volume_name_invalid'
  | 'limit_invalid'
  | 'checksums_invalid'
  | 'manifest_too_large'
  | 'manifest_invalid'
  | 'manifest_not_canonical'
  | 'format_version_newer'
  | 'json_invalid'
  | 'json_unsafe'
  | 'ndjson_line_too_long'
  | 'ndjson_invalid_utf8'
  | 'ndjson_bom'
  | 'ndjson_crlf'
  | 'ndjson_blank_line'
  | 'ndjson_truncated'
  | 'ndjson_not_object'
  | 'ndjson_too_many_rows'
  | 'ndjson_not_canonical'
  | 'ndjson_row_unwritable'
  | 'stream_too_large'
  | 'stream_incomplete'
  | 'stream_chunk_invalid'
  | 'hasher_finished'
  | 'fingerprint_invalid'
  | 'media_index_invalid';

export class DataPackageFormatError extends Error {
  readonly code: FormatErrorCode;
  constructor(code: FormatErrorCode, message: string) {
    super(message);
    this.name = 'DataPackageFormatError';
    this.code = code;
  }
}
