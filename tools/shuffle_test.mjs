// Run the actual app's controller and clock with the vendored MuJoCo WASM and brain kernel.
// No rendering or alternative physics model. Usage: node tools/shuffle_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import loadMujoco from '../web/vendor/mujoco_wasm.js';
import { Brain } from '../web/brain.js';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const mujoco = await loadMujoco();
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/assets');
const manifest = JSON.parse(fs.readFileSync('web/model/manifest.json'));
for (const name of ['scene.xml', 'fruitfly.xml', ...manifest.assets.map(a => `assets/${a}`)]) {
  mujoco.FS.writeFile(`/w/${name}`, fs.readFileSync(`web/model/${name}`));
}
const model = mujoco.MjModel.loadFromXML('/w/scene.xml');
const data = new mujoco.MjData(model);
function blob(name, Type) {
  const buf = zlib.gunzipSync(fs.readFileSync(`web/brain/${name}.bin.gz`));
  return new Type(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
const meta = JSON.parse(fs.readFileSync('web/brain/meta.json'));
const brain = new Brain(meta, blob('indptr', Uint32Array), blob('colidx', Uint32Array),
  Float32Array.from(blob('w2', Int16Array), x => x * 0.005 / 2));
brain.calibrate();
assert.equal(brain.sugarFeedSpikes, 0, 'calibration is excluded from the artwork counter');
assert(brain.feedSpikes > 0, 'raw diagnostic retains resting spikes');
const sim = { steps:0, brainStartMs:0 };
const context = vm.createContext({ mujoco, model, data, brain, sim, performance });
const app = fs.readFileSync('web/app.js', 'utf8');
const start = app.indexOf('// ---------------------------------------------------------------- pose hold');
const end = app.indexOf('// ---------------------------------------------------------------- main', start);
assert(start >= 0 && end > start, 'controller section must exist');
vm.runInContext(app.slice(start, end) + `
globalThis.controller = { resetSim, buildDriveMap, buildShuffleMap, stepSimulation, stepShuffle,
  shuffle, get legs() { return shuffleLegs; }, get hold() { return holdCtrl; },
  setNeural(value) { neural = value; } };`, context);
const c = context.controller;
c.resetSim(); c.buildDriveMap(model, brain); c.buildShuffleMap();

function advance(seconds) {
  for (let i = 0; i < Math.round(seconds * 10000); i++) c.stepSimulation();
}
function state() {
  assert(Array.from(data.qpos).every(Number.isFinite), 'finite qpos');
  return { xyz:Array.from(data.qpos.slice(0, 3)), maxQvel:Math.max(...Array.from(data.qvel, Math.abs)) };
}
advance(1);
const initial = state();
const minZ = [initial.xyz[2]], maxZ = [initial.xyz[2]];
const visits = new Set();
let maxDrift = 0, maxLift = 0, maxRotation = 0;
const initialQuat = Array.from(data.qpos.slice(3, 7));
const footBodies = c.legs.map(l => mujoco.mj_name2id(model, 1, `claw_${l.name}`));
const footRest = footBodies.map(i => data.xpos[i * 3 + 2]);
for (let t = 0; t < 1200; t++) {
  advance(0.01);
  const s = state();
  minZ[0] = Math.min(minZ[0], s.xyz[2]); maxZ[0] = Math.max(maxZ[0], s.xyz[2]);
  maxDrift = Math.max(maxDrift, Math.hypot(s.xyz[0] - initial.xyz[0], s.xyz[1] - initial.xyz[1]));
  const dot = initialQuat.reduce((sum, x, i) => sum + x * data.qpos[i + 3], 0);
  maxRotation = Math.max(maxRotation, 2 * Math.acos(Math.min(1, Math.abs(dot))));
  if (c.shuffle.active >= 0) visits.add(c.legs[c.shuffle.active].name);
  for (let i = 0; i < footBodies.length; i++) maxLift = Math.max(maxLift, data.xpos[footBodies[i] * 3 + 2] - footRest[i]);
}
console.log('rest shuffle', { visits:[...visits], count:c.shuffle.count, maxDrift, maxLift, maxRotation, zRange:[...minZ, ...maxZ] });
assert.equal(visits.size, 6, 'all six feet adjust');
assert(maxLift > 0.002, 'actual physical foot lift');
assert(maxDrift < 0.03, 'remain within a small fraction of a body length');
assert(maxZ[0] - minZ[0] < 0.02, 'stable thorax height');
assert(maxRotation < 0.25, 'no sustained turning');

// All stimulus combinations must remain physically bounded; the feeding reflex must survive.
assert.equal(brain.sugarFeedSpikes, 0, 'resting activity never advances the artwork counter');
const rawBeforeSugar = brain.feedSpikes;
brain.setStim('sweet', 1);
advance(1);
assert(brain.sugarFeedSpikes > 0, 'sugar advances the artwork counter');
assert.equal(brain.sugarFeedSpikes, brain.feedSpikes - rawBeforeSugar, 'counter records actual feeding spikes');
assert(brain.rate.mn_proboscis > brain.rest.mn_proboscis, 'sugar still drives feeding');
for (const name of Object.keys(brain.stim)) brain.setStim(name, 1);
advance(2);
console.log('all stimuli', state());
assert(Array.from(brain.v).every(Number.isFinite), 'finite membrane potentials');
assert(data.qpos[2] > -0.04 && data.qpos[2] < 0.02, 'body stays upright under combined stimulation');
for (const name of Object.keys(brain.stim)) brain.setStim(name, 0);
// Silence the command inputs: wall/sim time alone must never request another foot movement.
const count = c.shuffle.count;
const silent = { rate:{ dn_groom:0, dn_steer_l:0, dn_steer_r:0 } };
for (let t = 0; t < 5000; t++) c.stepShuffle(silent, data, 0.001);
assert.equal(c.shuffle.count, count, 'no new shuffle with silent command populations');

// Disable all neural motion and verify that the body settles instead of drifting/oscillating.
c.setNeural(false);
advance(0.2); const early = state();
advance(2); const settled = state();
console.log('neural off', { early, settled });
assert(settled.maxQvel < 0.05, 'velocity decays after neural motion stops');
for (const leg of c.legs) for (const { ai } of leg.joints) assert(Math.abs(data.ctrl[ai] - c.hold[ai]) < 1e-8);

// The independent shuffle switch stops leg requests while the rest of the brain/body runs.
c.setNeural(true); c.shuffle.enabled = false;
const stoppedCount = c.shuffle.count, runningBrainMs = brain.ms;
advance(0.5);
assert.equal(c.shuffle.count, stoppedCount);
assert(brain.ms > runningBrainMs);
for (const leg of c.legs) assert(leg.amount < 1e-8);
c.shuffle.enabled = true;

// Reset after a long run: continue the preserved brain immediately, with a fresh body clock.
const before = brain.ms;
c.resetSim(); c.setNeural(true);
advance(0.01);
assert.equal(brain.ms, before + 10, 'brain advances immediately after reset');
assert.equal(brain.ms - sim.brainStartMs, 10);
assert(Math.abs(data.time - 0.01) < 1e-9);
const heldFeeding = brain.sugarFeedSpikes;
const rawBeforeOff = brain.feedSpikes;
advance(0.2);
assert.equal(brain.sugarFeedSpikes, heldFeeding, 'sugar off holds the counter despite residual neural activity');
assert(brain.feedSpikes > rawBeforeOff, 'neural activity continues with sugar off');
brain.setStim('sweet', 1);
advance(0.2);
assert(brain.sugarFeedSpikes > heldFeeding, 'sugar on resumes the accumulated count');
brain.setStim('sweet', 0);

console.log('PASS: feeding counter, six feet, physical lift, bounded stance, sugar response, silence, settling, reset');
