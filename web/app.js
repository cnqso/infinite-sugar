// iteration 1 — flybody (MuJoCo Menagerie) in MuJoCo WASM, rendered with three.js.
// Bridge pattern follows the established mujoco_wasm demos: build one three.js mesh per
// mjModel geom, then each frame copy data.geom_xpos / data.geom_xmat onto it.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import loadMujoco from './vendor/mujoco_wasm.js';

const boot = document.getElementById('boot');
const bootmsg = document.getElementById('bootmsg');
const say = (m) => { bootmsg.textContent = m; };
const $ = (id) => document.getElementById(id);

const MODEL_DIR = './model';
const SCENE_XML = 'scene.xml';

// mjtGeom
const G = { PLANE:0, HFIELD:1, SPHERE:2, CAPSULE:3, ELLIPSOID:4, CYLINDER:5, BOX:6, MESH:7 };

let mujoco, model, data, sim = { paused:false, steps:0, t0:0 };
const geomNodes = [];           // { mesh, group }
const tmpMat = new THREE.Matrix4();

// ---------------------------------------------------------------- filesystem
async function stageFiles(mj) {
  const manifest = await (await fetch(`${MODEL_DIR}/manifest.json`)).json();
  mj.FS.mkdir('/w'); mj.FS.mkdir('/w/assets');
  let done = 0;
  const files = [SCENE_XML, 'fruitfly.xml', ...manifest.assets.map(a => 'assets/' + a)];
  await Promise.all(files.map(async (f) => {
    const buf = new Uint8Array(await (await fetch(`${MODEL_DIR}/${f}`)).arrayBuffer());
    mj.FS.writeFile('/w/' + f, buf);
    if (++done % 20 === 0) say(`staging assets ${done}/${files.length}`);
  }));
  say(`staged ${files.length} files`);
}

// ---------------------------------------------------------------- geometry
function meshGeometry(m, dataid) {
  const va = m.mesh_vertadr[dataid], vn = m.mesh_vertnum[dataid];
  const fa = m.mesh_faceadr[dataid], fn = m.mesh_facenum[dataid];
  const pos = new Float32Array(vn * 3);
  const nrm = new Float32Array(vn * 3);
  pos.set(m.mesh_vert.subarray(va * 3, (va + vn) * 3));
  nrm.set(m.mesh_normal.subarray(va * 3, (va + vn) * 3));
  const idx = new Uint32Array(fn * 3);
  idx.set(m.mesh_face.subarray(fa * 3, (fa + fn) * 3));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function primitiveGeometry(type, sx, sy, sz) {
  switch (type) {
    case G.PLANE:     return new THREE.PlaneGeometry(40, 40, 1, 1);
    case G.SPHERE:    return new THREE.SphereGeometry(sx, 20, 14);
    case G.CAPSULE:   return new THREE.CapsuleGeometry(sx, 2 * sy, 6, 14);
    case G.ELLIPSOID: { const g = new THREE.SphereGeometry(1, 20, 14); g.scale(sx, sy, sz); return g; }
    case G.CYLINDER:  return new THREE.CylinderGeometry(sx, sx, 2 * sy, 20);
    case G.BOX:       return new THREE.BoxGeometry(2 * sx, 2 * sy, 2 * sz);
    default:          return null;
  }
}

// MuJoCo cylinders/capsules point along +Z; three.js primitives point along +Y.
const NEEDS_Z_UP = new Set([G.CAPSULE, G.CYLINDER]);

let _checker = null;
function checkerTexture() {
  if (_checker) return _checker;
  const N = 256, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  g.fillStyle = '#1a2430'; g.fillRect(0, 0, N, N);
  g.fillStyle = '#233042'; g.fillRect(0, 0, N/2, N/2); g.fillRect(N/2, N/2, N/2, N/2);
  _checker = new THREE.CanvasTexture(cv);
  _checker.wrapS = _checker.wrapT = THREE.RepeatWrapping;
  _checker.repeat.set(80, 80);
  _checker.colorSpace = THREE.SRGBColorSpace;
  _checker.anisotropy = 8;
  return _checker;
}

function buildScene(scene, m) {
  let tris = 0;
  for (let i = 0; i < m.ngeom; i++) {
    const type = m.geom_type[i];
    const sx = m.geom_size[i*3], sy = m.geom_size[i*3+1], sz = m.geom_size[i*3+2];
    let geo = type === G.MESH ? meshGeometry(m, m.geom_dataid[i]) : primitiveGeometry(type, sx, sy, sz);
    if (!geo) continue;
    if (NEEDS_Z_UP.has(type)) geo.rotateX(Math.PI / 2);

    // colour: MuJoCo uses geom_rgba when it was set explicitly, otherwise the material.
    // Default geom_rgba is (.5,.5,.5,1) — treat that as "not set".
    const mid = m.geom_matid[i];
    let r = m.geom_rgba[i*4], g = m.geom_rgba[i*4+1], b = m.geom_rgba[i*4+2], a = m.geom_rgba[i*4+3];
    const isDefaultRgba = (r === 0.5 && g === 0.5 && b === 0.5 && a === 1);
    if (isDefaultRgba && mid >= 0) {
      r=m.mat_rgba[mid*4]; g=m.mat_rgba[mid*4+1]; b=m.mat_rgba[mid*4+2]; a=m.mat_rgba[mid*4+3];
    }
    if (a === 0) { geo.dispose(); continue; }       // e.g. the wing inertial boxes

    const grp = m.geom_group[i];
    const isFloor = type === G.PLANE;
    const mat = isFloor
      ? new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness:.95, metalness:0 })
      : new THREE.MeshStandardMaterial({
          color: new THREE.Color(r, g, b), roughness:.55, metalness:.12,
          transparent: a < 1, opacity: a, depthWrite: a >= 1, side: THREE.DoubleSide });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = !isFloor; mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.visible = grp <= 2;                       // collision groups (3+) hidden by default
    scene.add(mesh);
    geomNodes.push({ mesh, group: grp, gi: i });   // gi = mjModel geom index
    if (geo.index) tris += geo.index.count / 3;
  }
  return tris;
}

