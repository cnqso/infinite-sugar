// @ts-check
// iteration 1 — flybody (MuJoCo Menagerie) in MuJoCo WASM, rendered with three.js.
// Bridge pattern follows the established mujoco_wasm demos: build one three.js mesh per
// mjModel geom, then each frame copy data.geom_xpos / data.geom_xmat onto it.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import loadMujoco from './vendor/mujoco_wasm.js';
import { Brain } from './brain.js';
import { createNeuralMap } from './neural-map.js';
import { AdaptiveQuality } from './performance.js';
import * as CANNON from 'cannon-es';

/** @typedef {import('./vendor/mujoco_wasm.js').MujocoModule} MujocoModule */
/** @typedef {import('./vendor/mujoco_wasm.js').MjModel} MjModel */
/** @typedef {import('./vendor/mujoco_wasm.js').MjData} MjData */
/** @typedef {{ mesh: THREE.Mesh, group: number, gi: number, isFloor: boolean }} GeomNode */
/** @typedef {{ file: string, target: number, abs?: [number, number, number], pos?: [number, number], rot: number }} PropDefinition */
/** @typedef {{ wrap: THREE.Group, body: CANNON.Body, radius: number, thoraxBody: number, flyProxy: CANNON.Body }} BallState */
/** @typedef {{ act: string, role: string, gain?: number, to?: number, peak?: number, band?: [number, number], raw?: [number, number], cmd?: boolean }} DriveDefinition */
/** @typedef {DriveDefinition & { ai: number, qadr: number, dadr: number }} DriveEntry */

/** @param {string} id */
function requiredElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing required element #${id}`);
  return element;
}

const boot = requiredElement('boot');
const bootmsg = requiredElement('bootmsg');
/** @param {string} message */
const say = (message) => {
  bootmsg.textContent = /calibrat/.test(message) ? 'Finding a rhythm'
    : /connectome|weights/.test(message) ? 'Connecting a brain'
    : /meshes|terrarium/.test(message) ? 'Making room'
    : 'Preparing a small world';
};
const $ = requiredElement;

const MODEL_DIR = './model';
const SCENE_XML = 'scene.xml';

// mjtGeom
const G = { PLANE:0, HFIELD:1, SPHERE:2, CAPSULE:3, ELLIPSOID:4, CYLINDER:5, BOX:6, MESH:7 };

/** @type {MujocoModule} */ let mujoco;
/** @type {MjModel} */ let model;
/** @type {MjData} */ let data;
/** @type {Brain} */ let brain;
const sim = { paused:false, steps:0, t0:0, brainStartMs:0 };
/** @type {GeomNode[]} */
const geomNodes = [];
const tmpMat = new THREE.Matrix4();

