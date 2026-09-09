// Compact projection of measured neuron positions and sampled, actual graph edges.
// A flash marks the source neuron's spike, not a measured propagation along an axon.

import type { Brain } from './brain.js';

type MapData = { neuronCount: number, ids: number[], positions: number[], categories: number[], reference: number[], edges: number[][] };
const COLORS = ['#76caff', '#ec8cbc', '#f5d878'];
const FLASH_MS = 65;

export async function createNeuralMap(canvas: HTMLCanvasElement, brain: Brain) {
  const response = await fetch('./brain/neural-map.json');
  if (!response.ok) throw new Error(`neural map: HTTP ${response.status}`);
  const map = await response.json() as MapData;
  if (map.neuronCount !== brain.N || map.positions.length !== map.ids.length * 3 ||
      map.ids.some(i => !Number.isInteger(i) || i < 0 || i >= brain.N)) {
    throw new Error('neural map does not match the loaded brain');
  }
  const ctx = canvas.getContext('2d');
  const backdrop = document.createElement('canvas');
  const bg = backdrop.getContext('2d');
  if (!ctx || !bg) throw new Error('neural map requires a 2D canvas');
  // Cache a soft sensory halo once; drawing sprites avoids a blur filter per firing neuron.
  const sensoryGlow = document.createElement('canvas');
  sensoryGlow.width = sensoryGlow.height = 32;
  const glow = sensoryGlow.getContext('2d');
  if (glow) {
    const gradient = glow.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(145,225,255,0.65)');
    gradient.addColorStop(0.2, 'rgba(90,198,255,0.35)');
    gradient.addColorStop(0.5, 'rgba(45,160,255,0.08)');
    gradient.addColorStop(1, 'rgba(45,160,255,0)');
    glow.fillStyle = gradient;
    glow.fillRect(0, 0, 32, 32);
  }
  let width = 0, height = 0, density = 0, renderedMs = -1;
  let renderedSugar = -1;
  let maxDensity = 2;
  const xy = new Float32Array(map.ids.length * 2);
  const strength = new Float32Array(map.ids.length);

  function project(points: number[], i: number): [number, number] {
    // Small, fixed oblique view preserves the source frame and reveals depth.
    return [width / 2 + (points[i] + points[i + 2] * 0.12) * width * 0.92,
      height / 2 + (points[i + 1] - points[i + 2] * 0.18) * width * 0.92];
  }

  function resize() {
    width = canvas.clientWidth; height = canvas.clientHeight;
    density = Math.min(devicePixelRatio || 1, maxDensity);
    canvas.width = backdrop.width = Math.round(width * density);
    canvas.height = backdrop.height = Math.round(height * density);
    if (!bg || !ctx) return;
    bg.setTransform(density, 0, 0, density, 0, 0);
    ctx.setTransform(density, 0, 0, density, 0, 0);
    bg.fillStyle = '#b8b4bf';
    bg.globalAlpha = 0.27;
    for (let i = 0; i < map.reference.length; i += 3) {
      const [x, y] = project(map.reference, i);
      bg.fillRect(x, y, 0.7, 0.7);
    }
    for (let i = 0; i < map.ids.length; i++) {
      const [x, y] = project(map.positions, i * 3);
      xy[i * 2] = x; xy[i * 2 + 1] = y;
    }
    bg.lineWidth = 0.45;
    bg.strokeStyle = '#a7a2b0';
    bg.globalAlpha = 0.075;
    bg.beginPath();
    for (const [a, b] of map.edges) {
      bg.moveTo(xy[a * 2], xy[a * 2 + 1]);
      bg.lineTo(xy[b * 2], xy[b * 2 + 1]);
    }
    bg.stroke();
    renderedMs = -1;
  }

  function draw() {
    if (!ctx) return;
    if (width !== canvas.clientWidth || height !== canvas.clientHeight ||
        density !== Math.min(devicePixelRatio || 1, maxDensity)) resize();
    if (!width || !height || (renderedMs === brain.ms && renderedSugar === brain.sugar)) return;
    renderedMs = brain.ms;
    renderedSugar = brain.sugar;
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = 1;
    ctx.drawImage(backdrop, 0, 0, width, height);
    for (let i = 0; i < map.ids.length; i++) {
      const age = brain.ms - brain.lastSpikeMs[map.ids[i]];
      strength[i] = Math.max(0, 1 - age / FLASH_MS) ** 3;
    }
    // Quantize brightness to batch strokes; no per-frame geometry allocations or extra WebGL context.
    for (let color = 0; color < COLORS.length; color++) {
      const boost = color === 0 && brain.sugar > 0;
      ctx.strokeStyle = ctx.fillStyle = COLORS[color];
      for (let band = 1; band <= 3; band++) {
        ctx.globalAlpha = band * 0.10;
        ctx.beginPath();
        for (const [a, b] of map.edges) {
          if (map.categories[a] !== color || Math.ceil(strength[a] * 3) !== band) continue;
          ctx.moveTo(xy[a * 2], xy[a * 2 + 1]);
          ctx.lineTo(xy[b * 2], xy[b * 2 + 1]);
        }
        if (boost) {
          ctx.lineWidth = 2.5;
          ctx.globalAlpha = band * 0.025;
          ctx.stroke();
        }
        ctx.lineWidth = boost ? 1 : 0.65;
        ctx.globalAlpha = band * (boost ? 0.13 : 0.10);
        ctx.stroke();
      }
      for (let i = 0; i < map.ids.length; i++) {
        if (map.categories[i] !== color || strength[i] < 0.04) continue;
        const x = xy[i * 2], y = xy[i * 2 + 1];
        if (boost) {
          ctx.globalAlpha = strength[i] * 0.4;
          ctx.drawImage(sensoryGlow, x - 5, y - 5, 10, 10);
          ctx.fillStyle = '#97daff';
        }
        ctx.globalAlpha = strength[i] * 0.85;
        ctx.fillRect(x - 0.65, y - 0.65, 1.3, 1.3);
        if (strength[i] > 0.65) {
          ctx.globalAlpha = strength[i] * 0.12;
          ctx.fillRect(x - 2, y - 2, 4, 4);
        }
      }
    }
    ctx.globalAlpha = 1;
  }
  draw();
  function setQuality(ratio: number) { maxDensity = ratio; draw(); }
  return { draw, setQuality };
}