function syncGeoms(m, d) {
  const R = d.geom_xmat;                            // row-major 3x3 per geom
  for (let k = 0, n = geomNodes.length; k < n; k++) {
    const i = geomNodes[k].gi;
    const o = geomNodes[k].mesh;
    o.position.set(d.geom_xpos[i*3], d.geom_xpos[i*3+1], d.geom_xpos[i*3+2]);
    tmpMat.set(R[i*9+0], R[i*9+1], R[i*9+2], 0,
               R[i*9+3], R[i*9+4], R[i*9+5], 0,
               R[i*9+6], R[i*9+7], R[i*9+8], 0,
               0, 0, 0, 1);
    o.quaternion.setFromRotationMatrix(tmpMat);
  }
}

// ---------------------------------------------------------------- pose hold
// 64 of the 78 actuators are position-servos. Drive them to the keyframe pose so the
// fly stands instead of collapsing — no controller, no policy, just a held posture.
let holdCtrl = null;
function captureHoldPose(m, d) {
  const c = new Float64Array(m.nu);
  for (let a = 0; a < m.nu; a++) {
    if (m.actuator_trntype[a] === 0) {            // joint transmission
      const j = m.actuator_trnid[a*2];
      c[a] = d.qpos[m.jnt_qposadr[j]];
    }
  }
  return c;
}
function resetSim() {
  mujoco.mj_resetDataKeyframe(model, data, 0);
  holdCtrl = captureHoldPose(model, data);
  data.ctrl.set(holdCtrl);
  mujoco.mj_forward(model, data);
  sim.steps = 0; sim.t0 = performance.now();
}