// ---------------------------------------------------------------- filesystem
/** @param {MujocoModule} mj */
async function stageFiles(mj) {
  const manifest = /** @type {{ assets: string[] }} */ (await (await fetch(`${MODEL_DIR}/manifest.json`)).json());
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
/** @param {MjModel} m @param {number} dataid */
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

/** @param {number} type @param {number} sx @param {number} sy @param {number} sz */
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

// ---------------------------------------------------------------- skybox
// Frutiger Aero: glossy, optimistic, pale blue-to-mint gradient with soft cloud blobs.
// Procedural — a canvas gradient, not a downloaded HDRI, so it costs nothing to keep in sync
// with the rest of the "no build step, no bundler" convention.
function skyTexture() {
  const W = 512, H = 512, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  if (!g) throw new Error('2D canvas is unavailable');
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0.00, '#8fc7ef');
  sky.addColorStop(0.45, '#bfe3ef');
  sky.addColorStop(0.78, '#e3f6ee');
  sky.addColorStop(1.00, '#f3fff6');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);

  // a soft glossy sun-glow, upper-left — subtle, not a lens flare
  const glow = g.createRadialGradient(W*0.28, H*0.20, 0, W*0.28, H*0.20, W*0.32);
  glow.addColorStop(0, 'rgba(255,255,255,0.55)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);

  // a handful of soft cloud blobs, low contrast
  const clouds = [[0.62,0.30,0.14],[0.74,0.34,0.09],[0.20,0.55,0.11],[0.85,0.62,0.08],[0.45,0.68,0.10]];
  for (const [cx, cy, r] of clouds) {
    const cg = g.createRadialGradient(W*cx, H*cy, 0, W*cx, H*cy, W*r);
    cg.addColorStop(0, 'rgba(255,255,255,0.5)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cg; g.fillRect(0, 0, W, H);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** @type {THREE.CanvasTexture | null} */
let _checker = null;
function checkerTexture() {
  if (_checker) return _checker;
  const N = 256, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  if (!g) throw new Error('2D canvas is unavailable');
  g.fillStyle = '#1a2430'; g.fillRect(0, 0, N, N);
  g.fillStyle = '#233042'; g.fillRect(0, 0, N/2, N/2); g.fillRect(N/2, N/2, N/2, N/2);
  _checker = new THREE.CanvasTexture(cv);
  _checker.wrapS = _checker.wrapT = THREE.RepeatWrapping;
  _checker.repeat.set(80, 80);
  _checker.colorSpace = THREE.SRGBColorSpace;
  _checker.anisotropy = 8;
  return _checker;
}

/** @param {THREE.Scene} scene @param {MjModel} m */
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
    mesh.visible = grp <= 2 && !isFloor;           // collision groups (3+) hidden by default;
                                                    // checker floor hidden — terrarium.glb's own
                                                    // floor sits flush over it (see PROPS above)
    scene.add(mesh);
    geomNodes.push({ mesh, group: grp, gi: i, isFloor });   // gi = mjModel geom index
    if (geo.index) tris += geo.index.count / 3;
  }
  return tris;
}

/** @param {MjModel} m @param {MjData} d */
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

// ---------------------------------------------------------------- terrarium
// Purely decorative CC-BY props (web/model/props/CREDITS.md), staged around the fly by
// measured scale rather than eyeballed units: each prop's own bounding box is computed after
// load and rescaled against the fly's actual bounding box, so this survives model changes.
// No physics involvement — these do not exist in the MuJoCo model and cast/receive shadows only.
/** @type {PropDefinition[]} */
const PROPS = [
  // abs: tuned by hand via a live debug panel (x/y/z inputs bound straight to this object's
  // position) — not derived, not guessed. z sits the terrarium's floor flush with the world floor.
  { file: 'terrarium.glb', target: 8.25, abs: [-0.5, -0.15, 1.58729], rot: 0 },
];
/** @type {Record<string, THREE.Group>} */
const propObjs = {};   // filename -> THREE.Group, for the live position debug panel
/** @param {THREE.Scene} scene @param {THREE.Box3} flyBox */
async function loadProps(scene, flyBox) {
  const flySize = new THREE.Vector3();
  flyBox.getSize(flySize);
  const flySpan = Math.max(flySize.x, flySize.y);   // footprint, not height — props are floor items
  const loader = new GLTFLoader();
  for (const p of PROPS) {
    let gltf;
    try {
      gltf = await loader.loadAsync(`./model/props/${p.file}`);
    } catch (err) {
      console.warn(`prop "${p.file}" failed to load — skipping`, err);
      continue;
    }
    const raw = gltf.scene;
    raw.rotation.x = Math.PI / 2;   // glTF is Y-up; this scene is Z-up (matches MuJoCo)

    // Old Google-Poly-era exports (which most free CC-BY props are) often carry a baked root
    // transform with the mesh sitting far from local (0,0,0) — trusting the file's own origin
    // put objects hundreds of units away. Measure the true bounding box and recenter blind to
    // whatever origin the file shipped with.
    const box0 = new THREE.Box3().setFromObject(raw);
    const size0 = new THREE.Vector3(), center0 = new THREE.Vector3();
    box0.getSize(size0); box0.getCenter(center0);
    raw.position.sub(center0);              // bbox center now sits at raw's local origin

    const rawSpan = Math.max(size0.x, size0.y, size0.z) || 1;
    const scale = (flySpan * p.target) / rawSpan;

    const wrap = new THREE.Group();
    wrap.add(raw);
    wrap.scale.setScalar(scale);

    if (p.abs) {
      wrap.position.set(...p.abs);
    } else {
      if (!p.pos) throw new Error(`prop "${p.file}" needs abs or pos coordinates`);
      const box1 = new THREE.Box3().setFromObject(wrap);  // re-measure post-scale, world origin
      wrap.position.set(p.pos[0] * flySpan, p.pos[1] * flySpan, -box1.min.z);
    }
    wrap.rotation.z = p.rot;
    wrap.traverse(n => { if (n instanceof THREE.Mesh) { n.castShadow = true; n.receiveShadow = true; } });
    scene.add(wrap);
    propObjs[p.file] = wrap;
  }
}

// ---------------------------------------------------------------- beach ball physics
// cannon-es (vendored single-file ESM, github.com/pmndrs/cannon-es), not a hand-rolled raycast
// sim. The terrarium's own geometry is baked directly into static trimesh colliders — the real
// hill mesh and the real glass mesh (isolated by its alpha-blend material, confirmed against the
// glTF's material table), not an approximated cylinder. cannon-es owns integration, friction,
// restitution and rolling (real angular velocity from contact friction, not a cosmetic spin);
// world.step()'s own fixed-timestep sub-stepping is what prevents tunneling through the glass at
// low render framerate, rather than a hand-clamped frame delta.
/** @type {BallState | null} */ let ball = null;
/** @type {CANNON.World | null} */ let world = null;
const _ray = new THREE.Raycaster();      // still used once at load, to find the "hilltop" start
const _down = new THREE.Vector3(0, 0, -1);
/** @param {THREE.Object3D[]} meshes @param {number} x @param {number} y */
function groundUnder(meshes, x, y) {
  _ray.set(new THREE.Vector3(x, y, 50), _down);
  const hits = _ray.intersectObjects(meshes, true);
  return hits.length ? hits[0] : null;
}

// Bakes a THREE mesh's real triangles (in world space, at load time — the terrarium never
// moves) into a flat vertex/index pair, ready to append into a combined CANNON.Trimesh.
/** @param {THREE.Mesh} mesh @param {number[]} vertsOut @param {number[]} idxOut */
function bakeMeshTriangles(mesh, vertsOut, idxOut) {
  mesh.updateWorldMatrix(true, false);
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const base = vertsOut.length / 3;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    vertsOut.push(v.x, v.y, v.z);
  }
  if (geo.index) {
    for (let i = 0; i < geo.index.count; i++) idxOut.push(base + geo.index.getX(i));
  } else {
    for (let i = 0; i < pos.count; i++) idxOut.push(base + i);
  }
}
/** @param {THREE.Mesh[]} meshes */
function trimeshFromMeshes(meshes) {
  if (!meshes.length) return null;
  /** @type {number[]} */ const verts = [];
  /** @type {number[]} */ const idx = [];
  for (const m of meshes) bakeMeshTriangles(m, verts, idx);
  return new CANNON.Trimesh(verts, idx);
}

/**
 * @param {THREE.Scene} scene
 * @param {THREE.Box3} flyBox
 * @param {THREE.Mesh[]} hillMeshes
 * @param {THREE.Mesh[]} glassMeshes
 * @param {THREE.Mesh[]} solidMeshes
 */
