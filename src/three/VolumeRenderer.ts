// 体积光线步进材质与网格

import * as THREE from 'three';
import { WORLD_X, WORLD_Y, WORLD_Z } from '../data/weatherSim';

const vertexShader = /* glsl */ `
out vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
precision highp sampler3D;
uniform sampler3D uData;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uThreshold;
uniform float uSteps;
in vec3 vWorldPos;

vec2 rayBox(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (uBoxMin - ro) * inv;
  vec3 t1 = (uBoxMax - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

float dens(vec3 p) {
  vec3 uvw = (p - uBoxMin) / (uBoxMax - uBoxMin);
  return texture(uData, uvw).r;
}

vec3 cloudColor(float d, float h) {
  vec3 low  = vec3(0.86, 0.89, 0.94);
  vec3 mid  = vec3(0.55, 0.60, 0.71);
  vec3 core = vec3(0.30, 0.26, 0.43);
  vec3 c = mix(low, mid, smoothstep(0.15, 0.5, d));
  c = mix(c, core, smoothstep(0.55, 0.95, d));
  c *= 0.72 + 0.28 * clamp(h / 8.0, 0.0, 1.0); // 云底更暗
  return c;
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - ro);
  vec2 t = rayBox(ro, rd);
  if (t.y <= t.x) discard;
  t.x = max(t.x, 0.0);
  float len = t.y - t.x;
  float stepLen = len / uSteps;
  vec3 p = ro + rd * (t.x + stepLen * 0.5);
  vec3 stepv = rd * stepLen;
  vec3 lightDir = normalize(vec3(0.45, 0.75, 0.35));
  vec3 acc = vec3(0.0);
  float alpha = 0.0;
  for (int i = 0; i < 220; i++) {
    if (float(i) >= uSteps || alpha > 0.96) break;
    float d = dens(p);
    if (d > uThreshold * 0.7) {
      float a = smoothstep(uThreshold, uThreshold + 0.18, d);
      if (a > 0.004) {
        float e = 0.35;
        vec3 g = vec3(
          dens(p + vec3(e, 0.0, 0.0)) - dens(p - vec3(e, 0.0, 0.0)),
          dens(p + vec3(0.0, e, 0.0)) - dens(p - vec3(0.0, e, 0.0)),
          dens(p + vec3(0.0, 0.0, e)) - dens(p - vec3(0.0, 0.0, e)));
        vec3 n = normalize(vec3(-g.x, abs(g.y) * 0.5 + 0.3, -g.z) + vec3(1e-4));
        float diff = 0.5 + 0.5 * dot(n, lightDir);
        vec3 base = cloudColor(d, p.y) * (0.6 + 0.55 * diff);
        float sa = 1.0 - exp(-a * stepLen * 2.2);
        acc += (1.0 - alpha) * sa * base;
        alpha += (1.0 - alpha) * sa;
      }
    }
    p += stepv;
  }
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(acc, alpha);
}
`;

export interface VolumeMesh {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  setData(data: Uint8Array, nx: number, ny: number, nz: number): void;
  setThreshold(v: number): void;
  dispose(): void;
}

export function createVolumeMesh(): VolumeMesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uData: { value: null as THREE.Data3DTexture | null },
      uThreshold: { value: 0.4 },
      uBoxMin: { value: new THREE.Vector3(0, 0, 0) },
      uBoxMax: { value: new THREE.Vector3(WORLD_X, WORLD_Y, WORLD_Z) },
      uSteps: { value: 160 },
    },
    vertexShader,
    fragmentShader,
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
  });

  const geo = new THREE.BoxGeometry(WORLD_X, WORLD_Y, WORLD_Z);
  geo.translate(WORLD_X / 2, WORLD_Y / 2, WORLD_Z / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;

  let texture: THREE.Data3DTexture | null = null;

  return {
    mesh,
    material,
    setData(data, nx, ny, nz) {
      const tex = new THREE.Data3DTexture(data, nx, ny, nz);
      tex.format = THREE.RedFormat;
      tex.type = THREE.UnsignedByteType;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
      tex.unpackAlignment = 1;
      tex.needsUpdate = true;
      if (texture) texture.dispose();
      texture = tex;
      material.uniforms.uData.value = tex;
    },
    setThreshold(v) {
      material.uniforms.uThreshold.value = v;
    },
    dispose() {
      if (texture) texture.dispose();
      geo.dispose();
      material.dispose();
    },
  };
}
