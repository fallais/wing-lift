// Main-thread side of the particle worker, shared by the 2D and 3D views.
import type { Airfoil, Flow, FlowField, TipVortices, Wake } from './aero';
import {
  byteSize,
  layout,
  type Bounds,
  type Frame,
  type FromParticleWorker,
  type ToParticleWorker,
} from './particle-frame';

export { SPEED_COLORS } from './particle-frame';

export function createParticles() {
  const worker = new Worker(new URL('./particles.worker.ts', import.meta.url), { type: 'module' });
  const post = (message: ToParticleWorker, transfer: Transferable[] = []) => worker.postMessage(message, transfer);
  let count = 0;
  /** The buffer we own; null while the worker has it. */
  let buffer: ArrayBuffer | null = null;
  let fresh: Frame | null = null;
  let sentField: FlowField | null = null;

  worker.onmessage = ({ data }: MessageEvent<FromParticleWorker>) => {
    // Results for an old particle count are dropped, and their buffer with them.
    if (data.count !== count) return;
    buffer = data.buffer;
    if (data.ready) fresh = { ...layout(data.buffer, count), count, k: data.k };
  };

  return {
    /** `bounds`: world box the particles live in. `half`: half span of the 3D wing, 0 for the 2D section. */
    setBounds(bounds: Bounds, nextCount: number, half = 0) {
      count = nextCount;
      buffer = new ArrayBuffer(byteSize(count));
      fresh = null;
      post({ type: 'bounds', bounds, count, half });
    },
    /** `vortices`: tip vortices of the finite wing, none in the section view. */
    setFlow(af: Airfoil, flow: Flow, wake: Wake | null, vortices: TipVortices | null = null) {
      // The velocity grids only change with the shape; copying them on every angle change would be wasteful.
      if (af.field !== sentField) {
        post({ type: 'field', field: af.field });
        sentField = af.field;
      }
      post({ type: 'flow', flow, wake, vortices });
    },
    /**
     * Asks for the next frame; skipped while the previous one is still being computed.
     * Hands the buffer to the worker, so call it after drawing the frame from take().
     */
    step(dt: number, time: number, speed: number) {
      if (!buffer) return;
      fresh = null;
      post({ type: 'step', buffer, count, dt, time, speed }, [buffer]);
      buffer = null;
    },
    /** The latest computed frame, once; null if none arrived since the last call. */
    take(): Frame | null {
      const frame = fresh;
      fresh = null;
      return frame;
    },
  };
}
