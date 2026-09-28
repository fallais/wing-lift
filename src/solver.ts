// Main-thread side of the airfoil solver worker.
import type { Airfoil } from './aero';

export interface Shape {
  thickness: number;
  camber: number;
  flap: number;
}

export type SolveRequest = Shape & { id: number };
export interface SolveResult {
  id: number;
  af: Airfoil;
}

/**
 * One solve at a time: while the worker is busy, only the latest request is kept,
 * so dragging a slider never piles up work.
 */
export function createSolver(onSolved: (af: Airfoil) => void) {
  const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
  let busy = false;
  let queued: Shape | null = null;
  let id = 0;

  const send = (shape: Shape) => {
    busy = true;
    const request: SolveRequest = { id: ++id, ...shape };
    worker.postMessage(request);
  };

  worker.onmessage = ({ data }: MessageEvent<SolveResult>) => {
    busy = false;
    if (queued) {
      send(queued);
      queued = null;
    }
    onSolved(data.af);
  };

  return {
    solve(shape: Shape) {
      if (busy) queued = shape;
      else send(shape);
    },
  };
}
