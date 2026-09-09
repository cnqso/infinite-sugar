// Real connectome + lightweight canvas recorder: validate data and the display clock.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Brain } from '../dist/brain.js';
import { createNeuralMap } from '../dist/neural-map.js';
const base = new URL('../web/brain/', import.meta.url);
const meta = JSON.parse(fs.readFileSync(new URL('meta.json', base)));
const map = JSON.parse(fs.readFileSync(new URL('neural-map.json', base)));
function blob(name, Type) {
  const b = zlib.gunzipSync(fs.readFileSync(new URL(`${name}.bin.gz`, base)));
  return new Type(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
const brain = new Brain(meta, blob('indptr', Uint32Array), blob('colidx', Uint32Array),
  Float32Array.from(blob('w2', Int16Array), x => x * 0.005 / 2));
assert.equal(map.neuronCount, brain.N);
assert.equal(new Set(map.ids).size, map.ids.length);
assert(map.positions.every(Number.isFinite));
assert.equal(map.categories.length, map.ids.length);
for (const [a, b] of map.edges) {
  assert(a >= 0 && a < map.ids.length && b >= 0 && b < map.ids.length);
  const i = map.ids[a], j = map.ids[b];
  assert(brain.colidx.subarray(brain.indptr[i], brain.indptr[i + 1]).includes(j), 'every displayed link exists in the brain');
}
assert(brain.lastSpikeMs.every(t => t === -Infinity));
brain.setStim('sweet', 1);
for (let ms = 0; ms < 120; ms++) {
  const before = brain.totalSpikes;
  brain.step(1);
  assert.equal(brain.lastSpikeMs.filter(t => t === ms).length, brain.totalSpikes - before,
    'telemetry records exactly the neurons that fired in this millisecond');
}
assert(brain.lastSpikeMs.every(t => t < brain.ms));
let paints = 0;
let imagePaints = 0;
const context = {
  createRadialGradient:() => ({addColorStop() {}}),
  setTransform() {}, fillRect() { paints++; }, clearRect() { paints++; },
  drawImage() { paints++; imagePaints++; }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { paints++; },
};
const canvas = { clientWidth:230, clientHeight:132, getContext:() => context };
globalThis.document = { createElement:() => ({ getContext:() => context }) };
globalThis.devicePixelRatio = 1;
globalThis.fetch = async () => ({ ok:true, json:async () => map });
const view = await createNeuralMap(canvas, brain);
assert(paints > 0);
const pausedPaints = paints;
view.draw(); view.draw();
assert.equal(paints, pausedPaints, 'paused simulation does not animate or repaint');
brain.step(1); view.draw();
assert(paints > pausedPaints, 'new neural activity redraws the view');
const beforeResize = paints;
canvas.clientWidth = 190; view.draw();
assert(paints > beforeResize, 'resize redraws even when paused');
let beforeImages = imagePaints;
brain.setStim('sweet', 0); view.draw();
assert.equal(imagePaints - beforeImages, 1, 'sugar off draws only the backdrop, no sensory halo, even while paused');
beforeImages = imagePaints;
brain.setStim('sweet', 1); view.draw();
assert(imagePaints - beforeImages > 1, 'sugar on restores halos for actual recent sensory spikes without advancing time');
console.log('PASS: measured graph links, exact spike timestamps, pause, resume and resize');

// Responsive startup must produce precisely the same calibrated brain as synchronous startup.
const sync = new Brain(meta, brain.indptr, brain.colidx, brain.w);
const responsive = new Brain(meta, brain.indptr, brain.colidx, brain.w);
sync.setStim('sweet', 1); responsive.setStim('sweet', 1);
sync.calibrate(75); await responsive.calibrateResponsive(75);
assert.deepEqual(responsive.v, sync.v);
assert.deepEqual(responsive.rest, sync.rest);
assert.deepEqual(responsive.lastSpikeMs, sync.lastSpikeMs);
assert.equal(responsive.totalSpikes, sync.totalSpikes);
assert.equal(responsive.sugarFeedSpikes, 0);
assert.equal(responsive.sugar, 1);
console.log('PASS: yielded calibration preserves neural state, rates, spikes and stimulus switches');
