// @ts-check
// Rendering/scheduling policy only. Physics timestep, wiring and neural gains never change.
export const QUALITY = [
  { name:'low', pixelRatio:0.85, shadowSize:0, fps:30, mapFps:12, mapRatio:1, budgetMs:5 },
  { name:'balanced', pixelRatio:1.25, shadowSize:1024, fps:30, mapFps:20, mapRatio:1.25, budgetMs:8 },
  { name:'high', pixelRatio:2, shadowSize:2048, fps:60, mapFps:30, mapRatio:2, budgetMs:12 },
];

export class AdaptiveQuality {
  /** @param {{compact?:boolean, cores?:number, memory?:number}} [hints] */
  constructor({ compact = false, cores = 8, memory = 8 } = {}) {
    this.ceiling = compact || cores <= 4 || memory <= 4 ? 1 : 2;
    this.level = cores <= 2 || memory <= 2 ? 0 : this.ceiling;
    this.elapsed = 0; this.work = 0; this.frames = 0;
    this.goodMs = 0;
    this.cooldownMs = 5000; // Ignore startup shader compilation and asset upload.
  }
  get profile() { return QUALITY[this.level]; }

  resetSampling() {
    this.elapsed = this.work = this.frames = this.goodMs = 0;
    this.cooldownMs = 5000;
  }

  /** @param {number} frameMs @param {number} workMs @returns {boolean} */
  sample(frameMs, workMs) {
    if (!Number.isFinite(frameMs) || !Number.isFinite(workMs) || frameMs <= 0 || frameMs > 250) {
      this.resetSampling();
      return false;
    }
    if (this.cooldownMs > 0) { this.cooldownMs -= frameMs; return false; }
    this.elapsed += frameMs; this.work += workMs; this.frames++;
    if (this.elapsed < 3000) return false;
    const averageFrame = this.elapsed / this.frames, averageWork = this.work / this.frames;
    const target = 1000 / this.profile.fps;
    let next = this.level;
    if (averageFrame > target * 1.4 || averageWork > target * 0.85) {
      next = Math.max(0, this.level - 1);
      this.goodMs = 0;
    } else if (averageFrame < target * 1.15 && averageWork < target * 0.35) {
      this.goodMs += this.elapsed;
      if (this.goodMs >= 15000) next = Math.min(this.ceiling, this.level + 1);
    } else this.goodMs = 0;
    this.elapsed = this.work = this.frames = 0;
    if (next === this.level) return false;
    this.level = next;
    this.resetSampling();
    return true;
  }
}
