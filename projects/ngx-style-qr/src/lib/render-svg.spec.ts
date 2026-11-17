import { encodeQr } from './qr/matrix';
import { buildSvgModel } from './render-svg';
import type { QrGradient, StyleQrOptions } from './style-qr.types';

const BASE: StyleQrOptions = {
  margin: 4,
  moduleShape: 'square',
  eyeShape: 'square',
  color: '#000',
  bgColor: 'transparent',
  eyeColor: null,
  eyeInnerColor: null,
  logo: null,
};

const qr = encodeQr('https://sachinsingh.me', 'H');

/** Every module shape emits exactly one subpath per module, so `M` counts them. */
const subpaths = (d: string): number => (d.match(/M/g) ?? []).length;

const inEye = (x: number, y: number): boolean =>
  (x < 7 && y < 7) || (x >= qr.size - 7 && y < 7) || (x < 7 && y >= qr.size - 7);

function darkOutsideEyes(): number {
  let count = 0;
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) if (qr.modules[y][x] && !inEye(x, y)) count++;
  }
  return count;
}

describe('buildSvgModel', () => {
  it('sizes the viewBox to the symbol plus the quiet zone on both sides', () => {
    expect(buildSvgModel(qr, BASE).viewBox).toBe(`0 0 ${qr.size + 8} ${qr.size + 8}`);
    expect(buildSvgModel(qr, { ...BASE, margin: 0 }).viewBox).toBe(`0 0 ${qr.size} ${qr.size}`);
  });

  it('draws every dark module outside the finders, and the finders separately', () => {
    const model = buildSvgModel(qr, BASE);
    expect(subpaths(model.modules)).toBe(darkOutsideEyes());
    // Three rings, each an outline plus its counter-path; three centres.
    expect(subpaths(model.eyeOuter)).toBe(6);
    expect(subpaths(model.eyeInner)).toBe(3);
  });

  it('keeps the module count stable across shapes', () => {
    for (const moduleShape of ['dots', 'rounded', 'smooth'] as const) {
      expect(subpaths(buildSvgModel(qr, { ...BASE, moduleShape }).modules)).toBe(darkOutsideEyes());
    }
  });

  it('erases modules under the logo and places it centred', () => {
    const model = buildSvgModel(qr, { ...BASE, logo: { src: 'data:,x', size: 0.2, padding: 1 } });
    expect(subpaths(model.modules)).toBeLessThan(darkOutsideEyes());
    expect(model.logo).not.toBeNull();
    // Symmetric: the gaps left and right of the logo box are equal.
    expect(model.logo!.x + model.logo!.size / 2).toBeCloseTo((qr.size + 8) / 2);
  });

  it('hoists gradients into defs with content-derived, render-stable ids', () => {
    const gradient: QrGradient = {
      type: 'linear',
      rotate: 90,
      stops: [
        { offset: 0, color: '#e2481f' },
        { offset: 1, color: '#f0a500' },
      ],
    };
    const a = buildSvgModel(qr, { ...BASE, color: gradient });
    const b = buildSvgModel(qr, { ...BASE, color: gradient });
    expect(a.defs).toHaveLength(1);
    expect(a.modulesFill).toBe(`url(#${a.defs[0].id})`);
    // Same config → same id (server and client renders must agree).
    expect(b.defs[0].id).toBe(a.defs[0].id);

    const other = buildSvgModel(qr, { ...BASE, color: { ...gradient, rotate: 0 } });
    expect(other.defs[0].id).not.toBe(a.defs[0].id);
    // 90° rotation points the gradient top-to-bottom.
    expect(a.defs[0].x1).toBeCloseTo(0.5);
    expect(a.defs[0].y1).toBeCloseTo(0);
  });

  it('falls back eyeInnerColor → eyeColor → color', () => {
    expect(buildSvgModel(qr, { ...BASE, color: '#111' }).eyeInnerFill).toBe('#111');
    expect(buildSvgModel(qr, { ...BASE, color: '#111', eyeColor: '#222' }).eyeInnerFill).toBe(
      '#222',
    );
    expect(
      buildSvgModel(qr, { ...BASE, color: '#111', eyeColor: '#222', eyeInnerColor: '#333' })
        .eyeInnerFill,
    ).toBe('#333');
  });

  it('omits the background fill when transparent', () => {
    expect(buildSvgModel(qr, BASE).bg).toBeNull();
    expect(buildSvgModel(qr, { ...BASE, bgColor: '#fff' }).bg).toBe('#fff');
  });
});
