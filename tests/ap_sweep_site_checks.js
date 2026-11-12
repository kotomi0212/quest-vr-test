'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const operatorHtml = fs.readFileSync(path.join(root, 'operator3.html'), 'utf8');
const questHtml = fs.readFileSync(path.join(root, 'quest3.html'), 'utf8');
const operatorJs = fs.readFileSync(path.join(root, 'ap-sweep-operator.js'), 'utf8');
const runtimeJs = fs.readFileSync(path.join(root, 'ap-sweep-runtime.js'), 'utf8');

for (const html of [operatorHtml, questHtml]) {
  for (const match of html.matchAll(/src="([^"?]+)(?:\?[^\"]*)?"/g)) {
    if (!/^https?:/.test(match[1])) assert(fs.existsSync(path.join(root, match[1])), `missing ${match[1]}`);
  }
}
for (const id of ['startFrequency', 'endFrequency', 'duration', 'velocityAmplitude', 'roomSize', 'roomHeight', 'gridSpacing', 'start', 'baseline', 'stop', 'csvDownload']) {
  assert(operatorHtml.includes(`id="${id}"`), `missing operator control ${id}`);
}
for (const className of ['room-floor', 'room-ceiling', 'room-front', 'room-back', 'room-left', 'room-right']) {
  assert(questHtml.includes(`class="${className}"`), `missing room surface ${className}`);
}
assert(operatorJs.includes('sessions/${window.VR_REMOTE_CONFIG.sessionId}-ap-sweep'));
assert(runtimeJs.includes('sessions/${window.VR_REMOTE_CONFIG.sessionId}-ap-sweep'));
assert(!operatorJs.includes('sessionId}/ap-sweep'));
assert(!runtimeJs.includes('sessionId}/ap-sweep'));
assert(runtimeJs.includes("'instantaneous_frequency_hz'"));
assert(runtimeJs.includes("'ap_position_m'"));
assert(runtimeJs.includes("'ap_velocity_m_s'"));
assert(runtimeJs.includes('roomHeightM: settings.roomHeightM'));
assert(!operatorHtml.includes('rotationCenter'));
assert(!questHtml.includes('stimulus-driver'));

console.log('PASS: independent operator/Quest pages, six room surfaces, isolated Firebase path, and required CSV columns');
