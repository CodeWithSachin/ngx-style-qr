import type {
  QrCode,
  QrEyeShape,
  QrGradient,
  QrGradientDef,
  QrModuleShape,
  QrPaint,
  QrSvgModel,
  StyleQrOptions,
} from './style-qr.types';

/** Trim float noise out of path data — 3 decimals is well below one device pixel. */
const n = (v: number): string => String(Math.round(v * 1000) / 1000);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Rectangle with independently rounded corners, clockwise from the top-left —
 * one helper covering squares, rounded squares, circles and leaf shapes.
 *
 * A square corner drops the arc entirely rather than emitting a zero-radius one.
 * SVG treats those as straight lines, but a version-40 `smooth` symbol has ~30k of
 * them and the path data is inlined into the server-rendered HTML.
 */
function cornerRect(
  x: number,
  y: number,
  w: number,
  h: number,
  [tl, tr, br, bl]: [number, number, number, number],
): string {
  // From the corner's straight run to the arc's end point.
  const seg = (px: number, py: number, r: number, ax: number, ay: number): string =>
    r > 0 ? `L${n(px)} ${n(py)}A${n(r)} ${n(r)} 0 0 1 ${n(ax)} ${n(ay)}` : `L${n(ax)} ${n(ay)}`;
  return (
    `M${n(x + tl)} ${n(y)}` +
    seg(x + w - tr, y, tr, x + w, y + tr) +
    seg(x + w, y + h - br, br, x + w - br, y + h) +
    seg(x + bl, y + h, bl, x, y + h - bl) +
    seg(x, y + tl, tl, x + tl, y) +
    'Z'
  );
}

