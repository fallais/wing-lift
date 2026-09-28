# Wing lift

Interactive wind tunnel in the browser: pick an airfoil, tilt it, and watch the air flow, the pressure field and the aerodynamic forces.

**Live:** https://fallais.github.io/wing-lift/

- Airfoil presets (classic, symmetric, flat plate, high camber) or custom thickness/camber
- 3D view (drag to orbit, wheel to zoom, double-click to reset, Shift + drag to tilt the wing) or the classic 2D section view (drag vertically or scroll to tilt)
- Angle of attack, airspeed, altitude, wing area
- Air shown as particles, streamlines and a pressure map
- Lift, drag and resultant force vectors with values in newtons, plus the CL(α) curve with stall
- French / English, with a built-in help glossary

## How it works

The flow is the exact potential flow around a [Joukowski airfoil](https://en.wikipedia.org/wiki/Joukowsky_transform) with the Kutta condition. Stall and drag use a simple empirical model on top of that. It is a teaching tool, not a design tool.

The wing is straight and every section sees the same 2D flow.

Plain JavaScript modules bundled with [Vite](https://vite.dev/). The 2D view uses Canvas and SVG; the 3D view uses [three.js](https://threejs.org/), and the page falls back to 2D without WebGL.

## Run locally

```sh
npm install
npm run dev      # dev server with live reload
npm run build    # production build in dist/
```

Pushing to `main` builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`).
