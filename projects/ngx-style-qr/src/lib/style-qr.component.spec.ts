import { Resvg } from '@resvg/resvg-js';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import jsQR from 'jsqr';

import { StyleQrComponent } from './style-qr.component';
import type { QrEyeShape, QrModuleShape } from './style-qr.types';

describe('StyleQrComponent', () => {
  let fixture: ComponentFixture<StyleQrComponent>;
  let svg: SVGSVGElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StyleQrComponent] }).compileComponents();
    fixture = TestBed.createComponent(StyleQrComponent);
    fixture.componentRef.setInput('data', 'https://sachinsingh.me');
    await fixture.whenStable();
    svg = fixture.nativeElement.querySelector('svg');
  });

  it('renders an svg sized in px with a viewBox in module units', () => {
    expect(svg.getAttribute('width')).toBe('256');
    // Version 2 at level M is 25 modules; plus the default 4-module quiet zone.
    expect(svg.getAttribute('viewBox')).toBe('0 0 33 33');
  });

  it('exposes an accessible name, defaulting to the payload', async () => {
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.querySelector('title')?.textContent).toBe('https://sachinsingh.me');

    fixture.componentRef.setInput('label', 'Scan for my portfolio');
    await fixture.whenStable();
    expect(svg.querySelector('title')?.textContent).toBe('Scan for my portfolio');
  });

  it('redraws when the payload changes', async () => {
    const before = svg.querySelector('path')!.getAttribute('d');
    fixture.componentRef.setInput('data', 'https://example.com');
    await fixture.whenStable();
    expect(svg.querySelector('path')!.getAttribute('d')).not.toBe(before);
  });

  /**
   * The one check that matters: rasterise the SVG the component actually rendered
   * and read it back with a decoder. Unit-testing the matrix proves the encoding;
   * only this proves the *drawing* of it is still scannable.
   */
  describe('stays scannable once styled', () => {
    const payload = 'https://sachinsingh.me/scan-me';
    // Several resolutions, because a decoder's adaptive binariser is sensitive to
    // how module geometry lands on the pixel grid — tangent `dots` circles decoded
    // at some widths and not others until their radius grew.
    const WIDTHS = [300, 600, 1200];

    async function scan(inputs: Record<string, unknown>): Promise<string[]> {
      const f = TestBed.createComponent(StyleQrComponent);
      f.componentRef.setInput('data', payload);
      for (const [key, value] of Object.entries(inputs)) f.componentRef.setInput(key, value);
      await f.whenStable();

      const svg = new XMLSerializer().serializeToString(f.nativeElement.querySelector('svg'));
      return WIDTHS.map((value) => {
        const png = new Resvg(svg, { fitTo: { mode: 'width', value } }).render();
        const pixels = png.asPng() && png.pixels;
        return `${value}:${jsQR(new Uint8ClampedArray(pixels), png.width, png.height)?.data ?? 'UNREADABLE'}`;
      });
    }

    const allReadable = WIDTHS.map((w) => `${w}:${payload}`);

    const shapes: QrModuleShape[] = ['square', 'dots', 'rounded', 'smooth'];
    const eyes: QrEyeShape[] = ['square', 'rounded', 'circle', 'leaf'];

    for (const moduleShape of shapes) {
      it(`module shape: ${moduleShape}`, async () => {
        expect(await scan({ moduleShape, bgColor: '#ffffff' })).toEqual(allReadable);
      });
    }

    for (const eyeShape of eyes) {
      it(`eye shape: ${eyeShape}`, async () => {
        expect(await scan({ eyeShape, moduleShape: 'smooth', bgColor: '#ffffff' })).toEqual(
          allReadable,
        );
      });
    }

    it('with a gradient fill', async () => {
      const scanned = await scan({
        bgColor: '#ffffff',
        moduleShape: 'rounded',
        color: {
          type: 'linear',
          rotate: 45,
          stops: [
            { offset: 0, color: '#c21b2e' },
            { offset: 1, color: '#f4771f' },
          ],
        },
      });
      expect(scanned).toEqual(allReadable);
    });

    it('with a centre logo at level H', async () => {
      const scanned = await scan({
        ecLevel: 'H',
        bgColor: '#ffffff',
        moduleShape: 'smooth',
        eyeShape: 'rounded',
        logo: {
          src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0IDQiPjxjaXJjbGUgY3g9IjIiIGN5PSIyIiByPSIyIiBmaWxsPSIjYzIxYjJlIi8+PC9zdmc+',
          size: 0.22,
          padding: 1,
          bgColor: '#ffffff',
        },
      });
      expect(scanned).toEqual(allReadable);
    });
  });

  it('emits a gradient definition only when a gradient paint is used', async () => {
    expect(svg.querySelector('defs')).toBeNull();

    fixture.componentRef.setInput('color', {
      type: 'linear',
      stops: [
        { offset: 0, color: '#e2481f' },
        { offset: 1, color: '#f0a500' },
      ],
    });
    await fixture.whenStable();
    const gradient = svg.querySelector('linearGradient')!;
    expect(gradient).not.toBeNull();
    expect(svg.querySelector('path')!.getAttribute('fill')).toBe(`url(#${gradient.id})`);
  });
});
