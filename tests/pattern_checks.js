'use strict';
const assert = require('node:assert/strict');
const P = require('../stimulus-patterns.js');

assert.equal(P.get('stripes-high').michelsonContrast, 1);
assert.equal(P.get('stripes-low').michelsonContrast, 0.1);
assert.equal(P.get('noise-1f').amplitudeExponent, -1);
assert.equal(P.get('unknown'), null);
assert.equal(P.resolve('checker'), 'grid');
assert.equal(P.resolve('stripes'), 'grid'); // Preserve existing saved commands.
assert.equal(P.srgbByte(0), 0);
assert.equal(P.srgbByte(1), 255);
assert.equal(P.srgbByte(.5), 188);

const n = 64, width = 6, height = 4;
const a = P.noiseField(n, P.get('noise-1f').seed, width, height);
const same = P.noiseField(n, P.get('noise-1f').seed, width, height);
const other = P.noiseField(n, P.get('noise-1f').seed + 1, width, height);
assert.deepEqual(a, same, 'Repeated trials must use the identical noise realization');
assert.notDeepEqual(a, other);
assert(Math.abs(a.reduce((sum, v) => sum + v, 0) / a.length) < 1e-12, 'Zero DC');
assert(a.every(v => Number.isFinite(v) && Math.abs(v) <= 1.00000001));
// Independent DFT checks (not the inverse FFT implementation) in cycles/metre.
function magnitude(field, kx, ky) {
  let real = 0, imag = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const angle = -2 * Math.PI * (kx * x + ky * y) / n;
    real += field[y * n + x] * Math.cos(angle);
    imag += field[y * n + x] * Math.sin(angle);
  }
  return Math.hypot(real, imag);
}
const bins = [[1, 0], [0, 1], [2, 0], [4, 0], [3, 2], [7, 9], [18, 1]];
const products = bins.map(([x, y]) => magnitude(a, x, y) * Math.hypot(x / width, y / height));
for (const value of products) assert(Math.abs(value / products[0] - 1) < 1e-10, 'Fourier amplitude must be 1/f; power is 1/f²');
for (const invalid of [0, 3, 2048]) assert.throws(() => P.noiseField(invalid, 1, width, height));
assert.throws(() => P.noiseField(n, 1, 0, height));
const screen = { widthM: width, heightM: height };
const high = P.pixels('stripes-high', screen, .25);
const low = P.pixels('stripes-low', screen, .25);
assert.equal(high.statistics.digitalMichelsonContrast, 1);
assert(Math.abs(low.statistics.digitalMichelsonContrast - .1) < .005, '10% within 8-bit quantization');
assert(Math.abs(high.statistics.digitalLinearMean - low.statistics.digitalLinearMean) < .002, 'Match mean linear luminance');
for (let i = 0; i < high.rgba.length; i += 4) {
  assert.equal(high.rgba[i] > 128, low.rgba[i] > P.srgbByte(.5), 'Both conditions must have the exact same stripe phase');
  assert.equal(low.rgba[i + 3], 255);
}
for (let i = 0; i < P.textureSize * 4; i++) assert.equal(low.rgba[i], low.rgba[i + P.textureSize * 4], 'Vertical stripes');
const noise = P.pixels('noise-1f', screen, .25, n);
assert(Math.abs(noise.statistics.digitalLinearMean - .5) < .002);
assert.deepEqual(noise.rgba, P.pixels('noise-1f', screen, .25, n).rgba);
assert.throws(() => P.pixels('invalid', screen, .25));
assert.throws(() => P.pixels('stripes-low', screen, 0));
console.log('PASS: deterministic static 1/f amplitude spectrum, zero DC, physical spatial frequencies, contrasts, sRGB encoding, legacy aliases');
