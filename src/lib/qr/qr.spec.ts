import jsQR from 'jsqr';

import type { QrCode, QrEcLevel } from '../style-qr.types';
import { encodeQr } from './matrix';
import { dataCodewords } from './tables';

/**
 * The encoder is checked by round-tripping through a real decoder (`jsqr`, a
 * dev-only dependency never imported by the library). One assertion covers mode
 * selection, Reed–Solomon, block splitting, interleaving, zigzag placement,
 * masking and the format/version bits at once.
 *
 * Comparing matrices against another *encoder* would not work: the spec lets any
 * mask be chosen, and implementations legitimately disagree — `qrcode-generator`,
 * for one, still uses the pre-2006 penalty rule 3.
 */
const SCALE = 3;
const QUIET = 4;

/** Rasterise a symbol into RGBA pixels with a quiet zone, the way a scanner sees it. */
function decode(qr: QrCode): string | null {
  const dim = (qr.size + QUIET * 2) * SCALE;
  const pixels = new Uint8ClampedArray(dim * dim * 4).fill(0xff);
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y][x]) continue;
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const px = ((x + QUIET) * SCALE + dx + ((y + QUIET) * SCALE + dy) * dim) * 4;
          pixels[px] = pixels[px + 1] = pixels[px + 2] = 0;
        }
      }
    }
  }
  return jsQR(pixels, dim, dim)?.data ?? null;
}

const LEVELS: QrEcLevel[] = ['L', 'M', 'Q', 'H'];

describe('encodeQr', () => {
  const corpus: [label: string, data: string][] = [
    ['single digit', '7'],
    ['long numeric', '0123456789'.repeat(4)],
    ['alphanumeric', 'HELLO WORLD'],
    ['alphanumeric url', 'HTTPS://SACHINSINGH.ME/QR'],
    ['byte url', 'https://sachinsingh.me'],
    ['utf-8 devanagari', 'क्षत्रिय — शौर्यम्'],
    ['1000 bytes', 'x'.repeat(1000)],
  ];

  for (const [label, data] of corpus) {
    for (const ec of LEVELS) {
      it(`round-trips through a decoder — ${label} @ ${ec}`, () => {
        expect(decode(encodeQr(data, ec))).toBe(data);
      });
    }
  }

  it('round-trips every version from 1 to 40 at exact capacity', () => {
    for (let v = 1; v <= 40; v++) {
      // 4 mode bits + an 8- or 16-bit character count, rounded down to whole bytes.
      const capacity = dataCodewords(v, 'M') - (v <= 9 ? 2 : 3);
      const payload = 'a'.repeat(capacity);
      const qr = encodeQr(payload, 'M');

      // Landing on exactly v proves the capacity derivation is not over-generous...
      expect(`v${v}:${qr.version}`).toBe(`v${v}:${v}`);
      expect(decode(qr)).toBe(payload);

      // ...and one more byte spilling into the next version proves it is not stingy.
      if (v < 40) expect(encodeQr(payload + 'a', 'M').version).toBeGreaterThan(v);
    }
  });

  it('picks the smallest version at every error-correction level', () => {
    for (const ec of LEVELS) {
      for (let v = 1; v <= 40; v++) {
        const capacity = dataCodewords(v, ec) - (v <= 9 ? 2 : 3);
        expect(`${ec}${v}:${encodeQr('a'.repeat(capacity), ec).version}`).toBe(`${ec}${v}:${v}`);
      }
    }
  });

  it('throws with a useful message when the payload cannot fit version 40', () => {
    expect(() => encodeQr('a'.repeat(3000), 'H')).toThrow(/data too long/);
  });

  it('lays down the mandated function patterns', () => {
    const qr = encodeQr('HELLO WORLD', 'Q');
    expect(qr.version).toBe(1);
    expect(qr.size).toBe(21);
    // Finder ring: dark border, light separator ring, dark core.
    expect(qr.modules[0][0]).toBe(true);
    expect(qr.modules[1][1]).toBe(false);
    expect(qr.modules[2][2]).toBe(true);
    expect(qr.modules[7][7]).toBe(false);
    // The always-dark module below the top-left finder.
    expect(qr.modules[qr.size - 8][8]).toBe(true);
    // Timing patterns alternate between the finders.
    for (let i = 8; i < qr.size - 8; i++) {
      expect(qr.modules[6][i]).toBe(i % 2 === 0);
      expect(qr.modules[i][6]).toBe(i % 2 === 0);
    }
  });
});