async function loadBall(scene, flyBox, hillMeshes, glassMeshes, solidMeshes) {
  const flySize = new THREE.Vector3();
  flyBox.getSize(flySize);
  const flySpan = Math.max(flySize.x, flySize.y);
  const loader = new GLTFLoader();
  let gltf;
  try {
    gltf = await loader.loadAsync('./model/props/beach_ball.glb');
  } catch (err) {
    console.warn('beach ball failed to load — skipping', err);
    return;
  }
  const raw = gltf.scene;
  raw.rotation.x = Math.PI / 2;
  const box0 = new THREE.Box3().setFromObject(raw);
  const size0 = new THREE.Vector3(), center0 = new THREE.Vector3();
  box0.getSize(size0); box0.getCenter(center0);
  raw.position.sub(center0);
  const rawSpan = Math.max(size0.x, size0.y, size0.z) || 1;
  const scale = (flySpan * 0.55) / rawSpan;
  const wrap = new THREE.Group();
  wrap.add(raw);
  wrap.scale.setScalar(scale);
  wrap.traverse(n => { if (n instanceof THREE.Mesh) { n.castShadow = true; n.receiveShadow = true; } });
  scene.add(wrap);
  propObjs['beach_ball.glb'] = wrap;

  const box1 = new THREE.Box3().setFromObject(wrap);
  const radius = Math.max(0.001, (box1.max.z - box1.min.z) / 2);

  // sample the terrarium's own surface for its highest reachable point ("top of the hill") —
  // not hand-placed, found the same way a marble dropped at random would find it. One-time
  // query at load, so a plain raycast (not a physics query) is the right tool.
  /** @type {THREE.Intersection | null} */
  let best = null;
  for (let i = 0; i < 40; i++) {
    const x = -0.5 + (Math.random() - 0.5) * flySpan * 3.2;
    const y = -0.15 + (Math.random() - 0.5) * flySpan * 3.2;
    const hit = groundUnder(hillMeshes, x, y);
    if (hit && (!best || hit.point.z > best.point.z)) best = hit;
  }
  const start = best ? best.point : new THREE.Vector3(-0.5, -0.15, 1.6);
  wrap.position.set(start.x, start.y, start.z + radius + flySpan * 0.05);

  // ---- cannon-es world ----
  const physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, -1.6) });   // stylized — small terrarium
  physicsWorld.broadphase = new CANNON.SAPBroadphase(physicsWorld);
  physicsWorld.allowSleep = true;
  world = physicsWorld;

  const groundMat = new CANNON.Material('ground');
  const ballMat = new CANNON.Material('ball');
  physicsWorld.addContactMaterial(new CANNON.ContactMaterial(groundMat, ballMat, {
    friction: 0.5, restitution: 0.35,
  }));

  const terrainBody = new CANNON.Body({ mass: 0, material: groundMat });
  // Collision uses every opaque mesh (rocks, floor, flowers, fern, frame) — NOT hillMeshes,
  // which is height-filtered down to short ground-level decor for a different purpose (finding
  // a "hilltop" to start the ball on, below). Reusing that filtered set as the collider was the
  // actual bug: the fern and flowers were excluded from collision entirely, so the ball rolled
  // straight through them. A wall doesn't stop being solid for being tall.
  const solidTri = trimeshFromMeshes(solidMeshes);
  if (solidTri) terrainBody.addShape(solidTri);
  const glassTri = trimeshFromMeshes(glassMeshes);
  if (glassTri) terrainBody.addShape(glassTri);

  // Backstop: old Google-Poly-era decorative exports are built for rendering, not physics, and
  // are routinely NOT watertight — measured, the real glass trimesh has a seam somewhere (a ball
  // rolled through it at a perfectly ordinary 2 u/s in testing, nowhere near a tunneling speed).
  // A ring of inward-facing infinite planes is defense in depth: the real mesh still gives the
  // close-up bounce its correct shape, this just guarantees nothing ever visibly escapes through
  // whatever gap the source model has. (Not a solid Cylinder shape — that's filled geometry, and
  // spawning the ball inside one gets it shoved OUTWARD as overlap resolution, the exact opposite
  // of containment. A CANNON.Plane's solid side is behind its local +Z normal, so a ring of them
  // with normals pointing inward is a real hollow boundary, not a solid object to be pushed out of.)
  if (glassMeshes.length) {
    const gbox = new THREE.Box3();
    for (const m of glassMeshes) gbox.expandByObject(m);
    const gsize = new THREE.Vector3(), gcenter = new THREE.Vector3();
    gbox.getSize(gsize); gbox.getCenter(gcenter);
    const backstopRadius = 0.85 * Math.min(gsize.x, gsize.y) / 2;
    const N = 12;
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0);   // outward
      const pos = dir.clone().multiplyScalar(backstopRadius).add(gcenter);
      const q3 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().negate());
      terrainBody.addShape(new CANNON.Plane(),
        new CANNON.Vec3(pos.x, pos.y, pos.z),
        new CANNON.Quaternion(q3.x, q3.y, q3.z, q3.w));
    }
  }
  physicsWorld.addBody(terrainBody);

  const ballBody = new CANNON.Body({
    mass: 0.05, shape: new CANNON.Sphere(radius), material: ballMat,
    linearDamping: 0.05, angularDamping: 0.1,
    position: new CANNON.Vec3(wrap.position.x, wrap.position.y, wrap.position.z),
  });
  physicsWorld.addBody(ballBody);

  // fly proxy: a KINEMATIC body (moves the world, is never moved by it) at the thorax's live
  // MuJoCo position — genuinely one-way, not a hand-rolled approximation of one-way. The fly's
  // real physics is never written to; cannon-es's own kinematic/dynamic contact handles the push.
  const thoraxBody = mujoco.mj_name2id(model, 1 /* mjOBJ_BODY */, 'thorax');
  const flyProxy = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC,
                                      shape: new CANNON.Sphere(flySpan * 0.5), material: groundMat });
  physicsWorld.addBody(flyProxy);

  ball = { wrap, body: ballBody, radius, thoraxBody, flyProxy };
}

/** @param {number} dt */
function stepBall(dt) {
  if (!ball || !world || dt <= 0) return;
  if (ball.thoraxBody >= 0 && data) {
    const bi = ball.thoraxBody * 3;
    ball.flyProxy.position.set(data.xpos[bi], data.xpos[bi + 1], data.xpos[bi + 2]);
  }
  world.step(1 / 120, dt, 10);   // fixed-timestep sub-stepping — the engine's own tunneling fix
  ball.wrap.position.copy(ball.body.position);
  ball.wrap.quaternion.copy(ball.body.quaternion);
}

// ---------------------------------------------------------------- pose hold
// 64 of the 78 actuators are position-servos. Drive them to the keyframe pose so the
// fly stands instead of collapsing — no controller, no policy, just a held posture.
/** @type {Float64Array} */
let holdCtrl;
/** @param {MjModel} m @param {MjData} d */
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
  sim.brainStartMs = brain.ms; // preserve the brain, restart the body's clock beneath it
  resetShuffle();
}

