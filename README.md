# Wing lift

Interactive wind tunnel in the browser: pick an airfoil, tilt it, and watch the air flow, the pressure field and the aerodynamic forces.

**Live:** https://fallais.github.io/wing-lift/

- Airfoil presets (classic, symmetric, flat plate, high camber) or custom thickness/camber
- 3D view (drag or one finger to orbit, wheel or pinch to zoom, double-click to reset, Shift + drag to tilt the wing) or the classic 2D section view (drag vertically or scroll to tilt)
- Angle of attack, airspeed, altitude, wing area
- Air shown as particles, streamlines and a pressure map
- Lift, drag and resultant force vectors with values in newtons, plus the CL(α) curve with stall
- Shareable links: the address bar always holds the current setup, and the Share button copies it
- French / English, with a built-in help glossary

## How it works

The flow is the exact potential flow around a [Joukowski airfoil](https://en.wikipedia.org/wiki/Joukowsky_transform) with the Kutta condition. Stall and drag use a simple empirical model on top of that. It is a teaching tool, not a design tool.

The wing is straight and every section sees the same 2D flow.

Plain JavaScript modules with JSDoc types, bundled with [Vite](https://vite.dev/):

- `src/aero.js`: the physics (flow field, lift and drag, atmosphere), covered by `src/aero.test.js`
- `src/particles.worker.js`: moves the particles in a Web Worker
- `src/pressure.js`: the pressure field as a GPU shader
- `src/scene2d.js` / `src/scene3d.js`: the two views, same interface (`src/view.js`); three.js is only loaded for the 3D view
- `src/main.js`: controls, readouts and the Cz(α) chart

## Run locally

```sh
npm install
npm run dev      # dev server with live reload
npm run check    # lint, formatting, types and tests
npm run format   # apply the formatting
npm run build    # production build in dist/
```

Every push and pull request runs the checks; pushing to `main` also deploys to GitHub Pages (`.github/workflows/deploy.yml`).
