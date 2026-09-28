// Main-thread side of the particle worker, shared by the 2D and 3D views.
import { byteSize, layout } from './particle-frame.js';

export { SPEED_COLORS } from './particle-frame.js';

/** @typedef {import('./aero.js').Airfoil} Airfoil */
/** @typedef {import('./aero.js').Flow} Flow */
/** @typedef {import('./aero.js').Wake} Wake */
/** @typedef {import('./particle-frame.js').Bounds} Bounds */
/** @typedef {import('./particle-frame.js').Frame} Frame */

export function createParticles() {
  const worker = new Worker(new URL('./particles.worker.js', import.meta.url), { type: 'module' });
  let count = 0;
  /** @type {ArrayBuffer | null} buffer we own, null while the worker has it */
  let buffer = null;
  /** @type {Frame | null} */
  let fresh = null;
  /** @type {import('./aero.js').FlowField | null} */
  let sentField = null;

  worker.onmessage = ({ data }) => {
    // Results for an old particle count are dropped, and their buffer with them.
    if (data.count !== count) return;
    buffer = data.buffer;
    if (data.ready) fresh = { ...layout(data.buffer, count), count, k: data.k };
  };

  return {
    /**
     * @param {Bounds} bounds world box the particles live in
     * @param {number} nextCount
     * @param {number} [half] half span of the 3D wing; 0 for the 2D section
     */
    setBounds(bounds, nextCount, half = 0) {
      count = nextCount;
      buffer = new ArrayBuffer(byteSize(count));
      fresh = null;
      worker.postMessage({ type: 'bounds', bounds, count, half });
    },
    /**
     * @param {Airfoil} af
     * @param {Flow} flow
     * @param {Wake | null} wake
     * @param {import('./aero.js').TipVortices | null} [vortices] tip vortices of the finite wing, none in the section view
     */
    setFlow(af, flow, wake, vortices = null) {
      // The velocity grids only change with the shape; copying them on every angle change would be wasteful.
      if (af.field !== sentField) {
        worker.postMessage({ type: 'field', field: af.field });
        sentField = af.field;
      }
      worker.postMessage({ type: 'flow', flow, wake, vortices });
    },
    /**
     * Asks for the next frame; skipped while the previous one is still being computed.
     * Hands the buffer to the worker, so call it after drawing the frame from take().
     * @param {number} dt
     * @param {number} time
     * @param {number} speed airspeed in m/s
     */
    step(dt, time, speed) {
      if (!buffer) return;
      fresh = null;
      worker.postMessage({ type: 'step', buffer, count, dt, time, speed }, [buffer]);
      buffer = null;
    },
    /** The latest computed frame, once; null if none arrived since the last call. */
    take() {
      const frame = fresh;
      fresh = null;
      return frame;
    },
  };
}
