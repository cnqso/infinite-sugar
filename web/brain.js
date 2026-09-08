// @ts-check
// brain.js — whole-brain leaky integrate-and-fire over the FlyWire FAFB v783 connectome.
// 139,255 neurons / 2,700,513 edges, 1 kHz. Kernel traced from desktop-fly's Sim.swift
// (MIT, Denis Shiryaev); parameters matched to tools/reflex_test.py, the reference implementation.
// Wiring is measured; gains are hand-tuned — see docs/04-roadmap.md.
//
// Perf notes that are NOT optional (docs/04-roadmap.md Phase 4):
//   - the dense pass is fused: decay + baseline + threshold in ONE loop over N
//   - noise and the delayed-inhibition queue are SPARSE (touched-index lists, never a full scan)
// The naive version costs ~1050 us/step; this one costs ~100-240 us/step.

const DECAY = Math.fround(Math.exp(-1 / 20));   // 20 ms membrane tau at 1 ms steps
const THRESH = 1.0;
const REFRACT = 2;                              // ms
const INH_DELAY = 4;                            // ms — inhibition arrives late, excitation doesn't
const INH_SLOTS = INH_DELAY + 1;

const WSCALE = 0.0050;      // synapse-count -> membrane units
const BASE_MAX = 0.06;      // per-neuron tonic drive ~ U(0, BASE_MAX)
const NOISE_PER_STEP = 300; // sparse random kicks per ms
const NOISE_KICK = 0.42;

/** @typedef {{ N: number, E: number, roles: Record<string, number[]> }} BrainMeta */
/** @typedef {{ idx: Int32Array, amt: number }} ActiveStimulus */

/**
 * @template {ArrayBufferView} T
 * @param {string} url
 * @param {{ new(buffer: ArrayBuffer): T }} Ctor
 * @returns {Promise<T>}
 */
async function loadBlob(url, Ctor) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (!res.body) throw new Error(`${url}: response has no body`);
  const ds = res.body.pipeThrough(new DecompressionStream('gzip'));
  return new Ctor(await new Response(ds).arrayBuffer());
}

export class Brain {
  /**
   * @param {BrainMeta} meta
   * @param {Uint32Array} indptr
   * @param {Uint32Array} colidx
   * @param {Float32Array} w
   */
  constructor(meta, indptr, colidx, w) {
    this.meta = meta;
    this.N = meta.N;
    this.indptr = indptr; this.colidx = colidx; this.w = w;
    const N = this.N;

    this.v = new Float32Array(N);
    this.refr = new Uint8Array(N);
    this.baseline = new Float32Array(N);
    let s = 22222;                               // deterministic: same brain every load
    const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
    for (let i = 0; i < N; i++) this.baseline[i] = rnd() * BASE_MAX;
    this._rng = s;

    /** @type {Float32Array[]} */
    this.inhVal = [];
    /** @type {Int32Array[]} */
    this.inhIdx = [];
    this.inhCnt = new Int32Array(INH_SLOTS);
    for (let k = 0; k < INH_SLOTS; k++) {
      this.inhVal.push(new Float32Array(N));
      this.inhIdx.push(new Int32Array(N));
    }
    this.spiked = new Int32Array(N);
    // Read-only visualization telemetry; simulation time keeps flashes still when paused.
    this.lastSpikeMs = new Float64Array(N).fill(-Infinity);
    this.slot = 0; this.ms = 0; this.totalSpikes = 0;

    /** @type {Record<string, Int32Array>} */
    this.groups = {};
    for (const [k, arr] of Object.entries(meta.roles)) this.groups[k] = Int32Array.from(arr);
    this.roleNames = Object.keys(this.groups);
    this.roleOf = new Int8Array(N).fill(-1);
    this.roleNames.forEach((k, ri) => { for (const i of this.groups[k]) this.roleOf[i] = ri; });

    /** @type {Record<string, number>} */
    this.rate = {};
    for (const k of this.roleNames) this.rate[k] = 0;
    this._cnt = new Int32Array(this.roleNames.length);
    this.popRate = 0;
    this.rateAlpha = 1 / 25;   // ~25 ms; 1/80 was so smooth that driven pools looked frozen

    // Sensory switches. Each maps to real FlyWire sensory populations; levels are 0..1.
    // Response of every motor pool to each of these was measured before wiring:
    // see tools/response_matrix.py and docs/05-results-phase1-3.md.
    /** @type {Record<string, string[]>} */
    this.STIM = {
      sweet:   ['grn_sweet', 'grn_sweet_leg'],
      bitter:  ['grn_bitter'],
      odour:   ['orn'],
      touch:   ['mechano'],
      heat:    ['thermo'],
      damp:    ['hygro'],
      light:   ['visual'],
      looming: ['lc4', 'lplc2'],   // LC4 + LPLC2: the fly's actual looming detectors
    };
    /** @type {Record<string, number>} */
    this.stim = {};
    for (const k of Object.keys(this.STIM)) this.stim[k] = 0;
    this.stimDrive = 0.20;       // membrane units at level 1
    /** @type {ActiveStimulus[]} */
    this._active = [];           // rebuilt by setStim()
    this.sugar = 0;
    this.feedSpikes = 0;         // running total: proboscis + ingestion MN spikes
    this.sugarFeedSpikes = 0;    // same populations, counted only while sugar is enabled
    /** @type {Record<string, number> | null} */
    this.rest = null;            // resting rate per role, filled by calibrate()
  }

