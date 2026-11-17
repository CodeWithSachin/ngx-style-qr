import type { QrEcLevel } from '../style-qr.types';

/**
 * The one hardcoded table in this library: error-correction codewords per block,
 * indexed `[level][version - 1]`. Everything else (total capacity, block sizes,
 * alignment-pattern positions, Galois tables) is derived at runtime.
 */
const ECC_PER_BLOCK: Readonly<Record<QrEcLevel, readonly number[]>> = {
  // prettier-ignore
  L: [ 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
      28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // prettier-ignore
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
      26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  // prettier-ignore
  Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30,
      28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // prettier-ignore
  H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28,
      30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

/** Number of error-correction blocks, indexed `[level][version - 1]`. */
const NUM_BLOCKS: Readonly<Record<QrEcLevel, readonly number[]>> = {
  // prettier-ignore
  L: [ 1,  1,  1,  1,  1,  2,  2,  2,  2,  4,  4,  4,  4,  4,  6,  6,  6,  6,  7,  8,
       8,  9,  9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  // prettier-ignore
  M: [ 1,  1,  1,  2,  2,  4,  4,  4,  5,  5,  5,  8,  9,  9, 10, 10, 11, 13, 14, 16,
      17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  // prettier-ignore
  Q: [ 1,  1,  2,  2,  4,  4,  6,  6,  8,  8,  8, 10, 12, 16, 12, 17, 16, 18, 21, 20,
      23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  // prettier-ignore
  H: [ 1,  1,  2,  4,  4,  4,  5,  6,  8,  8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25,
      25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/** 2-bit level indicator used in the format-information bits. */
export const EC_FORMAT_BITS: Readonly<Record<QrEcLevel, number>> = { L: 1, M: 0, Q: 3, H: 2 };

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

/** Side length in modules for a given version. */
export function versionSize(version: number): number {
  return version * 4 + 17;
}

/**
 * Modules available to data + EC codewords, i.e. every module that is not part of
 * a function pattern. Derived from the version geometry rather than tabulated.
 */
export function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** Total codewords (data + EC) a version holds. */
export function totalCodewords(version: number): number {
  return rawDataModules(version) >>> 3;
}

/** EC codewords per block and block count for a version/level pair. */
export function eccInfo(version: number, ec: QrEcLevel): { ecPerBlock: number; numBlocks: number } {
  return { ecPerBlock: ECC_PER_BLOCK[ec][version - 1], numBlocks: NUM_BLOCKS[ec][version - 1] };
}

/** Codewords left for actual data once error correction takes its cut. */
export function dataCodewords(version: number, ec: QrEcLevel): number {
  const { ecPerBlock, numBlocks } = eccInfo(version, ec);
  return totalCodewords(version) - ecPerBlock * numBlocks;
}

/**
 * Centre coordinates of the alignment patterns.
 *
 * Version 1 has none; version 32 is the one irregular case in the spec and needs
 * a hardcoded step of 26.
 */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}
