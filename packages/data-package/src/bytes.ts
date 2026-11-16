import { DataPackageFormatError } from './errors';

/**
 * Stream chunks arrive typed `Uint8Array` but a hostile or buggy source can hand over anything: a string
 * has `.length` but no `byteLength`, an ArrayBuffer has `byteLength` but no `.length`, and `NaN > limit`
 * is false, which would silently switch a size limit off. Every consumer of a stream goes through this.
 */
export function toBytes(chunk: Uint8Array): Uint8Array {
  if (!ArrayBuffer.isView(chunk)) throw new DataPackageFormatError('stream_chunk_invalid', 'a stream chunk is not a byte array');
  if (chunk instanceof Uint8Array) return chunk;
  return new Uint8Array((chunk as ArrayBufferView).buffer, (chunk as ArrayBufferView).byteOffset, (chunk as ArrayBufferView).byteLength);
}

/** A finite positive integer, or a typed error (an `NaN` or `Infinity` limit would disable the check it configures). */
export function assertPositiveInt(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new DataPackageFormatError('limit_invalid', `${name} must be a positive safe integer`);
  return value;
}
