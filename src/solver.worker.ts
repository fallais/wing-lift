// Builds airfoils (shape, panel solution, velocity grids) off the main thread.
import { makeAirfoil } from './aero';
import type { SolveRequest, SolveResult } from './solver';

// The DOM typings describe `self` as a window; the worker scope has the same messaging API as a Worker.
const scope = self as unknown as Worker;

scope.onmessage = ({ data }: MessageEvent<SolveRequest>) => {
  const af = makeAirfoil(data.thickness, data.camber, data.flap);
  const { field } = af;
  const result: SolveResult = { id: data.id, af };
  scope.postMessage(result, {
    transfer: [
      field.outline.buffer,
      field.fine.vel.buffer,
      field.fine.tex.buffer,
      field.coarse.vel.buffer,
      field.coarse.tex.buffer,
      af.surfaceSpeed.buffer,
    ],
  });
};
