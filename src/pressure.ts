// Pressure coefficient Cp = 1 − |V|² per pixel on the GPU, read from the velocity grids
// of the panel solution (see aero.ts), for the 2D view.
import type { Airfoil, Flow, FlowField, Grid } from './aero';

// Written for GLSL ES 1 (texture2D); the WebGL2 layer below maps it to GLSL ES 3.
export const PRESSURE_GLSL = /* glsl */ `
  uniform vec2 uRot;          // (cos α, sin α)
  uniform sampler2D uFine;    // per node: |V₀|², V₀·V₉₀, |V₉₀|², inside
  uniform vec3 uFineGrid;     // x0, y0, spacing
  uniform vec2 uFineSize;     // nodes along x and y
  uniform sampler2D uCoarse;
  uniform vec3 uCoarseGrid;
  uniform vec2 uCoarseSize;
  uniform vec2 uCirculation;  // for α = 0° and 90°, clockwise
  uniform vec2 uCentre;       // far-field vortex position

  vec4 gridNode(sampler2D t, vec2 size, vec2 ij) {
    return texture2D(t, (ij + 0.5) / size);
  }

  // Bilinear interpolation between nodes (the textures use nearest sampling).
  vec4 sampleGrid(sampler2D t, vec3 grid, vec2 size, vec2 q) {
    vec2 f = (q - grid.xy) / grid.z;
    vec2 i = clamp(floor(f), vec2(0.0), size - 2.0);
    vec2 w = f - i;
    vec4 a = mix(gridNode(t, size, i), gridNode(t, size, i + vec2(1.0, 0.0)), w.x);
    vec4 b = mix(gridNode(t, size, i + vec2(0.0, 1.0)), gridNode(t, size, i + vec2(1.0, 1.0)), w.x);
    return mix(a, b, w.y);
  }

  bool inGrid(vec3 grid, vec2 size, vec2 q) {
    vec2 f = (q - grid.xy) / grid.z;
    return all(greaterThanEqual(f, vec2(0.0))) && all(lessThanEqual(f, size - 1.0));
  }

  // Returns Cp at a world point, or 1e9 inside the wing.
  float pressureCoefficient(vec2 p) {
    float ca = uRot.x, sa = uRot.y;
    vec2 q = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
    vec4 s;
    if (inGrid(uFineGrid, uFineSize, q)) {
      s = sampleGrid(uFine, uFineGrid, uFineSize, q);
    } else if (inGrid(uCoarseGrid, uCoarseSize, q)) {
      s = sampleGrid(uCoarse, uCoarseGrid, uCoarseSize, q);
    } else {
      // Far away: freestream plus a point vortex.
      float gamma = dot(uCirculation, uRot);
      vec2 d = q - uCentre;
      vec2 v = vec2(ca, sa) + gamma / (6.2831853 * dot(d, d)) * vec2(d.y, -d.x);
      return 1.0 - dot(v, v);
    }
    // Only fully inside cells are cut out: the colour then runs under the wing outline, with no gap.
    if (s.w > 0.999) return 1e9;
    return 1.0 - (ca * ca * s.x + 2.0 * ca * sa * s.y + sa * sa * s.z);
  }

  // Blue for suction, red for overpressure. Premultiplied alpha.
  vec4 pressureColor(float cp, float opacity) {
    if (cp > 1e8) return vec4(0.0);
    vec3 rgb = cp < 0.0 ? vec3(0.231, 0.510, 0.965) : vec3(0.937, 0.267, 0.267);
    float a = opacity * min(1.0, cp < 0.0 ? -cp / 1.5 : cp);
    return vec4(rgb * a, a);
  }
`;

/** Uniform values for PRESSURE_GLSL, except the two grid textures. */
export function pressureUniforms(field: FlowField, flow: Flow) {
  const { fine, coarse } = field;
  return {
    rot: [flow.ca, flow.sa],
    fineGrid: [fine.x0, fine.y0, fine.h],
    fineSize: [fine.nx, fine.ny],
    coarseGrid: [coarse.x0, coarse.y0, coarse.h],
    coarseSize: [coarse.nx, coarse.ny],
    circulation: field.circulation,
    centre: [field.centre.x, field.centre.y],
  };
}

const VERTEX = `#version 300 es
  in vec2 aPos;
  void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAGMENT = `#version 300 es
  precision highp float;
  #define texture2D texture
  out vec4 fragColor;
  uniform vec2 uOrigin;   // world position of the bottom-left pixel
  uniform float uScale;   // world units per device pixel
  ${PRESSURE_GLSL}
  void main() {
    vec2 p = uOrigin + gl_FragCoord.xy * uScale;
    fragColor = pressureColor(pressureCoefficient(p), 0.78);
  }
`;

/**
 * Full-canvas pressure map with raw WebGL2, so the 2D view does not need three.js.
 * Returns null when WebGL2 is unavailable.
 */
export function createPressureLayer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
  if (!gl) return null;

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type) as WebGLShader;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader');
    return shader;
  };
  const program = gl.createProgram();
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

  const loc = (name: string) => gl.getUniformLocation(program, name);
  const textures = [gl.createTexture(), gl.createTexture()];
  gl.uniform1i(loc('uFine'), 0);
  gl.uniform1i(loc('uCoarse'), 1);
  let uploaded: FlowField | null = null;

  const upload = (unit: number, grid: Grid) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, grid.nx, grid.ny, 0, gl.RGBA, gl.FLOAT, grid.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };

  return {
    /**
     * `view`: world origin (bottom-left) and CSS pixels per world unit.
     * `dpr`: canvas pixels per CSS pixel.
     */
    draw(af: Airfoil, flow: Flow, view: { x0: number; y0: number; s: number }, dpr: number) {
      if (uploaded !== af.field) {
        upload(0, af.field.fine);
        upload(1, af.field.coarse);
        uploaded = af.field;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const u = pressureUniforms(af.field, flow);
      gl.uniform2f(loc('uOrigin'), view.x0, view.y0);
      gl.uniform1f(loc('uScale'), 1 / (view.s * dpr));
      gl.uniform2fv(loc('uRot'), u.rot);
      gl.uniform3fv(loc('uFineGrid'), u.fineGrid);
      gl.uniform2fv(loc('uFineSize'), u.fineSize);
      gl.uniform3fv(loc('uCoarseGrid'), u.coarseGrid);
      gl.uniform2fv(loc('uCoarseSize'), u.coarseSize);
      gl.uniform2fv(loc('uCirculation'), u.circulation);
      gl.uniform2fv(loc('uCentre'), u.centre);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    clear() {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
  };
}
