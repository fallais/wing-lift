// Main-thread side of the airfoil solver worker.

/** @typedef {import('./aero.js').Airfoil} Airfoil */
/** @typedef {{ thickness: number, camber: number, flap: number }} Shape */

/**
 * One solve at a time: while the worker is busy, only the latest request is kept,
 * so dragging a slider never piles up work.
 * @param {(af: Airfoil) => void} onSolved
 */
export function createSolver(onSolved) {
  const worker = new Worker(new URL('./solver.worker.js', import.meta.url), { type: 'module' });
  let busy = false;
  /** @type {Shape | null} */
  let queued = null;
  let id = 0;

  /** @param {Shape} shape */
  const send = shape => {
    busy = true;
    worker.postMessage({ id: ++id, ...shape });
  };

  worker.onmessage = ({ data }) => {
    busy = false;
    if (queued) {
      send(queued);
      queued = null;
    }
    onSolved(data.af);
  };

  return {
    /** @param {Shape} shape */
    solve(shape) {
      if (busy) queued = shape;
      else send(shape);
    },
  };
}
