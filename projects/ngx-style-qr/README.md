# @code_with_sachin/ngx-style-qr

Styled QR codes for Angular, rendered as SVG. **No runtime dependencies** — the QR
encoder is built in.

**[Live demo & docs → https://sachinsingh.me/packages/qr](https://sachinsingh.me/packages/qr)**

- **Server-side rendered.** Encoding and drawing are pure functions, so the symbol
  is in the HTML before hydration. No canvas, no `afterNextRender`, no flash.
- **Styled, not just coloured.** Module and eye shapes, gradients, a centre logo
  with automatic module erasure.
- **Verified scannable.** Every shape combination is rasterised and read back with
  a real decoder in CI, at three resolutions.

## Install

```bash
npm i @code_with_sachin/ngx-style-qr
```

Requires Angular 22+. No other dependency — not even a peer.

## Requirements

Peer ranges are wider than this; the **Tested** column is the exact combination the
[live demo](https://sachinsingh.me/packages/qr) runs, so you have a known-good set to fall back on.

| Package         | Peer range | Tested  | Notes                                                 |
| --------------- | ---------- | ------- | ----------------------------------------------------- |
| `@angular/core` | `^22.0.0`  | 22.0.5  | Standalone APIs, signal inputs and `afterNextRender`. |
| `typescript`    | `~6.0.0`   | 6.0.3   | Whatever your Angular version supports.               |
| `node`          | `>=20`     | 24.15.0 | Build and SSR only.                                   |

## Providers

**Nothing to register.** This package exposes no provider function and reads no injection
token — import the component where you use it and you are done. Your `app.config.ts` needs
no change.

## Using NgModules

Everything here is standalone, but standalone components and directives are importable from
an `@NgModule` — put them in the module's `imports`, **not** `declarations`. No
`importProvidersFrom` is needed: `@NgModule.providers` is typed
`Array<Provider | EnvironmentProviders>`, so the `provide*()` functions drop straight in.

```ts
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { StyleQrComponent } from '@code_with_sachin/ngx-style-qr';

import { AppComponent } from './app.component';

@NgModule({
  declarations: [AppComponent],
  // Standalone components and directives go in `imports`.
  imports: [BrowserModule, StyleQrComponent],
  bootstrap: [AppComponent],
})
export class AppModule {}
```

## Use

```ts
import { Component } from '@angular/core';
import { StyleQrComponent } from '@code_with_sachin/ngx-style-qr';

@Component({
  selector: 'app-share',
  imports: [StyleQrComponent],
  template: `<ngx-style-qr data="https://sachinsingh.me" />`,
})
export class Share {}
```

Everything styled at once:

```html
<ngx-style-qr
  #code
  data="https://sachinsingh.me"
  ecLevel="H"
  moduleShape="smooth"
  eyeShape="rounded"
  [size]="320"
  [color]="{
    type: 'linear',
    rotate: 45,
    stops: [{ offset: 0, color: '#c21b2e' }, { offset: 1, color: '#f4771f' }]
  }"
  bgColor="#0a0a0a"
  eyeColor="#c9a24b"
  [logo]="{ src: logoDataUri, size: 0.22, padding: 1, bgColor: '#f7f2e7' }"
  label="Scan for my portfolio"
/>

<button (click)="code.download('portfolio', 'png')">Download</button>
```

## Inputs

| Input                 | Type                                                      | Default         |
| --------------------- | --------------------------------------------------------- | --------------- |
| `data` **(required)** | `string`                                                  | —               |
| `size`                | `number` — rendered px; the SVG scales losslessly         | `256`           |
| `ecLevel`             | `'L' \| 'M' \| 'Q' \| 'H'`                                | `'M'`           |
| `margin`              | `number` — quiet zone in modules                          | `4`             |
| `moduleShape`         | `'square' \| 'dots' \| 'rounded' \| 'smooth'`             | `'square'`      |
| `eyeShape`            | `'square' \| 'rounded' \| 'circle' \| 'leaf'`             | `'square'`      |
| `color`               | `string \| QrGradient`                                    | `'#000000'`     |
| `bgColor`             | `string \| QrGradient \| 'transparent'`                   | `'transparent'` |
| `eyeColor`            | `string \| QrGradient \| null` — falls back to `color`    | `null`          |
| `eyeInnerColor`       | `string \| QrGradient \| null` — falls back to `eyeColor` | `null`          |
| `logo`                | `QrLogo \| null`                                          | `null`          |
| `label`               | `string` — `<title>`; falls back to `data`                | `''`            |

`download(filename?, format?: 'svg' \| 'png')` saves the rendered code. It is a
no-op during server-side rendering.

### Notes

- **`moduleShape="smooth"`** rounds a module corner only when both adjacent modules
  are empty, so runs merge into continuous blobs.
- **A logo destroys the modules it covers**, which comes straight out of the error
  correction budget. Use `ecLevel="H"`; the component warns in dev mode otherwise.
- **`logo.src` should be a data URI.** A cross-origin URL taints the export canvas
  and makes `download(..., 'png')` fail with a `SecurityError`.
- **Gradient ids are derived from the gradient's content**, not a counter, so the
  server and client renders agree and `url(#…)` survives hydration.
- **`dots` draws circles slightly wider than one module.** Tangent circles cover only
  π/4 of a cell, which drops the local dark ratio far enough that adaptive binarisers
  start misreading whole blocks.

## Without the component

The encoder and renderer are exported on their own — useful for painting into a
canvas, a terminal, or a print pipeline:

```ts
import { encodeQr, buildSvgModel } from '@code_with_sachin/ngx-style-qr';

const qr = encodeQr('https://sachinsingh.me', 'H');
qr.version; // 3
qr.size; // 29
qr.modules[0][0]; // true
```

`encodeQr` throws if the payload cannot fit version 40 at the requested level
(~2953 bytes at `'L'`, ~1273 at `'H'`). Numeric, alphanumeric and UTF-8 byte modes
are selected automatically; kanji mode is not implemented.

## Develop

```bash
ng build ngx-style-qr
ng test ngx-style-qr
```

Tests round-trip every version 1–40 through a decoder and check all 160
version × EC-level capacity boundaries, then rasterise the component's real SVG
output and read it back for each shape.

## Licence

MIT © Sachin Singh
