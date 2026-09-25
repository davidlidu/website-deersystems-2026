// Orbe de vidrio líquido: raymarching de una esfera deformada por ruido
// animado, con refracción, fresnel, especulares y halo exterior.
// El mismo algoritmo existe en WGSL (WebGPU) y GLSL ES 3.0 (respaldo WebGL2).
//
// Uniforms (5 x vec4):
//   u0 = (tiempo, ancho, alto, _)
//   u1 = (wobble, refraction, glow, _)
//   cA, cB, cC = colores rgb; cA.w / cB.w = puntero x / y en [-1, 1]

export const WGSL = /* wgsl */ `
struct Uniforms { u0: vec4f, u1: vec4f, cA: vec4f, cB: vec4f, cC: vec4f };
@group(0) @binding(0) var<uniform> U: Uniforms;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  return vec4f(p[i], 0.0, 1.0);
}

fn field(p: vec3f, t: f32) -> f32 {
  var n = sin(p.x * 2.1 + t) * sin(p.y * 2.3 - t * 0.8) * sin(p.z * 1.9 + t * 0.6);
  n += 0.5 * sin(p.x * 4.3 - t * 1.3 + p.z * 3.1) * sin(p.y * 3.7 + t * 1.1);
  return n;
}

fn sdf(p: vec3f, t: f32) -> f32 {
  return length(p) - 1.0 - U.u1.x * 0.08 * field(p, t);
}

fn calcNormal(p: vec3f, t: f32) -> vec3f {
  let e = 0.0015;
  let a = vec3f(1.0, -1.0, -1.0);
  let b = vec3f(-1.0, -1.0, 1.0);
  let c = vec3f(-1.0, 1.0, -1.0);
  let d = vec3f(1.0, 1.0, 1.0);
  return normalize(a * sdf(p + a * e, t) + b * sdf(p + b * e, t) + c * sdf(p + c * e, t) + d * sdf(p + d * e, t));
}

fn liquid(q: vec3f, t: f32) -> vec3f {
  let b = sin(q.x * 3.0 + t) + sin(q.y * 4.0 - t * 1.2) + sin((q.x + q.y + q.z) * 2.5 + t * 0.7);
  var col = mix(U.cC.rgb, U.cA.rgb, smoothstep(-1.6, 0.6, b));
  col = mix(col, U.cB.rgb, smoothstep(0.8, 2.2, b + sin(q.z * 3.0 + t * 0.9)));
  return col;
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let res = U.u0.yz;
  let fc = vec2f(pos.x, res.y - pos.y);
  let m = min(res.x, res.y);
  let uv = (fc * 2.0 - res) / m;
  let t = U.u0.x;
  let ro = vec3f(0.0, 0.0, 3.4);
  let rd = normalize(vec3f(uv, -2.0));

  var tt = 0.0;
  var minD = 1000.0;
  var hit = false;
  var p = ro;
  for (var i = 0; i < 72; i++) {
    p = ro + rd * tt;
    let d = sdf(p, t);
    minD = min(minD, d);
    if (d < 0.001) { hit = true; break; }
    tt += d * 0.8;
    if (tt > 7.0) { break; }
  }

  let ang = atan2(uv.y, uv.x);
  let glowCol = mix(U.cA.rgb, U.cB.rgb, 0.5 + 0.5 * sin(ang * 2.0 + t * 0.8));
  let g = U.u1.z * exp(-max(minD, 0.0) * 5.0) * 0.75 * (1.0 - smoothstep(0.62, 0.98, length(uv)));
  let rimCol = 1.0 - exp(-mix(U.cB.rgb, vec3f(1.0), 0.35) * 1.3 * 1.35);
  let pointer = vec2f(U.cA.w, U.cB.w);

  if (hit) {
    let n = calcNormal(p, t);
    let ndv = max(dot(n, -rd), 0.0);
    let fres = pow(1.0 - ndv, 3.0);
    let rr = refract(rd, n, 1.0 / (1.0 + U.u1.y * 0.6));
    let q = p + rr * (0.9 + U.u1.y * 0.8);
    var inner = liquid(q * 1.3, t) * (0.55 + 0.6 * ndv);
    let L = normalize(vec3f(-0.55 + pointer.x * 0.6, 0.75 + pointer.y * 0.4, 0.6));
    let spec = pow(max(dot(n, normalize(L - rd)), 0.0), 90.0) * 1.6;
    let L2 = normalize(vec3f(0.7, -0.6, 0.4));
    let spec2 = pow(max(dot(n, normalize(L2 - rd)), 0.0), 24.0) * 0.35;
    let rim = fres * mix(U.cB.rgb, vec3f(1.0), 0.35) * 1.3;
    let col = 1.0 - exp(-(inner + rim + vec3f(spec) + spec2 * U.cB.rgb) * 1.35);
    return vec4f(col, 1.0);
  }

  // Borde suavizado (antialias) + halo exterior premultiplicado.
  let px = 3.4 * 2.0 / m;
  let cov = 1.0 - smoothstep(0.0, px * 1.5, minD);
  let glow = min(glowCol * g, vec3f(g));
  let a = cov + g * (1.0 - cov);
  return vec4f(rimCol * cov + glow * (1.0 - cov), a);
}
`;

