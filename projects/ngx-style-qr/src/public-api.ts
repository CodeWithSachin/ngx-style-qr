/*
 * Public API Surface of ngx-style-qr
 */

export * from './lib/style-qr.types';
export * from './lib/style-qr.component';

// The encoder and renderer are useful on their own — e.g. to paint the matrix into
// a canvas, a terminal, or a print pipeline without the component.
export { encodeQr } from './lib/qr/matrix';
export { buildSvgModel } from './lib/render-svg';
