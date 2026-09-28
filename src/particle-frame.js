// Layout of the buffer the particle worker fills, shared by the worker and the page.

/** @typedef {{ x0: number, x1: number, y0: number, y1: number }} Bounds */
/**
 * One frame of particles. `bucket` is the speed colour index, 255 for a particle
 * that just respawned and must not be drawn. `k` is the step length factor:
 * the particle moved by (u, v) · k during that frame.
 * @typedef {{ x: Float32Array, y: Float32Array, u: Float32Array, v: Float32Array, bucket: Uint8Array, count: number, k: number }} Frame
 */

export const SPEED_BUCKETS = [0.6, 0.85, 0.95, 1.05, 1.2, 1.45, Infinity];
export const SPEED_COLORS = ['#f97316', '#fdba74', '#f1e4d4', '#e2e8f0', '#bae6fd', '#7dd3fc', '#0ea5e9'];

/** @param {number} count */
export const byteSize = count => count * 17;

/**
 * Views over the shared buffer: four Float32 arrays then one Uint8 array.
 * @param {ArrayBuffer} buffer
 * @param {number} count
 */
export function layout(buffer, count) {
  return {
    x: new Float32Array(buffer, 0, count),
    y: new Float32Array(buffer, count * 4, count),
    u: new Float32Array(buffer, count * 8, count),
    v: new Float32Array(buffer, count * 12, count),
    bucket: new Uint8Array(buffer, count * 16, count),
  };
}