export const GLSL_VS = /* glsl */ `#version 300 es
void main() {
  vec2 p[3] = vec2[3](vec2(-1.0, -3.0), vec2(-1.0, 1.0), vec2(3.0, 1.0));
  gl_Position = vec4(p[gl_VertexID], 0.0, 1.0);
}
`;

export const GLSL_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 u0;
uniform vec4 u1;
uniform vec4 cA;
uniform vec4 cB;
uniform vec4 cC;
out vec4 outColor;

float field(vec3 p, float t) {
  float n = sin(p.x * 2.1 + t) * sin(p.y * 2.3 - t * 0.8) * sin(p.z * 1.9 + t * 0.6);
  n += 0.5 * sin(p.x * 4.3 - t * 1.3 + p.z * 3.1) * sin(p.y * 3.7 + t * 1.1);
  return n;
}

float sdf(vec3 p, float t) {
  return length(p) - 1.0 - u1.x * 0.08 * field(p, t);
}

vec3 calcNormal(vec3 p, float t) {
  const float e = 0.0015;
  const vec3 a = vec3(1.0, -1.0, -1.0);
  const vec3 b = vec3(-1.0, -1.0, 1.0);
  const vec3 c = vec3(-1.0, 1.0, -1.0);
  const vec3 d = vec3(1.0, 1.0, 1.0);
  return normalize(a * sdf(p + a * e, t) + b * sdf(p + b * e, t) + c * sdf(p + c * e, t) + d * sdf(p + d * e, t));
}

vec3 liquid(vec3 q, float t) {
  float b = sin(q.x * 3.0 + t) + sin(q.y * 4.0 - t * 1.2) + sin((q.x + q.y + q.z) * 2.5 + t * 0.7);
  vec3 col = mix(cC.rgb, cA.rgb, smoothstep(-1.6, 0.6, b));
  col = mix(col, cB.rgb, smoothstep(0.8, 2.2, b + sin(q.z * 3.0 + t * 0.9)));
  return col;
}

void main() {
  vec2 res = u0.yz;
  float m = min(res.x, res.y);
  vec2 uv = (gl_FragCoord.xy * 2.0 - res) / m;
  float t = u0.x;
  vec3 ro = vec3(0.0, 0.0, 3.4);
  vec3 rd = normalize(vec3(uv, -2.0));

  float tt = 0.0;
  float minD = 1000.0;
  bool hit = false;
  vec3 p = ro;
  for (int i = 0; i < 72; i++) {
    p = ro + rd * tt;
    float d = sdf(p, t);
    minD = min(minD, d);
    if (d < 0.001) { hit = true; break; }
    tt += d * 0.8;
    if (tt > 7.0) break;
  }

  float ang = atan(uv.y, uv.x);
  vec3 glowCol = mix(cA.rgb, cB.rgb, 0.5 + 0.5 * sin(ang * 2.0 + t * 0.8));
  float g = u1.z * exp(-max(minD, 0.0) * 5.0) * 0.75 * (1.0 - smoothstep(0.62, 0.98, length(uv)));
  vec3 rimCol = 1.0 - exp(-mix(cB.rgb, vec3(1.0), 0.35) * 1.3 * 1.35);
  vec2 pointer = vec2(cA.w, cB.w);

  if (hit) {
    vec3 n = calcNormal(p, t);
    float ndv = max(dot(n, -rd), 0.0);
    float fres = pow(1.0 - ndv, 3.0);
    vec3 rr = refract(rd, n, 1.0 / (1.0 + u1.y * 0.6));
    vec3 q = p + rr * (0.9 + u1.y * 0.8);
    vec3 inner = liquid(q * 1.3, t) * (0.55 + 0.6 * ndv);
    vec3 L = normalize(vec3(-0.55 + pointer.x * 0.6, 0.75 + pointer.y * 0.4, 0.6));
    float spec = pow(max(dot(n, normalize(L - rd)), 0.0), 90.0) * 1.6;
    vec3 L2 = normalize(vec3(0.7, -0.6, 0.4));
    float spec2 = pow(max(dot(n, normalize(L2 - rd)), 0.0), 24.0) * 0.35;
    vec3 rim = fres * mix(cB.rgb, vec3(1.0), 0.35) * 1.3;
    vec3 col = 1.0 - exp(-(inner + rim + vec3(spec) + spec2 * cB.rgb) * 1.35);
    outColor = vec4(col, 1.0);
    return;
  }

  float px = 3.4 * 2.0 / m;
  float cov = 1.0 - smoothstep(0.0, px * 1.5, minD);
  vec3 glow = min(glowCol * g, vec3(g));
  float a = cov + g * (1.0 - cov);
  outColor = vec4(rimCol * cov + glow * (1.0 - cov), a);
}
`;
