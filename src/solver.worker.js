// Builds airfoils (shape, panel solution, velocity grids) off the main thread.
import { makeAirfoil } from './aero.js';

self.onmessage = ({ data }) => {
  const af = makeAirfoil(data.thickness, data.camber, data.flap);
  const { field } = af;
  self.postMessage(
    { id: data.id, af },
    {
      transfer: [
        field.outline.buffer,
        field.fine.vel.buffer,
        field.fine.tex.buffer,
        field.coarse.vel.buffer,
        field.coarse.tex.buffer,
        af.surfaceSpeed.buffer,
      ],
    },
  );
};
