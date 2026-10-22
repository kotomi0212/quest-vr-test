'use strict';
const assert = require('node:assert/strict');
const P = require('../stimulus-patterns.js');

assert.equal(P.get('stripes-high').contrast, 1);
assert.equal(P.get('stripes-low').contrast, 0.1);
assert.equal(P.get('noise-1f').spectralSlope, -1);
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
const steeper=P.noiseFieldRect(n,n,42,-2,width/height);
const steeperProducts=bins.map(([x,y])=>magnitude(steeper,x,y)*Math.hypot(x/(width/height),y)**2);
for(const value of steeperProducts)assert(Math.abs(value/steeperProducts[0]-1)<1e-9,'Changing slope must actually change Fourier amplitudes');
for (const invalid of [0, 3, 2048]) assert.throws(() => P.noiseField(invalid, 1, width, height));
assert.throws(() => P.noiseField(n, 1, 0, height));
const screen = { widthM: width, heightM: height };
const high = P.generate('stripes-high');
const low = P.generate('stripes-low');
assert.equal(high.statistics.digitalMichelsonContrast, 1);
assert(Math.abs(low.statistics.digitalMichelsonContrast - .1) < .005, '10% within 8-bit quantization');
assert(Math.abs(high.statistics.digitalLinearMean - low.statistics.digitalLinearMean) < .002, 'Match mean linear luminance');
for (let i = 0; i < high.rgba.length; i += 4) {
  assert.equal(high.rgba[i] > 128, low.rgba[i] > P.srgbByte(.5), 'Both conditions must have the exact same stripe phase');
  assert.equal(low.rgba[i + 3], 255);
}
for (let i = 0; i < P.get('stripes-low').width * 4; i++) assert.equal(low.rgba[i], low.rgba[i + P.get('stripes-low').width * 4], 'Vertical stripes');
const noise = P.generate('noise-1f',{width:n,height:n});
assert(Math.abs(noise.statistics.digitalLinearMean - .5) < .002);
assert.deepEqual(noise.rgba, P.generate('noise-1f',{width:n,height:n}).rgba);
assert.throws(() => P.generate('invalid'));
assert.throws(() => P.generate('stripes-low',{stripeCount:0}));
console.log('PASS: deterministic static 1/f amplitude spectrum, zero DC, physical spatial frequencies, contrasts, sRGB encoding, legacy aliases');

// Image adjustments must work independently of any scene/layout file.
const rectangular=P.generate('noise-1f',{width:128,height:64,spectralSlope:-2,brightness:.4,contrast:.5,seed:42});
assert.equal(rectangular.rgba.length,128*64*4);
assert.equal(rectangular.metadata.spectralSlope,-2);
assert(Math.abs(rectangular.statistics.digitalLinearMean-.4)<.002);
const horizontal=P.generate('stripes-low',{width:64,height:32,orientation:90,stripeCount:4,brightness:.4,contrast:.2});
assert.equal(horizontal.rgba[0],horizontal.rgba[4*63]);
assert.notEqual(horizontal.rgba[0],horizontal.rgba[4*64*4]);
const black=P.generate('stripes-low',{brightness:0});assert.equal(black.statistics.digitalRmsContrast,0);
assert.throws(()=>P.generate('noise-1f',{width:127}));
assert.throws(()=>P.generate('noise-1f',{seed:NaN}));
assert.throws(()=>P.generate('stripes-low',{brightness:.9,contrast:1}));
assert(!require('node:fs').readFileSync(require('node:path').join(__dirname,'../stimulus-patterns.js'),'utf8').includes('layoutConfig'));