// ------------------------------------------------------------- brain -> body
// Spike rate of an identified motor-neuron population -> position-servo target.
// No policy, nothing learned, nothing scripted: each of these motor pools is individually
// identified in FlyWire and the joint it drives physically exists in flybody.
//
//   proboscis_motor_neuron (24) -> rostrum / haustellum / labrum   (feeding)
//   neck_motor_neuron      (26) -> head / head_twist / head_abduct (13 per side)
//   antennal_motor_neuron  (10) -> antenna_* x6                    (5 per side)
//
// COMMAND mappings are a DIFFERENT and weaker claim, kept visibly separate. FAFB is brain-only:
// wing and leg motor neurons live in the ventral nerve cord, which is not in this dataset. A
// descending neuron says "escape"; the posture it produces is supplied by us, not measured.
//
//   DNp02/04/11 'dn_escwing' (6) -> wing_roll / wing_yaw   (escape wing raise)
//   DNg11       'dn_groom'   (6) -> abdomen                (grooming)
//
// `gain` is how many multiples of the RESTING rate map to full joint excursion. Resting rates
// are measured at load by brain.calibrate() — they depend on the kernel, not just the wiring.
/** @type {DriveDefinition[]} */
const DRIVE = [
  { act:'rostrum',              role:'mn_proboscis', gain:2.0, to:-1.24 },
  { act:'haustellum',           role:'mn_proboscis', gain:2.0, to:-1.59 },
  { act:'labrum_left',          role:'mn_proboscis', gain:2.0, to: 1.05 },
  { act:'labrum_right',         role:'mn_proboscis', gain:2.0, to: 1.05 },
  { act:'head',                 role:'mn_neck_r',    gain:3.0, to:-0.30 },
  { act:'head_twist',           role:'mn_neck_r',    gain:2.0, to: 0.30 },
  { act:'head_abduct',          role:'mn_neck_l',    gain:1.3, to: 0.20 },
  { act:'antenna_left',         role:'mn_antenna_l', gain:4.0, to: 0.50 },
  { act:'antenna_abduct_left',  role:'mn_antenna_l', gain:4.0, to: 0.80 },
  { act:'antenna_twist_left',   role:'mn_antenna_l', gain:4.0, to: 0.09 },
  { act:'antenna_right',        role:'mn_antenna_r', gain:4.0, to: 0.50 },
  { act:'antenna_abduct_right', role:'mn_antenna_r', gain:4.0, to: 0.80 },
  { act:'antenna_twist_right',  role:'mn_antenna_r', gain:4.0, to: 0.09 },
  // --- command mappings (see note above): absolute-rate activation, silent at rest ---
  // Wing actuators are FORCE generals (gainprm, no position bias) against very weak joint
  // springs (stiffness 0.01). Measured torque balance: the usable control band is roughly
  // ctrl in [-0.004, +0.010] — past that the joint pins against its stop and stops responding,
  // which is what made the pose lock rigidly. A PD loop here is unstable (the actuator is far
  // too strong relative to the spring), so this stays open-loop inside the proportional band.
  // ctrl 0 = no torque = the spring's natural folded pose. Ranges below are measured.
  // The wings sum THREE populations per joint (see applyBrainToActuators — several DRIVE rows
  // may target one actuator and their contributions add). Escape alone gave only two states,
  // because dn_escwing genuinely measures 0.0 +/- 0.0 Hz under every stimulus except looming —
  // that is the real data, not a wiring gap. The life comes from adding pools that are actually
  // active at rest.
  //
  // WINGCLAMP keeps the sum inside the measured proportional band; past it the joint pins
  // against its stop and stops responding to the neurons at all.
  //
  // (a) postural / idle -- DNa01+DNa02 steering DNs. Measured at rest: L 70.2 +/- 19.6 Hz,
  //     R 54.3 +/- 18.6 Hz. Large jitter AND a real standing left/right asymmetry, which
  //     INVERTS under touch (L 38.5, R 58.9) -- so the wings visibly re-trim. Steering DNs
  //     modulating left/right wing amplitude asymmetrically is their documented function, so
  //     side->side is the correct mapping rather than an arbitrary one. Deliberately small
  //     amplitude: a resting fly adjusts its wings, it does not flap them.
  { act:'wing_yaw_left',    role:'dn_steer_l',   band:[20,110], raw:[0, -0.0018], cmd:true },
  { act:'wing_yaw_right',   role:'dn_steer_r',   band:[20,110], raw:[0, -0.0018], cmd:true },
  { act:'wing_roll_left',   role:'dn_steer_l',   band:[20,110], raw:[0,  0.0010], cmd:true },
  { act:'wing_roll_right',  role:'dn_steer_r',   band:[20,110], raw:[0,  0.0010], cmd:true },
  // (b) grooming flutter -- DNg11. 22.9 +/- 6.8 Hz at rest, 33.8 Hz on touch (+48%). Flies
  //     groom their wings with the hind legs; a pitch twitch is the visible correlate.
  { act:'wing_pitch_left',  role:'dn_groom',     band:[8,45],   raw:[0,  0.0030], cmd:true },
  { act:'wing_pitch_right', role:'dn_groom',     band:[8,45],   raw:[0,  0.0030], cmd:true },
  // (c) escape deploy -- DNp02/04/11. Silent at rest, 221 Hz (L) / 170 Hz (R) on looming; note
  //     even the escape response is naturally asymmetric between the two sides.
  { act:'wing_roll_left',   role:'dn_escwing_l', peak:300, raw:[0,  0.0030], cmd:true },
  { act:'wing_roll_right',  role:'dn_escwing_r', peak:300, raw:[0,  0.0030], cmd:true },
  { act:'wing_yaw_left',    role:'dn_escwing_l', peak:300, raw:[0, -0.0035], cmd:true },
  { act:'wing_yaw_right',   role:'dn_escwing_r', peak:300, raw:[0, -0.0035], cmd:true },
  { act:'wing_pitch_left',  role:'dn_escwing_l', peak:300, raw:[0,  0.0080], cmd:true },
  { act:'wing_pitch_right', role:'dn_escwing_r', peak:300, raw:[0,  0.0080], cmd:true },
  { act:'abdomen',          role:'dn_groom',     gain:1.5, to:-0.15, cmd:true },
];
/** @type {DriveEntry[]} */
let driveMap = [];
/** @type {[number, DriveEntry[]][]} */
let driveGroups = [];          // [actuatorIndex, entries[]] — several pools may drive one joint
const WINGCLAMP = [-0.0055, 0.0105];   // measured usable band; past this the joint pins

