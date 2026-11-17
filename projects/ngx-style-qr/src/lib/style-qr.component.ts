import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  computed,
  inject,
  input,
  isDevMode,
  viewChild,
} from '@angular/core';

import { encodeQr } from './qr/matrix';
import { buildSvgModel } from './render-svg';
import type { QrEcLevel, QrEyeShape, QrLogo, QrModuleShape, QrPaint } from './style-qr.types';

/**
 * A styled QR code, rendered as SVG.
 *
 * ```html
 * <ngx-style-qr
 *   data="https://sachinsingh.me"
 *   ecLevel="H"
 *   moduleShape="smooth"
 *   eyeShape="rounded"
 *   [color]="{ type: 'linear', rotate: 45, stops: [
 *     { offset: 0, color: '#e2481f' }, { offset: 1, color: '#f0a500' }] }"
 *   bgColor="#0b0b0d"
 * />
 * ```
 *
 * The whole render path is pure and DOM-free, so the symbol is produced during
 * server-side rendering and hydrates without a flash. Only {@link download} needs
 * a browser.
 *
 * Throws if `data` cannot fit version 40 at the chosen `ecLevel` (~2953 bytes at
 * level L, ~1273 at level H).
 */
@Component({
  selector: 'ngx-style-qr',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let m = model();
    <svg
      #svg
      [attr.viewBox]="m.viewBox"
      [attr.width]="size()"
      [attr.height]="size()"
      shape-rendering="geometricPrecision"
      role="img"
    >
      <title>{{ label() || data() }}</title>
      @if (m.defs.length) {
        <defs>
          @for (d of m.defs; track d.id) {
            @if (d.type === 'linear') {
              <linearGradient
                [attr.id]="d.id"
                [attr.x1]="d.x1"
                [attr.y1]="d.y1"
                [attr.x2]="d.x2"
                [attr.y2]="d.y2"
              >
                @for (s of d.stops; track $index) {
                  <stop [attr.offset]="s.offset" [attr.stop-color]="s.color" />
                }
              </linearGradient>
            } @else {
              <radialGradient [attr.id]="d.id" cx="0.5" cy="0.5" r="0.5">
                @for (s of d.stops; track $index) {
                  <stop [attr.offset]="s.offset" [attr.stop-color]="s.color" />
                }
              </radialGradient>
            }
          }
        </defs>
      }
      @if (m.bg; as bg) {
        <rect x="0" y="0" width="100%" height="100%" [attr.fill]="bg" />
      }
      <path [attr.d]="m.modules" [attr.fill]="m.modulesFill" />
      <path [attr.d]="m.eyeOuter" [attr.fill]="m.eyeOuterFill" fill-rule="evenodd" />
      <path [attr.d]="m.eyeInner" [attr.fill]="m.eyeInnerFill" />
      @if (m.logo; as logo) {
        @if (logo.bg) {
          <path [attr.d]="logo.bgPath" [attr.fill]="logo.bg" />
        }
        <image
          [attr.href]="logo.href"
          [attr.x]="logo.x"
          [attr.y]="logo.y"
          [attr.width]="logo.size"
          [attr.height]="logo.size"
          preserveAspectRatio="xMidYMid meet"
        />
      }
    </svg>
  `,
  // Un-layered component styles outrank Tailwind's layered utilities regardless of
  // specificity, so :where() drops this to zero and lets consumers override freely.
  styles: ':where(:host){display:inline-block;line-height:0}',
})
export class StyleQrComponent {
  /** The payload to encode. Numeric / alphanumeric / UTF-8 are detected automatically. */
  readonly data = input.required<string>();
  /** Rendered width and height in CSS pixels. The SVG scales losslessly. */
  readonly size = input(256);
  /** Error-correction level. Use `'H'` when `logo` is set. */
  readonly ecLevel = input<QrEcLevel>('M');
  /** Quiet zone in modules. The spec requires 4; going lower hurts scan rates. */
  readonly margin = input(4);
  readonly moduleShape = input<QrModuleShape>('square');
  readonly eyeShape = input<QrEyeShape>('square');
  /** Body-module paint: a CSS color or a gradient. */
  readonly color = input<QrPaint>('#000000');
  readonly bgColor = input<QrPaint | 'transparent'>('transparent');
  /** Finder-ring paint. Falls back to `color`. */
  readonly eyeColor = input<QrPaint | null>(null);
  /** Finder-centre paint. Falls back to `eyeColor`, then `color`. */
  readonly eyeInnerColor = input<QrPaint | null>(null);
  /** Centre logo. Use a data URI — see {@link QrLogo}. */
  readonly logo = input<QrLogo | null>(null);
  /** Accessible name for the `<title>`. Falls back to `data`. */
  readonly label = input('');

  private readonly svgRef = viewChild.required<ElementRef<SVGSVGElement>>('svg');
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly model = computed(() => {
    const logo = this.logo();
    if (isDevMode() && logo && this.ecLevel() !== 'H') {
      console.warn(
        `ngx-style-qr: a logo covers modules the decoder needs. ecLevel is '${this.ecLevel()}' — use 'H'.`,
      );
    }
    return buildSvgModel(encodeQr(this.data(), this.ecLevel()), {
      margin: this.margin(),
      moduleShape: this.moduleShape(),
      eyeShape: this.eyeShape(),
      color: this.color(),
      bgColor: this.bgColor(),
      eyeColor: this.eyeColor(),
      eyeInnerColor: this.eyeInnerColor(),
      logo,
    });
  });

  /**
   * Save the rendered code to a file. No-op during server-side rendering.
   *
   * PNG is rasterised at 2× `size` through an offscreen canvas. A cross-origin
   * `logo.src` taints that canvas and makes this reject with a `SecurityError` —
   * use a data URI. A transparent `bgColor` stays transparent in the PNG.
   */
  async download(filename = 'qr-code', format: 'svg' | 'png' = 'png'): Promise<void> {
    if (!this.isBrowser) return;
    const source = new XMLSerializer().serializeToString(this.svgRef().nativeElement);
    const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    if (format === 'svg') return save(svgBlob, `${filename}.svg`);

    const url = URL.createObjectURL(svgBlob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('ngx-style-qr: could not rasterise the SVG.'));
        img.src = url;
      });
      const px = this.size() * 2;
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = px;
      canvas.getContext('2d')!.drawImage(img, 0, 0, px, px);
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (png) save(png, `${filename}.png`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
