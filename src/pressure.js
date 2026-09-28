// Pressure coefficient Cp = 1 - |V|² computed per pixel on the GPU.
// The GLSL mirrors Aero.velocityWorld; the speed is rotation invariant, so the
// velocity stays in the wing frame.

/** @typedef {import('./aero.js').Airfoil} Airfoil */
/** @typedef {import('./aero.js').Flow} Flow */

export const PRESSURE_GLSL = /* glsl */ `
  uniform vec2 uRot;      // (cos α, sin α)
  uniform vec3 uCircle;   // (mx, my, R²)
  uniform float uGamma;   // circulation from the Kutta condition

  // Returns Cp, or 1e9 inside the wing.
  float pressureCoefficient(vec2 p) {
    float ca = uRot.x, sa = uRot.y;
    vec2 z = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);

    // Inverse Joukowski: keep the root outside the circle.
    vec2 a = vec2(z.x * z.x - z.y * z.y - 4.0, 2.0 * z.x * z.y);
    float r = length(a);
    vec2 s = vec2(sqrt(max(0.0, (r + a.x) / 2.0)), sqrt(max(0.0, (r - a.x) / 2.0)) * (a.y < 0.0 ? -1.0 : 1.0));
    vec2 zeta = (z + s) / 2.0;
    vec2 d = zeta - uCircle.xy;
    vec2 other = (z - s) / 2.0;
    vec2 e = other - uCircle.xy;
    if (dot(e, e) > dot(d, d)) { zeta = other; d = e; }
    float dd = dot(d, d);
    if (dd < uCircle.z) return 1e9;

    // dW/dζ = e^{-iα} - R² e^{iα} / (ζ-μ)² + iΓ / (ζ-μ)
    vec2 d2 = vec2(d.x * d.x - d.y * d.y, 2.0 * d.x * d.y);
    float d4 = dot(d2, d2);
    vec2 t = uCircle.z * vec2(ca * d2.x + sa * d2.y, sa * d2.x - ca * d2.y) / d4;
    vec2 w = vec2(ca - t.x + uGamma * d.y / dd, -sa - t.y + uGamma * d.x / dd);

    // |dW/dz| = |dW/dζ| / |dz/dζ|, with dz/dζ = 1 - 1/ζ²
    vec2 p2 = vec2(zeta.x * zeta.x - zeta.y * zeta.y, 2.0 * zeta.x * zeta.y);
    float p4 = dot(p2, p2);
    vec2 j = vec2(1.0 - p2.x / p4, p2.y / p4);
    return 1.0 - dot(w, w) / dot(j, j);
  }

  // Same palette as the 2D map: blue for suction, red for overpressure. Premultiplied alpha.
  vec4 pressureColor(float cp, float opacity) {
    if (cp > 1e8) return vec4(0.0);
    vec3 rgb = cp < 0.0 ? vec3(0.231, 0.510, 0.965) : vec3(0.937, 0.267, 0.267);
    float a = opacity * min(1.0, cp < 0.0 ? -cp / 1.5 : cp);
    return vec4(rgb * a, a);
  }
`;

/**
 * Uniform values for PRESSURE_GLSL.
 * @param {Airfoil} af
 * @param {Flow} flow
 */
export function pressureUniforms(af, flow) {
  return { rot: [flow.ca, flow.sa], circle: [af.mx, af.my, af.R2], gamma: flow.G };
}

const VERTEX = `
  attribute vec2 aPos;
  void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAGMENT = `
  precision highp float;
  uniform vec2 uOrigin;   // world position of the bottom-left pixel
  uniform float uScale;   // world units per device pixel
  ${PRESSURE_GLSL}
  void main() {
    vec2 p = uOrigin + gl_FragCoord.xy * uScale;
    gl_FragColor = pressureColor(pressureCoefficient(p), 0.78);
  }
`;

/**
 * Full-canvas pressure map with raw WebGL, so the 2D view does not need three.js.
 * Returns null when WebGL is unavailable.
 * @param {HTMLCanvasElement} canvas
 */
export function createPressureLayer(canvas) {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false });
  if (!gl) return null;

  /** @param {number} type @param {string} source */
  const compile = (type, source) => {
    const shader = /** @type {WebGLShader} */ (gl.createShader(type));
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader');
    return shader;
  };
  const program = /** @type {WebGLProgram} */ (gl.createProgram());
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'link');
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  /** @param {string} name */
  const loc = name => gl.getUniformLocation(program, name);
  const u = {
    origin: loc('uOrigin'),
    scale: loc('uScale'),
    rot: loc('uRot'),
    circle: loc('uCircle'),
    gamma: loc('uGamma'),
  };

  return {
    /**
     * @param {Airfoil} af
     * @param {Flow} flow
     * @param {{ x0: number, y0: number, s: number }} view world origin (bottom-left) and CSS pixels per world unit
     * @param {number} dpr canvas pixels per CSS pixel
     */
    draw(af, flow, view, dpr) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const p = pressureUniforms(af, flow);
      gl.uniform2f(u.origin, view.x0, view.y0);
      gl.uniform1f(u.scale, 1 / (view.s * dpr));
      gl.uniform2f(u.rot, p.rot[0], p.rot[1]);
      gl.uniform3f(u.circle, p.circle[0], p.circle[1], p.circle[2]);
      gl.uniform1f(u.gamma, p.gamma);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    clear() {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
  };
}