// Purely cosmetic resting offset. The folded pose clips the wings through the abdomen, so lift
// them (roll+) and sweep them outward (yaw-) a little. This is a constant added to the base,
// ON TOP of whatever the neurons are doing — it shifts the resting posture without touching any
// neural mapping, so every response above still plays out from the new rest position.
// Signs follow the measured ctrl->angle curves: roll+ raises, yaw- sweeps outward.
/** @type {Record<string, number>} */
const WINGBIAS = {
  wing_roll_left:   0.0012, wing_roll_right:  0.0012,
  wing_yaw_left:   -0.0012, wing_yaw_right:  -0.0012,
  wing_pitch_left:  0.0000, wing_pitch_right: 0.0000,
};
/** @param {MjModel} m @param {Brain} b */
function buildDriveMap(m, b) {
  driveMap = DRIVE
    .map(d => {
      const ai = mujoco.mj_name2id(m, 19 /* mjOBJ_ACTUATOR */, d.act);
      const ji = mujoco.mj_name2id(m, 3 /* mjOBJ_JOINT */, d.act);
      return { ...d, ai, qadr: ji >= 0 ? m.jnt_qposadr[ji] : -1, dadr: ji >= 0 ? m.jnt_dofadr[ji] : -1 };
    })
    .filter(d => d.ai >= 0 && b.groups[d.role] && b.groups[d.role].length);
  /** @type {Map<number, DriveEntry[]>} */
  const byAct = new Map();
  for (const d of driveMap) {
    if (!byAct.has(d.ai)) byAct.set(d.ai, []);
    const entries = byAct.get(d.ai);
    if (entries) entries.push(d);
  }
  driveGroups = [...byAct.entries()];
}

