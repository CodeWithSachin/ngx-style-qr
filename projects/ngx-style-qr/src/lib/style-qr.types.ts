/**
 * Public types for ngx-style-qr.
 *
 * Kept in one file so both the encoder (`qr/`) and the renderer can import them
 * without a runtime dependency on each other.
 */

/**
 * Error-correction level. Higher levels survive more damage but hold less data.
 *
 * `'L'` ≈ 7% recoverable, `'M'` ≈ 15%, `'Q'` ≈ 25%, `'H'` ≈ 30%.
 * Use `'H'` whenever a logo covers the centre — the logo destroys modules and
 * eats straight into this budget.
 */
export type QrEcLevel = 'L' | 'M' | 'Q' | 'H';

/** A finished QR symbol: a square matrix of dark (`true`) / light (`false`) modules. */
export interface QrCode {
  /** Symbol version, 1–40. Determines `size` as `4 * version + 17`. */
  readonly version: number;
  /** Side length in modules (21 for version 1 … 177 for version 40). */
  readonly size: number;
  /** Row-major module grid, `modules[y][x]`. `true` = dark. */
  readonly modules: readonly boolean[][];
}

/**
 * Body-module shape.
 *
 * - `square` — the spec default, maximum scanner tolerance.
 * - `dots` — tangent circles.
 * - `rounded` — every module a small rounded square; modules stay visually distinct.
 * - `smooth` — neighbour-aware: a corner only rounds when both adjacent modules are
 *   empty, so runs of modules merge into continuous blobs.
 */
export type QrModuleShape = 'square' | 'dots' | 'rounded' | 'smooth';

/** Finder-pattern ("eye") shape. Applied to all three eyes identically. */
export type QrEyeShape = 'square' | 'rounded' | 'circle' | 'leaf';

/** A linear or radial gradient fill. */
export interface QrGradient {
  type: 'linear' | 'radial';
  /** Two or more stops. `offset` is 0–1. */
  stops: readonly { offset: number; color: string }[];
  /** Linear only: rotation in degrees, 0 = left→right. Ignored for radial. */
  rotate?: number;
}

/** Anything paintable: a CSS color string, or a gradient. */
export type QrPaint = string | QrGradient;

/**
 * Centre logo.
 *
 * ⚠️ `src` should be a **data URI**. A cross-origin URL taints the export canvas
 * and makes `download(..., 'png')` throw a `SecurityError`.
 */
export interface QrLogo {
  src: string;
  /** Width as a fraction of the symbol, 0.05–0.35. Default `0.2`. */
  size?: number;
  /** Extra modules cleared around the logo. Default `1`. */
  padding?: number;
  /** Optional plate drawn behind the logo (e.g. the QR background color). */
  bgColor?: string;
  /** Corner radius of that plate, in modules. Default `0`. */
  bgRadius?: number;
}

/** Everything the SVG renderer needs beyond the matrix itself. */
export interface StyleQrOptions {
  margin: number;
  moduleShape: QrModuleShape;
  eyeShape: QrEyeShape;
  color: QrPaint;
  bgColor: QrPaint | 'transparent';
  eyeColor: QrPaint | null;
  eyeInnerColor: QrPaint | null;
  logo: QrLogo | null;
}

/** A gradient hoisted into `<defs>`, with its geometry already resolved. */
export interface QrGradientDef {
  id: string;
  type: 'linear' | 'radial';
  stops: readonly { offset: number; color: string }[];
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * The renderer's output — a plain, DOM-free description of the SVG.
 *
 * The component binds this directly in its template, which is why the whole
 * render path works unchanged during server-side rendering.
 */
export interface QrSvgModel {
  viewBox: string;
  defs: QrGradientDef[];
  /** Fill for the full-canvas background rect, or `null` for transparent. */
  bg: string | null;
  /** Single `<path d>` covering every body module (eyes excluded). */
  modules: string;
  modulesFill: string;
  /** Finder rings — one path, even-odd filled. */
  eyeOuter: string;
  eyeOuterFill: string;
  /** Finder centres. */
  eyeInner: string;
  eyeInnerFill: string;
  logo: {
    href: string;
    x: number;
    y: number;
    size: number;
    bg: string | null;
    bgPath: string;
  } | null;
}