/** Two half-arcs — shorter than `cornerRect` for the `dots` shape. */
function circlePath(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(r * 2)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-r * 2)} 0Z`;
}

/** Corner radii as a fraction of the shape's width. */
function eyeRadii(shape: QrEyeShape): [number, number, number, number] {
  switch (shape) {
    case 'rounded':
      return [0.28, 0.28, 0.28, 0.28];
    case 'circle':
      return [0.5, 0.5, 0.5, 0.5];
    // ponytail: all three eyes share one orientation. Rotating each so the flat
    // corner faces the symbol's corner looks nicer — add it if anyone asks.
    case 'leaf':
      return [0, 0.5, 0, 0.5];
    default:
      return [0, 0, 0, 0];
  }
}

const scaleRadii = (r: readonly number[], w: number): [number, number, number, number] =>
  [r[0] * w, r[1] * w, r[2] * w, r[3] * w] as [number, number, number, number];

/** FNV-1a. Only needs to separate distinct gradients within one document. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Resolve a paint to an SVG `fill` value, hoisting gradients into `defs`.
 *
 * Gradient ids are content-derived rather than counter- or random-derived: a
 * counter diverges between the server and client renders and leaves `url(#id)`
 * dangling after hydration. Two identical gradients colliding on one id is
 * harmless — their `<defs>` are identical by construction.
 */
function resolvePaint(paint: QrPaint, defs: QrGradientDef[]): string {
  if (typeof paint === 'string') return paint;
  const id = `sqr-${hash(JSON.stringify(paint))}`;
  if (!defs.some((d) => d.id === id)) defs.push(gradientDef(id, paint));
  return `url(#${id})`;
}

function gradientDef(id: string, g: QrGradient): QrGradientDef {
  if (g.type === 'radial')
    return { id, type: 'radial', stops: g.stops, x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 };
  const rad = ((g.rotate ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad) / 2;
  const sin = Math.sin(rad) / 2;
  return {
    id,
    type: 'linear',
    stops: g.stops,
    x1: 0.5 - cos,
    y1: 0.5 - sin,
    x2: 0.5 + cos,
    y2: 0.5 + sin,
  };
}

/**
 * Radius of a `dots` module, in modules.
 *
 * Not 0.5. Tangent circles cover only π/4 of each cell, which drops the local dark
 * ratio far enough that scanners' adaptive binarisers start misreading whole blocks —
 * measured decoding at only 3 of 10 raster resolutions. At 0.6 the dots overlap
 * slightly and decode at every resolution tested. See the scannability specs.
 */
const DOT_RADIUS = 0.6;

function modulePath(shape: QrModuleShape, x: number, y: number, near: boolean[]): string {
  switch (shape) {
    case 'dots':
      return circlePath(x + 0.5, y + 0.5, DOT_RADIUS);
    case 'rounded':
      return cornerRect(x, y, 1, 1, [0.25, 0.25, 0.25, 0.25]);
    case 'smooth': {
      const [up, right, down, left] = near;
      const r = 0.5;
      return cornerRect(x, y, 1, 1, [
        !up && !left ? r : 0,
        !up && !right ? r : 0,
        !down && !right ? r : 0,
        !down && !left ? r : 0,
      ]);
    }
    default:
      return `M${n(x)} ${n(y)}h1v1h-1Z`;
  }
}

/**
 * Turn a QR matrix plus style options into a plain, DOM-free description of an SVG.
 *
 * Pure — no `document`, no `window` — which is what lets `<ngx-style-qr>` render
 * identically on the server and in the browser with no hydration dance.
 */
export function buildSvgModel(qr: QrCode, opts: StyleQrOptions): QrSvgModel {
  const m = Math.max(0, opts.margin);
  const dim = qr.size + m * 2;
  const defs: QrGradientDef[] = [];

  const bodyFill = resolvePaint(opts.color, defs);
  const outerFill = resolvePaint(opts.eyeColor ?? opts.color, defs);
  const innerFill = resolvePaint(opts.eyeInnerColor ?? opts.eyeColor ?? opts.color, defs);
  const bg = opts.bgColor === 'transparent' ? null : resolvePaint(opts.bgColor, defs);

  // Logo box, in module coordinates (margin added only at draw time).
  let logo: QrSvgModel['logo'] = null;
  let erase: { lo: number; hi: number } | null = null;
  if (opts.logo) {
    const w = qr.size * clamp(opts.logo.size ?? 0.2, 0.05, 0.35);
    const pad = Math.max(0, opts.logo.padding ?? 1);
    const x = (qr.size - w) / 2;
    erase = { lo: x - pad, hi: x + w + pad };
    const plate = opts.logo.bgColor ?? null;
    const radius = Math.max(0, opts.logo.bgRadius ?? 0);
    logo = {
      href: opts.logo.src,
      x: x + m,
      y: x + m,
      size: w,
      bg: plate,
      bgPath: plate
        ? cornerRect(x + m - pad, x + m - pad, w + pad * 2, w + pad * 2, [
            radius,
            radius,
            radius,
            radius,
          ])
        : '',
    };
  }

  // The three 7×7 finder blocks are drawn separately, so the body path skips them.
  const inEye = (x: number, y: number): boolean =>
    (x < 7 && y < 7) || (x >= qr.size - 7 && y < 7) || (x < 7 && y >= qr.size - 7);
  const erased = (x: number, y: number): boolean =>
    erase !== null &&
    x + 0.5 > erase.lo &&
    x + 0.5 < erase.hi &&
    y + 0.5 > erase.lo &&
    y + 0.5 < erase.hi;
  const on = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < qr.size &&
    y < qr.size &&
    qr.modules[y][x] &&
    !inEye(x, y) &&
    !erased(x, y);

  let modules = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!on(x, y)) continue;
      modules += modulePath(opts.moduleShape, x + m, y + m, [
        on(x, y - 1),
        on(x + 1, y),
        on(x, y + 1),
        on(x - 1, y),
      ]);
    }
  }

  const radii = eyeRadii(opts.eyeShape);
  let eyeOuter = '';
  let eyeInner = '';
  for (const [ex, ey] of [
    [0, 0],
    [qr.size - 7, 0],
    [0, qr.size - 7],
  ]) {
    // Ring = 7×7 outline plus a 5×5 counter-path; the caller fills it even-odd.
    eyeOuter += cornerRect(ex + m, ey + m, 7, 7, scaleRadii(radii, 7));
    eyeOuter += cornerRect(ex + m + 1, ey + m + 1, 5, 5, scaleRadii(radii, 5));
    eyeInner += cornerRect(ex + m + 2, ey + m + 2, 3, 3, scaleRadii(radii, 3));
  }

  return {
    viewBox: `0 0 ${dim} ${dim}`,
    defs,
    bg,
    modules,
    modulesFill: bodyFill,
    eyeOuter,
    eyeOuterFill: outerFill,
    eyeInner,
    eyeInnerFill: innerFill,
    logo,
  };
}
