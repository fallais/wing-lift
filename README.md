# Wing lift

Interactive wind tunnel in the browser: pick an airfoil, tilt it, and watch the air flow, the pressure field and the aerodynamic forces.

**Live:** https://fallais.github.io/wing-lift/

- Airfoil presets (classic, symmetric, flat plate, high camber) or custom thickness/camber
- Angle of attack (slider, or drag vertically on the tunnel), airspeed, altitude, wing area
- Air shown as particles, streamlines and a pressure map
- Lift, drag and resultant force vectors with values in newtons, plus the CL(α) curve with stall
- French / English, with a built-in help glossary

## How it works

The flow is the exact potential flow around a [Joukowski airfoil](https://en.wikipedia.org/wiki/Joukowsky_transform) with the Kutta condition. Stall and drag use a simple empirical model on top of that. It is a teaching tool, not a design tool.

No framework and no build step: plain HTML, CSS and JavaScript (Canvas for the flow, SVG for the wing and vectors).

## Run locally

Open `index.html` in a browser.
