// Interface shared by the 2D and 3D views (types only).

/** @typedef {import('./aero.js').Airfoil} Airfoil */
/** @typedef {import('./aero.js').Flow} Flow */
/** @typedef {import('./aero.js').Coefficients} Coefficients */

/** @typedef {{ particles: boolean, streamlines: boolean, pressure: boolean, forces: boolean, vortices: boolean }} Show vortices: 3D only */
/** @typedef {{ lift: number, drag: number, res: number, weight: number }} Forces in newtons */
/** @typedef {{ lift: string, drag: string, res: string, weight: string }} ForceTexts */

/**
 * @typedef {object} ViewInput
 * @property {(dy: number, start?: boolean) => void} onTilt upward drag in pixels since the drag started; `start` once at the beginning
 * @property {(sign: number) => void} [onNudge] one wheel notch, +1 nose up
 */

/**
 * @typedef {object} View
 * @property {(af: Airfoil, flow: Flow, aero: Coefficients, show: Show, ar: number) => void} setFlow `aero` is for the whole wing of aspect ratio `ar`; the 2D view shows the section and ignores `ar`
 * @property {(show: Show) => void} setShow
 * @property {(alphaDeg: number, text: string) => void} updateAngle
 * @property {(f: Forces, perNewton: number, texts: ForceTexts) => void} updateForces arrows in lift coefficient units: newtons × perNewton
 * @property {(on: boolean) => void} setActive hides the view and ignores its input when off
 * @property {() => void} resize
 * @property {(dt: number, time: number, speed: number) => void} frame
 */

export {};
