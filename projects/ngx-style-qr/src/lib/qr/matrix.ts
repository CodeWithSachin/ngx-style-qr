import type { QrCode, QrEcLevel } from '../style-qr.types';
import { encodeToCodewords } from './encoder';
import { EC_FORMAT_BITS, alignmentPositions, versionSize } from './tables';

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/** The eight data-mask predicates from the spec, in order. */
const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/**
 * Encode a string into a QR symbol.
 *
 * ```ts
 * const qr = encodeQr('https://example.com', 'H');
 * qr.modules[0][0]; // true — top-left finder pattern
 * ```
 *
 * Throws if the payload does not fit version 40 at the requested EC level.
 */
export function encodeQr(data: string, ec: QrEcLevel = 'M'): QrCode {
  const { version, codewords } = encodeToCodewords(data, ec);
  const size = versionSize(version);

  const modules: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );
  // Parallel grid of function-pattern cells. Data placement and masking both skip
  // these — keeping the bookkeeping separate is what stops masking from corrupting
  // the finder/timing patterns.
  const isFn: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );

  const set = (x: number, y: number, dark: boolean): void => {
    modules[y][x] = dark;
    isFn[y][x] = true;
  };

  drawFunctionPatterns(modules, isFn, set, size, version, ec);
  drawCodewords(modules, isFn, size, codewords);

  // Try every mask, keep the least penalised, then re-apply it (XOR is its own inverse).
  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(modules, isFn, size, mask);
    drawFormatBits(set, size, ec, mask);
    const penalty = penaltyScore(modules, size);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
    applyMask(modules, isFn, size, mask);
  }
  applyMask(modules, isFn, size, bestMask);
  drawFormatBits(set, size, ec, bestMask);

  return { version, size, modules };
}

// ---------------------------------------------------------------------------
// Function patterns
// ---------------------------------------------------------------------------

type SetFn = (x: number, y: number, dark: boolean) => void;

function drawFunctionPatterns(
  modules: boolean[][],
  isFn: boolean[][],
  set: SetFn,
  size: number,
  version: number,
  ec: QrEcLevel,
): void {
  // Timing patterns.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Finder patterns plus their separators (the 9×9 neighbourhood of each centre).
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  // Alignment patterns, skipping the three that would collide with finders.
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(positions[i] + dx, positions[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Reserve the format area (mask 0 is a placeholder; the real bits land later).
  drawFormatBits(set, size, ec, 0);
  drawVersionBits(set, size, version);
}

/** Format information: 5 data bits, BCH(15,5), masked with 0x5412, written twice. */
function drawFormatBits(set: SetFn, size: number, ec: QrEcLevel, mask: number): void {
  const data = (EC_FORMAT_BITS[ec] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = (((data << 10) | rem) ^ 0x5412) >>> 0;
  const bit = (i: number): boolean => ((bits >>> i) & 1) !== 0;

  // First copy: around the top-left finder.
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));

  // Second copy: split between the other two finders.
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true); // the always-dark module
}

/** Version information: 6 data bits, BCH(18,6). Only present from version 7. */
function drawVersionBits(set: SetFn, size: number, version: number): void {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    set(a, b, dark);
    set(b, a, dark);
  }
}

// ---------------------------------------------------------------------------
// Data placement, masking, penalty
// ---------------------------------------------------------------------------

/** Zigzag upward/downward through 2-module-wide columns, right to left. */
function drawCodewords(
  modules: boolean[][],
  isFn: boolean[][],
  size: number,
  codewords: Uint8Array,
): void {
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y][x] && i < codewords.length * 8) {
          modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
        // Remaining modules stay light — that is exactly the spec's remainder bits.
      }
    }
  }
}

function applyMask(modules: boolean[][], isFn: boolean[][], size: number, mask: number): void {
  const fn = MASKS[mask];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFn[y][x] && fn(x, y)) modules[y][x] = !modules[y][x];
    }
  }
}

function penaltyScore(modules: boolean[][], size: number): number {
  let result = 0;

  const addHistory = (runLength: number, history: number[]): void => {
    if (history[0] === 0) runLength += size; // the implicit light border before the first run
    history.pop();
    history.unshift(runLength);
  };
  const countPatterns = (h: number[]): number => {
    const n = h[1];
    const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (
      (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0)
    );
  };
  const terminate = (runColor: boolean, runLength: number, history: number[]): number => {
    if (runColor) {
      addHistory(runLength, history);
      runLength = 0;
    }
    addHistory(runLength + size, history); // implicit light border after the last run
    return countPatterns(history);
  };

  // Rules 1 and 3, scanned along rows then columns.
  for (const byRow of [true, false]) {
    for (let a = 0; a < size; a++) {
      let runColor = false;
      let runLength = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let b = 0; b < size; b++) {
        const cell = byRow ? modules[a][b] : modules[b][a];
        if (cell === runColor) {
          runLength++;
          if (runLength === 5) result += PENALTY_N1;
          else if (runLength > 5) result++;
        } else {
          addHistory(runLength, history);
          if (!runColor) result += countPatterns(history) * PENALTY_N3;
          runColor = cell;
          runLength = 1;
        }
      }
      result += terminate(runColor, runLength, history) * PENALTY_N3;
    }
  }

  // Rule 2: uniform 2×2 blocks.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
        result += PENALTY_N2;
      }
    }
  }

  // Rule 4: deviation from a 50/50 dark ratio.
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark++;
  const total = size * size;
  result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * PENALTY_N4;

  return result;
}
