/* Image generation only: no scene, camera, layout or motion imports. */
(function (scope) {
  'use strict';
  const config = scope.patternConfig || (typeof module !== 'undefined' ? require('./pattern-config1.js') : null);
  const version = 'pattern-layout-v2';
  const definitions = config.patterns;
  const aliases = Object.freeze({ checker: 'grid', stripes: 'grid' });
  function resolve(id) { return Object.hasOwn(aliases, id) ? aliases[id] : id; }
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
  function noiseFieldRect(width, height, seed, slope, aspect) {
    const powerOfTwo = n => Number.isInteger(n) && n >= 2 && n <= 1024 && !(n & (n - 1));
    if (!powerOfTwo(width) || !powerOfTwo(height) || !Number.isInteger(seed) || seed < 0 || seed > 4294967295 ||
      !Number.isFinite(slope) || !Number.isFinite(aspect) || aspect <= 0) throw Error('ノイズ設定が不正です（幅・高さは2の累乗、seedは整数）');
    const real = new Float64Array(width * height), imag = new Float64Array(width * height), next = random(seed);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const a = y * width + x, b = ((height - y) % height) * width + (width - x) % width;
      if (!a || a > b) continue;
      const fx = (x <= width / 2 ? x : x - width) / aspect;
      const fy = y <= height / 2 ? y : y - height;
      const amplitude = Math.hypot(fx, fy) ** slope, phase = next() * 2 * Math.PI;
      if (!Number.isFinite(amplitude) || amplitude <= 0) throw Error('spectral slopeが数値範囲外です');
      real[a] = real[b] = amplitude * (a === b ? (phase < Math.PI ? -1 : 1) : Math.cos(phase));
      imag[a] = a === b ? 0 : amplitude * Math.sin(phase); imag[b] = -imag[a];
    }
    for (let y = 0; y < height; y++) inverseLine(real, imag, y * width, 1, width);
    for (let x = 0; x < width; x++) inverseLine(real, imag, x, width, height);
    let mean = 0, peak = 0;
    for (const value of real) mean += value / real.length;
    for (const value of real) peak = Math.max(peak, Math.abs(value - mean));
    if (!Number.isFinite(peak) || peak === 0) throw Error('ノイズを正規化できません');
    for (let i = 0; i < real.length; i++) real[i] = (real[i] - mean) / peak;
    return real;
  }
  // Compatibility helper for numerical tests; these are frequency coordinates, not a scene import.
  function noiseField(size, seed, frequencyWidth, frequencyHeight) {
    if (![frequencyWidth, frequencyHeight].every(n => Number.isFinite(n) && n > 0)) throw Error('周波数座標が不正です');
    return noiseFieldRect(size, size, seed, -1, frequencyWidth / frequencyHeight);
  }
  function srgbByte(linear) {
    const value = Math.max(0, Math.min(1, linear));
    return Math.round(255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055));
  }
  function srgbLinear(byte) {
    const value = byte / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }
  function generate(id, overrides = {}) {
    const base = get(id), definition = { ...base, ...overrides };
    if (!base || base.kind === 'legacy') throw Error('画像パターンが不正です');
    const { width, height, brightness, contrast } = definition;
    if (![width, height].every(n => Number.isInteger(n) && n >= 2 && n <= 1024) ||
      !Number.isFinite(brightness) || brightness < 0 || brightness > 1 ||
      !Number.isFinite(contrast) || contrast < 0 || contrast > 1 || brightness * (1 + contrast) > 1 + 1e-12) {
      throw Error('画像寸法・brightness・contrastが不正です（brightness×(1+contrast)≤1）');
    }
    if (definition.kind === 'stripes' && (!Number.isFinite(definition.orientation) || !Number.isFinite(definition.stripeCount) || definition.stripeCount <= 0)) throw Error('ストライプ設定が不正です');
    if (!['noise', 'stripes'].includes(definition.kind)) throw Error('未対応の模様です');
    const field = definition.kind === 'noise' ? noiseFieldRect(width, height, definition.seed, definition.spectralSlope, definition.spectralAspect) : null;
    const rgba = new Uint8ClampedArray(width * height * 4), angle = (definition.orientation || 0) * Math.PI / 180;
    let min = 1, max = 0, sum = 0, squared = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const coordinate = (x + .5) / width * Math.cos(angle) + (1 - (y + .5) / height) * Math.sin(angle);
      const sign = ((Math.floor(coordinate * definition.stripeCount * 2) % 2) + 2) % 2 ? -1 : 1;
      const target = brightness * (1 + contrast * (field ? field[i] : sign));
      const byte = srgbByte(target), linear = srgbLinear(byte);
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = byte; rgba[i * 4 + 3] = 255;
      min = Math.min(min, linear); max = Math.max(max, linear); sum += linear; squared += linear * linear;
    }
    const mean = sum / (width * height);
    const statistics = { digitalLinearMin: min, digitalLinearMax: max, digitalLinearMean: mean,
      digitalMichelsonContrast: max + min ? (max - min) / (max + min) : 0,
      digitalRmsContrast: mean ? Math.sqrt(Math.max(0, squared / (width * height) - mean * mean)) / mean : 0 };
    return { width, height, rgba, statistics, metadata: metadata(id, statistics, definition) };
  }
  function metadata(id, statistics, definition = get(id)) {
    if (!definition) throw Error('画像パターン不正');
    return { version, id: resolve(id), ...definition,
      ...(definition.kind === 'noise' ? { amplitudeExponent: definition.spectralSlope, powerExponent: 2 * definition.spectralSlope, static: true, dc: 0,
        frequencyUnits: 'cycles/image-height, x scaled by spectralAspect', normalization: 'zero mean, peak-normalized field' } : {}),
      textureColorSpace: 'sRGB encoding of linear luminance', ...(statistics || {}) };
  }
  const api = Object.freeze({ version, definitions, defaultPattern: config.defaultPattern, resolve, get, generate,
    noiseField, noiseFieldRect, srgbByte, srgbLinear, metadata });
  scope.StimulusPatterns = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);


