# ngx-style-qr

Styled QR codes for Angular, rendered as SSR-safe SVG. Zero runtime dependencies — the QR encoder is built in. Published as
[`@code_with_sachin/ngx-style-qr`](https://www.npmjs.com/package/@code_with_sachin/ngx-style-qr).

**Usage docs:** [projects/ngx-style-qr/README.md](projects/ngx-style-qr/README.md) ·
**Live demo:** https://sachinsingh.me/packages/qr ·
**Changes:** [CHANGELOG](projects/ngx-style-qr/CHANGELOG.md)

```bash
npm i @code_with_sachin/ngx-style-qr
```

## Development

This is an Angular workspace with one library project.

```bash
npm ci
npm test          # Vitest + jsdom
npm run build     # ng-packagr → dist/ngx-style-qr
npm run pack      # build, then a tarball to try in another app
```

## Releasing

1. Bump `version` in `projects/ngx-style-qr/package.json` and add a CHANGELOG entry.
2. `npm run release` — builds, runs the tests, and publishes `dist/ngx-style-qr`.
   npm asks for a two-factor confirmation in the browser.
3. Tag the commit: `git tag v<version> && git push --tags`.

## Licence

MIT © [Sachin Singh](https://sachinsingh.me)
