import * as THREE from 'three';
import { SNOW_GRID, TERRAIN } from './constants';

/**
 * 地形与积雪的共享 GLSL。
 * CPU 端 terrainHeight() 的 GLSL 等价实现 —— 两处数值必须保持一致，
 * 粒子碰撞面与渲染面才不会出现穿插/悬浮。
 */
export const GLSL_TERRAIN_HEIGHT = /* glsl */ `
float terrainHeight(vec2 xz) {
  float x = xz.x;
  float z = xz.y;
  float undulation =
    sin(x * 0.11 + z * 0.035) * 0.6 +
    sin(z * 0.07 - x * 0.05) * 0.45 +
    cos(x * 0.045 + z * 0.09) * 0.6;
  return -${TERRAIN.SLOPE.toFixed(4)} * z + ${TERRAIN.NOISE_AMP.toFixed(4)} * undulation;
}
`;

const SNOW_UNIFORMS = /* glsl */ `
uniform sampler2D uSnowDepth;
uniform float uMaxSnowDepth;
uniform vec2 uSnowGridSize;
uniform vec2 uTerrainSize;
`;

/** 积雪厚度双线性采样（与 SnowField.sampleDepth 对应） */
const SNOW_SAMPLE = /* glsl */ `
float sampleSnowDepth(vec2 xz) {
  vec2 uv = vec2(xz.x / uTerrainSize.x + 0.5, xz.y / uTerrainSize.y + 0.5);
  uv = clamp(uv, vec2(0.001), vec2(0.999));
  vec2 f = uv * uSnowGridSize - vec2(0.5);
  vec2 i0 = floor(f);
  vec2 t = f - i0;
  ivec2 g0 = ivec2(i0);
  float a = mix(texelFetch(uSnowDepth, g0, 0).r,
                texelFetch(uSnowDepth, g0 + ivec2(1, 0), 0).r, t.x);
  float b = mix(texelFetch(uSnowDepth, g0 + ivec2(0, 1), 0).r,
                texelFetch(uSnowDepth, g0 + ivec2(1, 1), 0).r, t.x);
  return clamp(mix(a, b, t.y), 0.0, uMaxSnowDepth);
}

vec3 snowSurface(vec2 xz) {
  return vec3(xz.x, terrainHeight(xz) + sampleSnowDepth(xz), xz.y);
}
`;

export interface TerrainMaterials {
  terrain: THREE.ShaderMaterial;
  depth: THREE.ShaderMaterial;
}

/**
 * 地形材质：顶点着色器按积雪厚度沿法线方向抬升顶点（高度表现），
 * 片元着色器把厚度映射成"裸坡 -> 薄雪蓝灰 -> 厚雪白"的色带（颜色表现），
 * 夜间模式切换为冷蓝月光配色。
 */
export function createTerrainMaterial(snowDepthTex: THREE.DataTexture): TerrainMaterials {
  const uniforms = {
    uSnowDepth: { value: snowDepthTex },
    uMaxSnowDepth: { value: SNOW_GRID.MAX_DEPTH },
    uSnowGridSize: { value: new THREE.Vector2(SNOW_GRID.NX, SNOW_GRID.NZ) },
    uTerrainSize: { value: new THREE.Vector2(TERRAIN.WIDTH, TERRAIN.LENGTH) },
    uNight: { value: 0 },
  };

  const terrain = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${SNOW_UNIFORMS}
      ${GLSL_TERRAIN_HEIGHT}
      ${SNOW_SAMPLE}
      varying float vDepth;
      varying vec3 vWorldNormal;
      varying vec2 vXZ;

      void main() {
        vec2 xz = position.xz;
        float baseY = terrainHeight(xz);
        float d = sampleSnowDepth(xz);
        vDepth = d;
        vXZ = xz;

        // 有限差分重建积雪面法线
        float e = 0.6;
        vec3 nrm = normalize(vec3(
          terrainHeight(xz - vec2(e, 0.0)) + sampleSnowDepth(xz - vec2(e, 0.0))
          - terrainHeight(xz + vec2(e, 0.0)) - sampleSnowDepth(xz + vec2(e, 0.0)),
          2.0 * e,
          terrainHeight(xz - vec2(0.0, e)) + sampleSnowDepth(xz - vec2(0.0, e))
          - terrainHeight(xz + vec2(0.0, e)) - sampleSnowDepth(xz + vec2(0.0, e))
        ));
        vWorldNormal = nrm;

        vec3 lifted = vec3(position.x, baseY + d, position.z);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(lifted, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      uniform float uMaxSnowDepth;
      varying float vDepth;
      varying vec3 vWorldNormal;
      varying vec2 vXZ;

      void main() {
        float t = clamp(vDepth / uMaxSnowDepth, 0.0, 1.0);

        // 色带：裸坡（褐绿）→ 薄雪（蓝灰）→ 厚雪（纯白）
        vec3 bare = vec3(0.23, 0.27, 0.20);
        vec3 thin = vec3(0.62, 0.70, 0.78);
        vec3 deep = vec3(0.97, 0.98, 1.0);
        vec3 dayCol = mix(bare, thin, smoothstep(0.0, 0.28, t));
        dayCol = mix(dayCol, deep, smoothstep(0.25, 0.9, t));

        // 夜间：整体压暗偏蓝，雪面保留月光高光
        vec3 nightCol = dayCol * vec3(0.28, 0.36, 0.58) + vec3(0.02, 0.03, 0.06);
        vec3 base = mix(dayCol, nightCol, uNight);

        vec3 lightDir = normalize(vec3(-0.4, 0.85, 0.3));
        float lambert = max(dot(normalize(vWorldNormal), lightDir), 0.0);
        float shade = mix(0.55, 1.0, lambert);
        vec3 color = base * mix(shade, 0.7 + 0.3 * lambert, uNight);

        // 等高线式厚度刻度，增强颜色可读性
        float band = smoothstep(0.46, 0.5, abs(fract(t * 6.0) - 0.5));
        color *= 1.0 - band * 0.12 * step(0.02, t);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  // 深度材质（可选的遮蔽后处理用，保持接口完整）
  const depth = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: terrain.vertexShader,
    fragmentShader: /* glsl */ `
      varying float vDepth;
      uniform float uMaxSnowDepth;
      void main() {
        gl_FragColor = vec4(vec3(clamp(vDepth / uMaxSnowDepth, 0.0, 1.0)), 1.0);
      }
    `,
  });

  return { terrain, depth };
}

export function setNightMode(mats: TerrainMaterials, night: boolean): void {
  const v = night ? 1 : 0;
  mats.terrain.uniforms.uNight.value = v;
  mats.depth.uniforms.uNight.value = v;
}
