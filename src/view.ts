// Interface shared by the 2D and 3D views.
import type { Airfoil, Coefficients, Flow } from './aero';

/** Display toggles of the legend. `vortices` only applies to the 3D view. */
export interface Show {
  particles: boolean;
  streamlines: boolean;
  pressure: boolean;
  forces: boolean;
  vortices: boolean;
}

/** In newtons. */
export interface Forces {
  lift: number;
  drag: number;
  res: number;
  weight: number;
}

export interface ForceTexts {
  lift: string;
  drag: string;
  res: string;
  weight: string;
}

export interface ViewInput {
  /** Upward drag in pixels since the drag started; `start` once at the beginning. */
  onTilt: (dy: number, start?: boolean) => void;
  /** One wheel notch, +1 nose up. */
  onNudge?: (sign: number) => void;
}

export interface View {
  /** `aero` is for the whole wing of aspect ratio `ar`; the 2D view shows the section and ignores `ar`. */
  setFlow(af: Airfoil, flow: Flow, aero: Coefficients, show: Show, ar: number): void;
  setShow(show: Show): void;
  updateAngle(alphaDeg: number, text: string): void;
  /** Arrows in lift coefficient units: newtons × perNewton. */
  updateForces(f: Forces, perNewton: number, texts: ForceTexts): void;
  /** Hides the view and ignores its input when off. */
  setActive(on: boolean): void;
  resize(): void;
  frame(dt: number, time: number, speed: number): void;
}