// Three activation modes, one per kind of population:
//   peak — pools silent at rest (escape DNs): absolute rate / peak.
//   band — pools with a real resting rate (steering, grooming): a fixed window shared by both
//          sides, so the natural left/right rate difference survives as a real pose difference
//          rather than being normalised away.
//   gain — ratio to each pool's own measured resting rate (the motor-neuron pools).
/** @param {Brain} b @param {DriveEntry} k */
function activation(b, k) {
  let a;
  if (k.peak)      a = b.rate[k.role] / k.peak;
  else if (k.band) a = (b.rate[k.role] - k.band[0]) / (k.band[1] - k.band[0]);
  else {
    if (k.gain === undefined) throw new Error(`drive ${k.act} has no activation scale`);
    const rest = (b.rest && b.rest[k.role]) || 1;
    a = (b.rate[k.role] / rest - 1) / (k.gain - 1);
  }
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

let neural = true;
/** @param {Brain} b @param {MjData} d */
function applyBrainToActuators(b, d) {
  for (const [ai, entries] of driveGroups) {
    const first = entries[0];
    const base = (first.raw ? first.raw[0] : holdCtrl[ai]) + (WINGBIAS[first.act] || 0);
    if (!neural) { d.ctrl[ai] = base; continue; }
    let v = base;
    for (const k of entries) {
      const a = activation(b, k);
      if (k.raw) v += a * (k.raw[1] - k.raw[0]);
      else {
        if (k.to === undefined) throw new Error(`drive ${k.act} has no target`);
        v += a * (k.to - holdCtrl[ai]);
      }
    }
    if (first.raw) v = Math.max(WINGCLAMP[0], Math.min(WINGCLAMP[1], v));
    d.ctrl[ai] = v;
  }
}

// ------------------------------------------------------------- neural foot shuffle
// A supplied command mapping, like the wings: FAFB contains descending neurons, not the
// leg motor circuit. DNg11 activity accumulates into a request; ipsilateral steering activity
// scales the lift. The small flexion-and-return pattern is ours, not a reconstructed gait.
// No random timer, root translation, force on the thorax, or change to the brain kernel.
/** @typedef {{ name: string, role: string, joints: { ai: number, offset: number }[], amount: number }} ShuffleLeg */
/** @type {ShuffleLeg[]} */
let shuffleLegs = [];
const shuffle = { enabled:true, active:-1, next:0, phase:0, charge:0,
                  cooldown:0.65, duration:0.5, strength:0, count:0 };

function buildShuffleMap() {
  // Alternate sides and leg pairs, leaving five legs at their standing targets.
  const order = ['T1_left', 'T3_right', 'T2_left', 'T1_right', 'T3_left', 'T2_right'];
  shuffleLegs = order.map(name => {
    const offsets = name.startsWith('T1') ? [-0.30, -0.23]
                  : name.startsWith('T2') ? [-0.22, -0.20] : [-0.27, -0.23];
    const joints = ['femur', 'tibia'].map((joint, i) => {
      const ai = mujoco.mj_name2id(model, 19, `${joint}_${name}`);
      if (ai < 0) throw new Error(`missing shuffle actuator ${joint}_${name}`);
      return { ai, offset:offsets[i] };
    });
    return { name, role:name.endsWith('left') ? 'dn_steer_l' : 'dn_steer_r', joints, amount:0 };
  });
  resetShuffle();
}

function resetShuffle() {
  Object.assign(shuffle, { active:-1, next:0, phase:0, charge:0,
                           cooldown:0.65, strength:0, count:0 });
  for (const leg of shuffleLegs) leg.amount = 0;
}

/** @param {Brain} b @param {MjData} d @param {number} dt simulated seconds */
function stepShuffle(b, d, dt) {
  const enabled = neural && shuffle.enabled;
  if (!enabled) {
    shuffle.active = -1; shuffle.charge = 0; shuffle.cooldown = 0.2;
  } else if (shuffle.active >= 0) {
    shuffle.phase = Math.min(1, shuffle.phase + dt / shuffle.duration);
    if (shuffle.phase >= 1) { shuffle.active = -1; shuffle.cooldown = 0.2; }
  } else if (shuffle.cooldown > 0) {
    shuffle.cooldown = Math.max(0, shuffle.cooldown - dt);
  } else {
    const groom = Math.max(0, b.rate.dn_groom || 0);
    // Eight population-equivalent spikes per request; silent neurons cannot trigger a shuffle.
    shuffle.charge += Math.min(100, groom) * dt;
    if (shuffle.charge >= 8 && shuffleLegs.length) {
      shuffle.active = shuffle.next;
      shuffle.next = (shuffle.next + 1) % shuffleLegs.length;
      shuffle.charge = 0; shuffle.phase = 0; shuffle.count++;
      const steer = Math.max(0, b.rate[shuffleLegs[shuffle.active].role] || 0);
      shuffle.strength = 0.65 + 0.35 * Math.min(1, steer / 100);
      shuffle.duration = 0.42 + 0.14 / (1 + groom / 30);
    }
  }
  // A single smooth lift-and-return pulse, not a free-running idle oscillator. The short
  // filter also lowers a lifted foot gently when neural drive or shuffle is switched off.
  const blend = 1 - Math.exp(-dt / 0.025);
  for (let i = 0; i < shuffleLegs.length; i++) {
    const leg = shuffleLegs[i];
    const target = i === shuffle.active ? shuffle.strength * Math.sin(Math.PI * shuffle.phase) ** 2 : 0;
    leg.amount += (target - leg.amount) * blend;
    for (const { ai, offset } of leg.joints) {
      d.ctrl[ai] = Math.max(model.actuator_ctrlrange[2 * ai],
        Math.min(model.actuator_ctrlrange[2 * ai + 1], holdCtrl[ai] + offset * leg.amount));
    }
  }
}

function stepSimulation() {
  mujoco.mj_step(model, data);
  sim.steps++;
  // Exactly one brain millisecond per ten physics steps, including the frame's compute budget.
  // Neither calibration nor a body reset can put the brain ahead and freeze neural updates.
  if (sim.steps % 10 === 0) {
    brain.step(1);
    applyBrainToActuators(brain, data);
    stepShuffle(brain, data, 0.001);
  }
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

    brain = await Brain.load('./brain', say);
    say('calibrating resting rates');
    await brain.calibrateResponsive(2500);
    say('brain ready');

    // ---- three.js
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);        // MuJoCo is Z-up
    const scene = new THREE.Scene();
    scene.background = skyTexture();
    scene.fog = new THREE.Fog(0xcdeaf0, 3.5, 14.0);   // matches the sky's mid-tone

    const device = /** @type {Navigator & {deviceMemory?:number}} */ (navigator);
    const quality = new AdaptiveQuality({
      compact:matchMedia('(pointer:coarse)').matches || Math.min(innerWidth, innerHeight) <= 700,
      cores:device.hardwareConcurrency || 8, memory:device.deviceMemory || 8,
    });
    const renderer = new THREE.WebGLRenderer({ antialias:quality.level === 2, powerPreference:'low-power' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality.profile.pixelRatio));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = quality.profile.shadowSize > 0;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    document.body.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', `${document.body.dataset.namedFly || 'Fly'}, live fruit fly simulation. Drag to orbit; scroll to zoom.`);
    renderer.domElement.setAttribute('role', 'img');

    // Keep the fly's horizontal framing on narrow screens rather than cropping its wings.
    const viewFov = () => 2 * Math.atan(Math.tan(19 * Math.PI / 180) / Math.min(1, innerWidth / innerHeight)) * 180 / Math.PI;
    const camera = new THREE.PerspectiveCamera(viewFov(), innerWidth/innerHeight, 0.01, 100);
    camera.up.set(0, 0, 1);
    camera.position.set(0.62, -0.62, 0.22);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.07;
    controls.target.set(-0.03, 0, -0.04);
    controls.minDistance = 0.15; controls.maxDistance = 12;
    const homePosition = camera.position.clone();
    const homeTarget = controls.target.clone();
    $('b_home').onclick = () => {
      camera.position.copy(homePosition); controls.target.copy(homeTarget); controls.update();
    };

    scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x1a2028, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(0.5, -0.7, 0.9); key.castShadow = true;
    key.shadow.mapSize.set(quality.profile.shadowSize || 512, quality.profile.shadowSize || 512);
    const c = key.shadow.camera; c.near = 0.05; c.far = 4;
    c.left = -0.5; c.right = 0.5; c.top = 0.5; c.bottom = -0.5;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fa8ff, 0.7);
    rim.position.set(-0.8, 0.5, 0.35); scene.add(rim);

    say('building meshes');
    const tris = buildScene(scene, model);
    resetSim();
    syncGeoms(model, data);

    say('staging terrarium');
    const flyBox = new THREE.Box3();
    for (const g of geomNodes) if (g.group <= 2 && !g.isFloor) flyBox.expandByObject(g.mesh);
    loadProps(scene, flyBox).then(() => {
      wireDebugPanel();
      const terrarium = propObjs['terrarium.glb'];
      /** @type {THREE.Mesh[]} */
      const hillMeshes = [];
      // Only the terrain/decor meshes are "ground" for the ball to land on — exclude the glass
      // shell (transparent) and the black metal frame (opaque but not something to rest on),
      // or a random hill-top search finds the outside of the glass roof, the tallest thing there.
      /** @param {THREE.Mesh} n @returns {[number, number]} */
      function worldZRange(n) {
        n.updateWorldMatrix(true, false);
        const geo = n.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox;
        if (!bb) throw new Error('mesh has no bounding box');
        let zmin = Infinity, zmax = -Infinity;
        for (const cx of [bb.min.x, bb.max.x]) for (const cy of [bb.min.y, bb.max.y]) for (const cz of [bb.min.z, bb.max.z]) {
          const v = new THREE.Vector3(cx, cy, cz).applyMatrix4(n.matrixWorld);
          if (v.z < zmin) zmin = v.z;
          if (v.z > zmax) zmax = v.z;
        }
        return [zmin, zmax];
      }
      /** @type {THREE.Mesh[]} */
      const glassMeshes = [];
      /** @type {THREE.Mesh[]} */
      const solidMeshes = [];
      if (terrarium) {
        // The tall fern is built from many short stacked segments, so no single mesh's own
        // span flags it as "tall" — filter by absolute height instead. Ground-level decor (the
        // hill mound, rocks, low flowers) sits in the bottom slice of the terrarium; anything
        // climbing toward the glass roof is foliage reaching upward, not something to land on.
        let zminAll = Infinity, zmaxAll = -Infinity;
        terrarium.traverse(n => {
          if (!(n instanceof THREE.Mesh)) return;
          const [zmin, zmax] = worldZRange(n);
          if (zmin < zminAll) zminAll = zmin;
          if (zmax > zmaxAll) zmaxAll = zmax;
        });
        const hillCeiling = zminAll + (zmaxAll - zminAll) * 0.30;
        // The glass shell is the model's one alpha-blend material (confirmed against the glTF's
        // own material table — everything else is opaque) — a real collider baked from that
        // mesh, not a cylinder approximating its footprint.
        terrarium.traverse(n => {
          if (!(n instanceof THREE.Mesh)) return;
          const material = Array.isArray(n.material) ? n.material[0] : n.material;
          if (material.transparent) glassMeshes.push(n);
        });
        terrarium.traverse(n => {
          if (!(n instanceof THREE.Mesh)) return;
          const material = Array.isArray(n.material) ? n.material[0] : n.material;
          if (material.transparent) return;
          solidMeshes.push(n);                     // everything opaque — the real collision set
          if (material instanceof THREE.MeshStandardMaterial && material.color.getHexString() === '191919') return;
          const [, zmax] = worldZRange(n);
          if (zmax > hillCeiling) return;
          hillMeshes.push(n);                       // short ground-level decor only — for the
        });                                          // hilltop-placement search below
      }
      if (hillMeshes.length) {
        loadBall(scene, flyBox, hillMeshes, glassMeshes, solidMeshes).catch(err => console.warn('loadBall failed', err));
      }
    }).catch(err => console.warn('loadProps failed', err));

    buildDriveMap(model, brain);
    buildShuffleMap();
    brain.setStim('sweet', 1);
    $('s_neu').textContent = brain.N.toLocaleString();
    $('s_syn').textContent = brain.meta.E.toLocaleString();
    $('s_nbody').textContent = String(model.nbody);
    $('s_nu').textContent    = String(model.nu);
    $('s_tri').textContent   = tris.toLocaleString();

    // ---- controls
    $('b_pause').onclick = (e) => {
      sim.paused = !sim.paused;
      document.body.classList.toggle('is-paused', sim.paused);
      if (e.currentTarget instanceof HTMLElement) {
        e.currentTarget.setAttribute('aria-label', sim.paused ? 'Resume' : 'Pause');
        e.currentTarget.title = sim.paused ? 'Resume' : 'Pause';
      }
    };
    $('b_reset').onclick = () => { resetSim(); syncGeoms(model, data); };
    $('b_col').onchange  = (e) => {
      if (!(e.currentTarget instanceof HTMLInputElement)) return;
      for (const g of geomNodes) if (g.group > 2) g.mesh.visible = e.currentTarget.checked;
    };
    $('b_idle').onchange = (e) => {
      if (e.currentTarget instanceof HTMLInputElement) neural = e.currentTarget.checked;
    };
    $('b_shuffle').onchange = (e) => {
      if (e.currentTarget instanceof HTMLInputElement) shuffle.enabled = e.currentTarget.checked;
    };
    for (const btn of document.querySelectorAll('[data-stim]')) {
      if (!(btn instanceof HTMLButtonElement)) continue;
      const k = btn.dataset.stim;
      if (!k) continue;
      if (!(k in brain.stim)) {          // stale brain.js, or a typo'd data-stim
        btn.disabled = true; btn.title = 'no such stimulus in the loaded brain.js';
        console.warn(`stimulus "${k}" not in brain.js — stale cache?`);
        continue;
      }
      btn.onclick = () => {
        brain.setStim(k, brain.stim[k] > 0 ? 0 : 1);
        for (const other of document.querySelectorAll('[data-stim]')) {
          if (!(other instanceof HTMLButtonElement)) continue;
          const on = brain.stim[other.dataset.stim || ''] > 0;
          other.classList.toggle('on', on);
          other.setAttribute('aria-pressed', String(on));
        }
        $('sugar-label').textContent = brain.sugar > 0 ? 'Sugar on' : 'Sugar off';
        document.body.classList.toggle('is-sugar-off', brain.sugar <= 0);
      };
    }

    for (const [triggerId, dialogId] of [['b_about', 'about'], ['b_inspect', 'inspect']]) {
      const dialog = $(dialogId);
      if (!(dialog instanceof HTMLDialogElement)) throw new Error(`missing dialog ${dialogId}`);
      $(triggerId).onclick = () => dialog.showModal();
      dialog.addEventListener('click', (e) => {
        const r = dialog.getBoundingClientRect();
        if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog.close();
      });
    }

    function wireDebugPanel() {
      const t = propObjs['terrarium.glb'];
      if (!t) return;
      const panel = $('scene-position');
      const axes = /** @type {const} */ (['x','y','z']);
      panel.innerHTML = axes.map(a =>
        `<label>${a.toUpperCase()} <input data-axis="${a}" type="number" step="0.05" ` +
        `value="${t.position[a].toFixed(3)}"></label>`).join('');
      panel.querySelectorAll('input').forEach(inp => {
        if (!(inp instanceof HTMLInputElement)) return;
        inp.oninput = () => {
          const axis = inp.dataset.axis;
          if (axis === 'x' || axis === 'y' || axis === 'z') t.position[axis] = parseFloat(inp.value) || 0;
        };
      });
    }

    const neuralCanvas = $('neural-map');
    const neuralMap = neuralCanvas instanceof HTMLCanvasElement
      ? await createNeuralMap(neuralCanvas, brain).catch(err => {
        console.warn('Neural view unavailable', err);
        $('neural-map-title').textContent = 'Neural view unavailable';
        return null;
      }) : null;
    function applyQuality() {
      const profile = quality.profile;
      document.body.dataset.quality = profile.name;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, profile.pixelRatio));
      const shadows = profile.shadowSize > 0;
      renderer.shadowMap.enabled = shadows;
      key.castShadow = shadows;
      key.shadow.map?.dispose(); key.shadow.map = null;
      key.shadow.mapSize.set(profile.shadowSize || 512, profile.shadowSize || 512);
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.needsUpdate = true;
      });
      neuralMap?.setQuality(profile.mapRatio);
    }
    applyQuality();
    boot.remove();
    $('artwork').removeAttribute('inert');
    $('b_about').focus({ preventScroll:true });

    // ---- loop
    const timestep = 1e-4;                          // flybody's opt.timestep
    let last = performance.now(), acc = 0, fps = 0, fpsT = last, frames = 0, sps = 0, spsN = 0, spsT = last;
    let nextFrameAt = last, mapAt = 0, hudAt = 0;
    // Browser suspension must never become a backlog of simulation work on return.
    document.addEventListener('visibilitychange', () => {
      last = nextFrameAt = performance.now();
      acc = 0; frames = 0; spsN = 0; fpsT = spsT = last;
      quality.resetSampling();
    });

    function frame() {
      requestAnimationFrame(frame);
      // Use performance.now() rather than the rAF timestamp: the two can sit on different
      // origins, which yields a negative first delta and stalls the accumulator.
      const now = performance.now();
      if (document.hidden) { last = nextFrameAt = now; acc = 0; return; }
      if (now + 1 < nextFrameAt) return;
      nextFrameAt = Math.max(nextFrameAt + 1000 / quality.profile.fps, now);
      const frameMs = now - last;
      const wall = Math.max(0, Math.min(frameMs / 1000, 0.05));
      last = now;

      if (!sim.paused) {
        acc = Math.min(acc + wall, 0.05);   // never try to 'catch up' more than 50 ms
        const budget = quality.profile.budgetMs;
        const tStart = performance.now();
        let n = 0;
        while (acc > timestep && performance.now() - tStart < budget) {
          stepSimulation();
          acc -= timestep; n++;
        }
        spsN += n;

        syncGeoms(model, data);
      }

      frames++;
      if (now - fpsT > 500) { fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now; }
      if (now - spsT > 500) {
        sps = spsN * 1000 / (now - spsT); spsN = 0; spsT = now;
        $('s_sps').textContent = Math.round(sps).toLocaleString();
        $('s_rt').textContent  = (sps * timestep).toFixed(2) + '×';
      }
      // Hidden inspector statistics do not need per-frame DOM work.
      if (now >= hudAt && $('inspect').hasAttribute('open')) {
        hudAt = now + 200;
        $('s_fps').textContent  = fps.toFixed(0);
        $('s_time').textContent = data.time.toFixed(2) + ' s';
        $('s_bms').textContent  = ((brain.ms - sim.brainStartMs) / 1000).toFixed(2) + ' s';
        $('s_pop').textContent  = brain.popRate.toFixed(1) + ' Hz';
        $('s_grn').textContent  = brain.rate.grn_sweet.toFixed(0) + ' Hz';
        $('s_mnp').textContent  = brain.rate.mn_proboscis.toFixed(1) + ' Hz';
        $('s_mni').textContent  = brain.rate.mn_ingestion.toFixed(1) + ' Hz';
        $('s_neck').textContent = ((brain.rate.mn_neck_l + brain.rate.mn_neck_r) / 2).toFixed(1) + ' Hz';
        $('s_ant').textContent  = ((brain.rate.mn_antenna_l + brain.rate.mn_antenna_r) / 2).toFixed(1) + ' Hz';
        $('s_gf').textContent   = brain.rate.dn_gf.toFixed(1) + ' Hz';
        $('s_esc').textContent  = ((brain.rate.dn_escwing_l + brain.rate.dn_escwing_r) / 2).toFixed(0) + ' Hz';
        $('s_steer').textContent = brain.rate.dn_steer_l.toFixed(0) + ' / ' + brain.rate.dn_steer_r.toFixed(0) + ' Hz';
        $('s_groom').textContent = brain.rate.dn_groom.toFixed(0) + ' Hz';
        $('s_pam').textContent  = brain.rate.pam.toFixed(1) + ' Hz';
      }
      $('s_cnt').textContent  = brain.sugarFeedSpikes.toLocaleString();

      if (!sim.paused) stepBall(wall);
      controls.update();
      renderer.render(scene, camera);
      if (now >= mapAt) {
        neuralMap?.draw();
        mapAt = now + 1000 / quality.profile.mapFps;
      }
      if (!sim.paused && quality.sample(frameMs, performance.now() - now)) applyQuality();
    }
    requestAnimationFrame(frame);

    addEventListener('resize', () => {
      camera.fov = viewFov();
      camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality.profile.pixelRatio));
      neuralMap?.draw();
    });
    const flyWindow = /** @type {Window & typeof globalThis & { fly?: unknown, __flyReady?: boolean, __flyError?: string }} */ (window);
    flyWindow.fly = { mujoco, model, data, brain, sim, scene, camera, renderer, controls, geomNodes, quality,
                   applyBrain: () => applyBrainToActuators(brain, data), driveMap, shuffle, shuffleLegs,
                   stepSimulation,
                   sync: () => syncGeoms(model, data),
                   stepBall, get ball() { return ball; }, get world() { return world; },
                   dbg: () => ({ paused: sim.paused, acc, steps: sim.steps, time: data.time,
                                 nodes: geomNodes.length,
                                 brainMs: brain.ms, sugar: brain.sugar,
                                 rates: { ...brain.rate }, pop: brain.popRate }) };
    flyWindow.__flyReady = true;
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.stack || err.message : String(err);
    boot.setAttribute('role', 'alert');
    boot.innerHTML = '<div class="err"><h2>A little trouble waking up.</h2><p>The simulation could not start. Try reloading in a browser with WebGL enabled.</p><a href="./">Try again</a></div>';
    const flyWindow = /** @type {Window & typeof globalThis & { __flyError?: string }} */ (window);
    flyWindow.__flyError = message;
  }
})();