// ---------------------------------------------------------------- main
(async function main() {
  try {
    say('instantiating wasm');
    mujoco = await loadMujoco();
    await stageFiles(mujoco);

    say('compiling model');
    model = mujoco.MjModel.loadFromXML('/w/' + SCENE_XML);
    data  = new mujoco.MjData(model);

    // ---- three.js
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);        // MuJoCo is Z-up
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1017);
    scene.fog = new THREE.Fog(0x0b1017, 1.6, 9.0);

    const renderer = new THREE.WebGLRenderer({ antialias:true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    document.body.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(38, innerWidth/innerHeight, 0.01, 100);
    camera.up.set(0, 0, 1);
    camera.position.set(0.62, -0.62, 0.22);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.07;
    controls.target.set(0, 0, -0.06);
    controls.minDistance = 0.15; controls.maxDistance = 3;

    scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x1a2028, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(0.5, -0.7, 0.9); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const c = key.shadow.camera; c.near = 0.05; c.far = 4;
    c.left = -0.5; c.right = 0.5; c.top = 0.5; c.bottom = -0.5;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fa8ff, 0.7);
    rim.position.set(-0.8, 0.5, 0.35); scene.add(rim);

    say('building meshes');
    const tris = buildScene(scene, model);
    resetSim();
    syncGeoms(model, data);

    $('s_nbody').textContent = model.nbody;
    $('s_nu').textContent    = model.nu;
    $('s_tri').textContent   = tris.toLocaleString();

    // ---- controls
    $('b_pause').onclick = (e) => { sim.paused = !sim.paused; e.target.textContent = sim.paused ? 'resume' : 'pause'; };
    $('b_reset').onclick = () => resetSim();
    $('b_col').onchange  = (e) => { for (const g of geomNodes) if (g.group > 2) g.mesh.visible = e.target.checked; };
    let idle = true;
    $('b_idle').onchange = (e) => { idle = e.target.checked; };

    // named actuators to wiggle, purely cosmetic
    const wiggle = ['antenna_left','antenna_right','head','abdomen','head_twist']
      .map(n => mujoco.mj_name2id(model, 19 /* mjOBJ_ACTUATOR */, n)).filter(i => i >= 0);

    boot.remove();

    // ---- loop
    const dt = model.getOptions ? undefined : undefined;
    const timestep = 1e-4;                          // flybody's opt.timestep
    let last = performance.now(), acc = 0, fps = 0, fpsT = last, frames = 0, sps = 0, spsN = 0, spsT = last;

    function frame() {
      requestAnimationFrame(frame);
      // Use performance.now() rather than the rAF timestamp: the two can sit on different
      // origins, which yields a negative first delta and stalls the accumulator.
      const now = performance.now();
      const wall = Math.max(0, Math.min((now - last) / 1000, 0.05));  // clamp both ends
      last = now;

      if (!sim.paused) {
        acc = Math.min(acc + wall, 0.05);   // never try to 'catch up' more than 50 ms
        const budget = 0.012;                            // ms of stepping per frame
        const tStart = performance.now();
        let n = 0;
        while (acc > timestep && performance.now() - tStart < budget * 1000) {
          if (idle && wiggle.length) {
            const s = data.time;
            for (let k = 0; k < wiggle.length; k++) {
              data.ctrl[wiggle[k]] = holdCtrl[wiggle[k]] + 0.12 * Math.sin(2.1 * s + k * 1.3);
            }
          }
          mujoco.mj_step(model, data);
          acc -= timestep; n++;
        }
        sim.steps += n; spsN += n;
        syncGeoms(model, data);
      }

      frames++;
      if (now - fpsT > 500) { fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now; }
      if (now - spsT > 500) {
        sps = spsN * 1000 / (now - spsT); spsN = 0; spsT = now;
        $('s_sps').textContent = Math.round(sps).toLocaleString();
        $('s_rt').textContent  = (sps * timestep).toFixed(2) + '×';
      }
      $('s_fps').textContent  = fps.toFixed(0);
      $('s_time').textContent = data.time.toFixed(2) + ' s';

      controls.update();
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);

    addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    });
    window.fly = { mujoco, model, data, sim, scene, camera, renderer, geomNodes,
                   dbg: () => ({ paused: sim.paused, acc, steps: sim.steps, time: data.time,
                                 wiggle: wiggle.length, nodes: geomNodes.length }) };
    window.__flyReady = true;
  } catch (err) {
    console.error(err);
    boot.innerHTML = '<div class="err">failed to start\n\n' + (err && err.stack || err) + '</div>';
    window.__flyError = String(err && err.stack || err);
  }
})();
