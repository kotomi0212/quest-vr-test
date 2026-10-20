/* Shared visual-pattern definitions. No animation or motion math lives here. */
(function (scope) {
  'use strict';
  const version = 'visual-patterns-v1';
  const textureSize = 512;
  const seed = 20261020;
  const screen = Object.freeze({ distanceM: 3, widthM: 6, heightM: 4, centerHeightM: 1.6 });
  const stripePeriodM = 0.25;
  const defaultPattern = 'grid'; // Preserve the existing initial operator selection.
  const definitions = Object.freeze({
    'noise-1f': Object.freeze({ label: '1/fノイズ（静止・固定シード）', kind: 'noise', amplitudeExponent: -1, seed }),
    'stripes-high': Object.freeze({ label: '縦ストライプ（高コントラスト100%）', kind: 'stripes', michelsonContrast: 1 }),
    'stripes-low': Object.freeze({ label: '縦ストライプ（低コントラスト10%）', kind: 'stripes', michelsonContrast: 0.1 }),
    grid: Object.freeze({ label: '既存：黒格子の半円筒', kind: 'legacy' }),
    room: Object.freeze({ label: '既存：家具のある部屋', kind: 'legacy' })
  });
  const aliases = Object.freeze({ checker: 'grid', stripes: 'grid' });
  function resolve(id) { return aliases[id] || id; }
  function get(id) { return Object.hasOwn(definitions, resolve(id)) ? definitions[resolve(id)] : null; }
  function random(seedValue) {
    let state = seedValue >>> 0;
    return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
  }
  // In-place inverse radix-2 FFT along one row/column of a complex matrix.
  function inverseLine(real, imag, base, stride, n) {
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const a = base + i * stride, b = base + j * stride;
        [real[a], real[b]] = [real[b], real[a]];
        [imag[a], imag[b]] = [imag[b], imag[a]];
      }
    }
    for (let length = 2; length <= n; length *= 2) {
      const angle = 2 * Math.PI / length, stepR = Math.cos(angle), stepI = Math.sin(angle);
      for (let start = 0; start < n; start += length) {
        let wr = 1, wi = 0;
        for (let j = 0; j < length / 2; j++) {
          const a = base + (start + j) * stride, b = base + (start + j + length / 2) * stride;
          const br = real[b] * wr - imag[b] * wi, bi = real[b] * wi + imag[b] * wr;
          real[b] = real[a] - br; imag[b] = imag[a] - bi;
          real[a] += br; imag[a] += bi;
          const next = wr * stepR - wi * stepI;
          wi = wr * stepI + wi * stepR; wr = next;
        }
      }
    }
    for (let i = 0; i < n; i++) { const a = base + i * stride; real[a] /= n; imag[a] /= n; }
  }
  function noiseField(size, seedValue, widthM, heightM) {
    if (!Number.isInteger(size) || size < 2 || size > 1024 || (size & (size - 1)) ||
      !Number.isFinite(widthM) || widthM <= 0 || !Number.isFinite(heightM) || heightM <= 0) throw Error('ノイズ生成寸法が不正です');
    const real = new Float64Array(size * size), imag = new Float64Array(size * size), next = random(seedValue);
    // Hermitian spectrum: random phase, exactly 1/f amplitude, zero DC.
    // Frequencies use cycles/metre on the physical screen, not texture pixels.
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const a = y * size + x, b = ((size - y) % size) * size + (size - x) % size;
      if (!a || a > b) continue;
      const fx = (x <= size / 2 ? x : x - size) / widthM;
      const fy = (y <= size / 2 ? y : y - size) / heightM;
      const amplitude = 1 / Math.hypot(fx, fy), phase = next() * 2 * Math.PI;
      real[a] = real[b] = amplitude * (a === b ? (phase < Math.PI ? -1 : 1) : Math.cos(phase));
      imag[a] = a === b ? 0 : amplitude * Math.sin(phase); imag[b] = -imag[a];
    }
    for (let i = 0; i < size; i++) inverseLine(real, imag, i * size, 1, size);
    for (let i = 0; i < size; i++) inverseLine(real, imag, i, size, size);
    // A single linear gain preserves the spectrum; no clipping or histogram equalization.
    let mean = 0, peak = 0;
    for (const value of real) mean += value / real.length;
    for (const value of real) peak = Math.max(peak, Math.abs(value - mean));
    for (let i = 0; i < real.length; i++) real[i] = (real[i] - mean) / peak;
    return real;
  }
  function srgbByte(linear) {
    const value = Math.max(0, Math.min(1, linear));
    return Math.round(255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055));
  }
  function srgbLinear(byte) {
    const value = byte / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }
  function pixels(id, screen, periodM, size = textureSize) {
    const definition = get(id);
    if (!definition || definition.kind === 'legacy') throw Error('平面パターンが不正です');
    if (!Number.isInteger(size) || size < 2 || size > 1024 ||
      !Number.isFinite(screen.widthM) || screen.widthM <= 0 || !Number.isFinite(screen.heightM) || screen.heightM <= 0 ||
      !Number.isFinite(periodM) || periodM <= 0) throw Error('パターン寸法が不正です');
    const field = definition.kind === 'noise' ? noiseField(size, definition.seed, screen.widthM, screen.heightM) : null;
    const rgba = new Uint8ClampedArray(size * size * 4);
    let min = 1, max = 0, sum = 0, squared = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const sign = Math.floor((x + .5) / size * screen.widthM / periodM * 2) % 2 ? -1 : 1;
      const target = .5 + .5 * (field ? field[i] : definition.michelsonContrast * sign);
      const byte = srgbByte(target), linear = srgbLinear(byte);
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = byte; rgba[i * 4 + 3] = 255;
      min = Math.min(min, linear); max = Math.max(max, linear); sum += linear; squared += linear * linear;
    }
    const mean = sum / (size * size);
    return { rgba, statistics: { digitalLinearMin: min, digitalLinearMax: max, digitalLinearMean: mean,
      digitalMichelsonContrast: (max - min) / (max + min),
      digitalRmsContrast: Math.sqrt(Math.max(0, squared / (size * size) - mean * mean)) / mean } };
  }
  function metadata(id, statistics) {
    const definition = get(id);
    if (!definition) throw Error('映像パターン不正');
    const common = { version, id: resolve(id), label: definition.label };
    if (definition.kind === 'legacy') return { ...common, surface: id === 'room' ? 'room' : 'legacy-cylinder' };
    return { ...common, surface: 'plane', screen: { ...screen }, textureSize,
      nominalLinearMean: .5, textureColorSpace: 'sRGB encoding of linear luminance',
      ...(definition.kind === 'noise' ? { seed: definition.seed, amplitudeExponent: -1, powerExponent: -2, static: true,
        frequencyUnits: 'cycles/metre', dc: 0, normalization: 'zero mean, global peak normalization, then L=0.5+0.5*field' } :
        { orientation: 'vertical', waveform: 'square', periodM: stripePeriodM, dutyCycle: .5, nominalMichelsonContrast: definition.michelsonContrast }),
      ...(statistics || {}) };
  }
  const api = Object.freeze({ version, textureSize, screen, stripePeriodM, defaultPattern, definitions, resolve, get,
    noiseField, srgbByte, srgbLinear, pixels, metadata });
  scope.StimulusPatterns = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
