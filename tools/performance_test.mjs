import assert from 'node:assert/strict';
import { AdaptiveQuality, QUALITY } from '../dist/performance.js';
function run(q, duration, frame = 1000 / q.profile.fps, work = 5) {
  for (let t = 0; t < duration; t += frame) q.sample(frame, work);
}
const desktop = new AdaptiveQuality();
assert.equal(desktop.profile.name, 'high');
run(desktop, 1000, 80, 60);
assert.equal(desktop.level, 2, 'startup stalls do not trigger premature quality changes');
run(desktop, 10000, 45, 30);
assert.equal(desktop.level, 1, 'sustained slow rendering reduces quality');
run(desktop, 10000, 70, 55);
assert.equal(desktop.level, 0, 'continued overload reaches low quality');
run(desktop, 6000);
assert.equal(desktop.level, 0, 'recovery requires sustained headroom');
run(desktop, 18000);
assert.equal(desktop.level, 1, 'quality recovers after sustained headroom');
const mobile = new AdaptiveQuality({compact:true});
assert.equal(mobile.level, 1);
run(mobile, 60000);
assert.equal(mobile.level, 1, 'mobile retains its conservative quality ceiling');
const weak = new AdaptiveQuality({cores:2});
assert.equal(weak.level, 0);
weak.sample(30000, 1);
assert.equal(weak.level, 0, 'returning from background is not a performance sample');
assert.equal(weak.cooldownMs, 5000);
assert(QUALITY.every(p => p.budgetMs <= 12 && p.fps <= 60));
assert(QUALITY[0].pixelRatio < QUALITY[1].pixelRatio && QUALITY[0].shadowSize === 0);
console.log('PASS: conservative startup, sustained slowdown, recovery hysteresis, mobile ceiling, background reset');

// Exercise the app's actual frame and visibility handlers without a GPU.
const fs = await import('node:fs');
const vm = await import('node:vm');
const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const begin = app.indexOf('    // ---- loop');
const end = app.indexOf("    addEventListener('resize'", begin);
assert(begin >= 0 && end > begin);
let time = 0, renders = 0, steps = 0, visibility;
const simulated = {paused:true};
const doc = {hidden:false,addEventListener:(_name, fn)=>{visibility=fn;}};
const scope = vm.createContext({
  performance:{now:()=>time}, requestAnimationFrame:()=>{}, document:doc,
  quality:new AdaptiveQuality(), sim:simulated,
  $:()=>({hasAttribute:()=>false}), brain:{sugarFeedSpikes:0},
  controls:{update:()=>{}}, renderer:{render:()=>renders++}, scene:{}, camera:{},
  neuralMap:{draw:()=>{}}, stepBall:()=>{}, applyQuality:()=>{},
  stepSimulation:()=>steps++, syncGeoms:()=>{}, model:{}, data:{},
});
vm.runInContext(app.slice(begin,end)+'\nglobalThis.tick=frame; globalThis.clock=()=>({last,acc,nextFrameAt});',scope);
scope.tick(); assert.equal(renders,1);
doc.hidden=true; simulated.paused=false; time=30000; scope.tick();
assert.equal(renders,1); assert.equal(steps,0,'hidden frames never step physics');
assert.equal(scope.clock().acc,0);
simulated.paused=true; doc.hidden=false; visibility();
assert.equal(scope.clock().last,time,'visibility return resets elapsed wall time');
assert.equal(scope.clock().acc,0,'no background catch-up debt');
scope.tick(); assert.equal(steps,0); assert.equal(simulated.paused,true,'user pause survives background/resume');
console.log('PASS: actual app hidden-frame suppression, backlog reset, preserved user pause');