  /**
   * @param {string} [base]
   * @param {(message: string) => void} [say]
   */
  static async load(base = './brain', say = () => {}) {
    say('fetching connectome');
    const meta = /** @type {BrainMeta} */ (await (await fetch(`${base}/meta.json`)).json());
    say(`connectome: ${meta.N.toLocaleString()} neurons, ${meta.E.toLocaleString()} edges`);
    const [indptr, colidx, w2] = await Promise.all([
      loadBlob(`${base}/indptr.bin.gz`, Uint32Array),
      loadBlob(`${base}/colidx.bin.gz`, Uint32Array),
      loadBlob(`${base}/w2.bin.gz`, Int16Array),
    ]);
    say('unpacking weights');
    const w = new Float32Array(w2.length);
    const k = WSCALE / 2;                        // w2 = syn * sign * 2
    for (let i = 0; i < w2.length; i++) w[i] = w2[i] * k;
    return new Brain(meta, indptr, colidx, w);
  }

  /** @param {string} name @param {number} level */
  setStim(name, level) {
    if (!(name in this.stim)) return;
    this.stim[name] = level;
    this._active = [];
    for (const k of Object.keys(this.stim)) {
      const lv = this.stim[k];                       // each switch's OWN level, not the argument
      if (lv <= 0) continue;
      for (const r of this.STIM[k]) {
        const g = this.groups[r];
        if (g) this._active.push({ idx: g, amt: lv * this.stimDrive });
      }
    }
    this.sugar = this.stim.sweet;
  }

  // Resting rates depend on the kernel, not just the wiring — the NumPy reference and this
  // one differ. Measure them here at load rather than hard-coding numbers from elsewhere.
  // Deliberately a one-shot calibration, NOT a running adaptation: a slow adaptive baseline
  // would make a sustained stimulus fade, i.e. habituation, which is ruled out by design.
  /** @param {number} [ms] */
  calibrate(ms = 2500) {
    const saved = { ...this.stim };
    for (const k of Object.keys(this.stim)) this.setStim(k, 0);
    this.step(ms);
    this.rest = {};
    for (const k of this.roleNames) this.rest[k] = Math.max(0.5, this.rate[k]);
    for (const [k, v] of Object.entries(saved)) this.setStim(k, v);
    return this.rest;
  }

  // Same one-shot calibration, yielded in small batches so mobile loading UI stays responsive.
  /** @param {number} [ms] */
  async calibrateResponsive(ms = 2500) {
    const saved = { ...this.stim };
    for (const k of Object.keys(this.stim)) this.setStim(k, 0);
    for (let elapsed = 0; elapsed < ms; elapsed += 25) {
      this.step(Math.min(25, ms - elapsed));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    this.calibrate(0); // Capture the final resting rates without advancing or adapting the brain.
    for (const [k, v] of Object.entries(saved)) this.setStim(k, v);
    return this.rest;
  }

  _rand() { let s = this._rng; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this._rng = s; return s >>> 0; }

  /** @param {number} n */
  step(n) {
    const { N, v, refr, baseline, indptr, colidx, w, spiked, inhVal, inhIdx, inhCnt } = this;
    const active = this._active;
    const rFeedA = this.roleNames.indexOf('mn_proboscis');
    const rFeedB = this.roleNames.indexOf('mn_ingestion');

    for (let it = 0; it < n; it++) {
      const slot = this.slot;

      const q = inhVal[slot], qi = inhIdx[slot], qn = inhCnt[slot];
      for (let k = 0; k < qn; k++) { const j = qi[k]; const nv = v[j] + q[j]; v[j] = nv < -2 ? -2 : nv; q[j] = 0; }
      inhCnt[slot] = 0;

      for (let k = 0; k < NOISE_PER_STEP; k++) v[this._rand() % N] += NOISE_KICK;

      for (let a = 0; a < active.length; a++) {
        const idx = active[a].idx, amt = active[a].amt;
        for (let k = 0; k < idx.length; k++) v[idx[k]] += amt;
      }

      let ns = 0;
      for (let i = 0; i < N; i++) {
        const r = refr[i];
        if (r !== 0) { refr[i] = r - 1; v[i] *= DECAY; continue; }
        const vi = v[i] * DECAY + baseline[i];
        if (vi >= THRESH) { v[i] = 0; refr[i] = REFRACT; spiked[ns++] = i; }
        else v[i] = vi;
      }

      const is = (slot + INH_DELAY) % INH_SLOTS, iq = inhVal[is], iqi = inhIdx[is];
      let ic = inhCnt[is];
      for (let s = 0; s < ns; s++) {
        const i = spiked[s], a = indptr[i], b = indptr[i + 1];
        for (let k = a; k < b; k++) {
          const j = colidx[k], x = w[k];
          if (x >= 0) { const nv = v[j] + x; v[j] = nv < -2 ? -2 : nv; }
          else { if (iq[j] === 0) iqi[ic++] = j; iq[j] += x; }
        }
      }
      inhCnt[is] = ic;

      this._cnt.fill(0);
      for (let s = 0; s < ns; s++) {
        const i = spiked[s];
        this.lastSpikeMs[i] = this.ms;
        const r = this.roleOf[i];
        if (r >= 0) this._cnt[r]++;
      }
      for (let r = 0; r < this.roleNames.length; r++) {
        const k = this.roleNames[r], n0 = this.groups[k].length;
        this.rate[k] += (this._cnt[r] * 1000 / n0 - this.rate[k]) * this.rateAlpha;
      }
      const feeding = this._cnt[rFeedA] + this._cnt[rFeedB];
      this.feedSpikes += feeding;
      if (this.sugar > 0) this.sugarFeedSpikes += feeding;
      this.popRate += (ns * 1000 / N - this.popRate) * this.rateAlpha;

      this.totalSpikes += ns;
      this.ms++;
      this.slot = (slot + 1) % INH_SLOTS;
    }
  }
}
