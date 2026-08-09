import type { QrEcLevel } from '../style-qr.types';
import { MAX_VERSION, MIN_VERSION, dataCodewords, eccInfo, totalCodewords } from './tables';

/** Encodable segment modes. Kanji is deliberately absent — see `pickMode`. */
type Mode = 'numeric' | 'alphanumeric' | 'byte';

const MODE_INDICATOR: Record<Mode, number> = { numeric: 1, alphanumeric: 2, byte: 4 };

/** Character-count field width, per mode, for versions 1–9 / 10–26 / 27–40. */
const COUNT_BITS: Record<Mode, [number, number, number]> = {
  numeric: [10, 12, 14],
  alphanumeric: [9, 11, 13],
  byte: [8, 16, 16],
};

const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

// ---------------------------------------------------------------------------
// GF(256) — built once at module load, primitive polynomial 0x11D.
// ---------------------------------------------------------------------------

const EXP = new Uint8Array(256);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[(LOG[a] + LOG[b]) % 255];
}

/** Reed–Solomon generator polynomial of the given degree, highest term omitted. */
function rsGenerator(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

/** The EC codewords for one data block. */
function rsRemainder(data: Uint8Array, generator: Uint8Array): Uint8Array {
  const result = new Uint8Array(generator.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < result.length; i++) result[i] ^= gfMul(generator[i], factor);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Segment encoding
// ---------------------------------------------------------------------------

/**
 * Cheapest mode that can represent the whole string.
 *
 * ponytail: single segment only — no optimal segment splitting, and no kanji mode.
 * Mixed content costs at most one version bump; add splitting if a consumer is
 * actually bumping into the version-40 ceiling.
 */
function pickMode(data: string): Mode {
  if (/^[0-9]*$/.test(data)) return 'numeric';
  for (const ch of data) if (!ALPHANUMERIC.includes(ch)) return 'byte';
  return 'alphanumeric';
}

function countBits(mode: Mode, version: number): number {
  return COUNT_BITS[mode][version <= 9 ? 0 : version <= 26 ? 1 : 2];
}

/** Bits the payload itself occupies, excluding mode indicator and count field. */
function payloadBits(mode: Mode, data: string, bytes: Uint8Array): number {
  if (mode === 'numeric') {
    const rem = data.length % 3;
    return Math.floor(data.length / 3) * 10 + (rem === 0 ? 0 : rem === 1 ? 4 : 7);
  }
  if (mode === 'alphanumeric') {
    return Math.floor(data.length / 2) * 11 + (data.length % 2) * 6;
  }
  return bytes.length * 8;
}

/** Number of characters/bytes the count field must express. */
function charCount(mode: Mode, data: string, bytes: Uint8Array): number {
  return mode === 'byte' ? bytes.length : data.length;
}

/** Growable MSB-first bit buffer. */
class BitBuffer {
  readonly bits: number[] = [];

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

function writeSegment(bb: BitBuffer, mode: Mode, data: string, bytes: Uint8Array): void {
  if (mode === 'numeric') {
    for (let i = 0; i < data.length; i += 3) {
      const chunk = data.slice(i, i + 3);
      bb.push(Number(chunk), chunk.length * 3 + 1);
    }
  } else if (mode === 'alphanumeric') {
    for (let i = 0; i < data.length; i += 2) {
      const a = ALPHANUMERIC.indexOf(data[i]);
      if (i + 1 < data.length) bb.push(a * 45 + ALPHANUMERIC.indexOf(data[i + 1]), 11);
      else bb.push(a, 6);
    }
  } else {
    for (const b of bytes) bb.push(b, 8);
  }
}

// ---------------------------------------------------------------------------

export interface EncodedData {
  version: number;
  /** Interleaved data + EC codewords, ready for zigzag placement. */
  codewords: Uint8Array;
}

/**
 * Encode a string into the final, interleaved codeword stream and the smallest
 * version that holds it.
 *
 * Throws when the payload exceeds version 40 at the requested EC level.
 */
export function encodeToCodewords(data: string, ec: QrEcLevel): EncodedData {
  const mode = pickMode(data);
  const bytes = mode === 'byte' ? new TextEncoder().encode(data) : new Uint8Array(0);
  const body = payloadBits(mode, data, bytes);

  let version = 0;
  for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
    if (4 + countBits(mode, v) + body <= dataCodewords(v, ec) * 8) {
      version = v;
      break;
    }
  }
  if (version === 0) {
    const limit = dataCodewords(MAX_VERSION, ec) * 8 - 4 - countBits(mode, MAX_VERSION);
    throw new Error(
      `ngx-style-qr: data too long — needs ${body} bits, version 40 level ${ec} holds ${limit}.`,
    );
  }

  const capacityBits = dataCodewords(version, ec) * 8;
  const bb = new BitBuffer();
  bb.push(MODE_INDICATOR[mode], 4);
  bb.push(charCount(mode, data, bytes), countBits(mode, version));
  writeSegment(bb, mode, data, bytes);

  // Terminator, then pad to a byte boundary, then alternating pad codewords.
  bb.push(0, Math.min(4, capacityBits - bb.bits.length));
  bb.push(0, (8 - (bb.bits.length % 8)) % 8);
  for (let pad = 0xec; bb.bits.length < capacityBits; pad ^= 0xec ^ 0x11) bb.push(pad, 8);

  const dataBytes = new Uint8Array(capacityBits / 8);
  bb.bits.forEach((bit, i) => (dataBytes[i >>> 3] |= bit << (7 - (i & 7))));

  return { version, codewords: interleave(dataBytes, version, ec) };
}

/** Split into blocks, Reed–Solomon each, then interleave data then EC codewords. */
function interleave(dataBytes: Uint8Array, version: number, ec: QrEcLevel): Uint8Array {
  const { ecPerBlock, numBlocks } = eccInfo(version, ec);
  const generator = rsGenerator(ecPerBlock);
  const shortLen = Math.floor(dataBytes.length / numBlocks);
  const numShort = numBlocks - (dataBytes.length % numBlocks);

  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  for (let i = 0, offset = 0; i < numBlocks; i++) {
    const len = shortLen + (i < numShort ? 0 : 1);
    const block = dataBytes.subarray(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(rsRemainder(block, generator));
  }

  const result = new Uint8Array(totalCodewords(version));
  let k = 0;
  for (let i = 0; i <= shortLen; i++)
    for (const block of dataBlocks) if (i < block.length) result[k++] = block[i];
  for (let i = 0; i < ecPerBlock; i++) for (const block of ecBlocks) result[k++] = block[i];
  return result;
}
