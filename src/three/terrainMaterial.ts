import * as THREE from 'three';
import { createCorduroyNormalMap } from './normalMap';

/**
 * 雪面自定义材质。
 *
 * - 刀纹高频细节由程序化法线贴图在片元层叠加，只在已压雪区域（aGroomed>0）生效；
 * - 棱纹/碎雪的低频起伏来自顶点位移，二者叠加得到最终刀纹观感；
 * - 雾层是同一网格的半透明渲染层：depthWrite=false、renderOrder 靠后，
 *   靠深度测试与压雪机、标注等实体正确互相遮挡；
 * - 方向光 + 环境光的简化 Lambert，雪面高环境反射，避免暗面死黑。
 */
export interface TerrainMaterialHandles {
  material: THREE.ShaderMaterial;
  fogMaterial: THREE.ShaderMaterial;
  setFogVisible: (v: boolean) => void;
  setCorduroyVisible: (v: boolean) => void;
  setWireframe: (v: boolean) => void;
  dispose: () => void;
}

const vertexShader = /* glsl */ `
  attribute float aGroomed;
  attribute vec2 aGuv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vGroomed;
  varying vec2 vGuv;
  void main() {
    vGroomed = aGroomed;
    vGuv = aGuv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uNormalMap;
  uniform vec3 uLightDir;
  uniform vec3 uSnowColor;
  uniform vec3 uGrooveColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uCorduroyOn;
  uniform float uOpacity;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vGroomed;
  varying vec2 vGuv;

  mat3 cotangentFrame(vec3 N, vec3 p, vec2 uv) {
    vec3 dp1 = dFdx(p);
    vec3 dp2 = dFdy(p);
    vec2 duv1 = dFdx(uv);
    vec2 duv2 = dFdy(uv);
    vec3 dp2perp = cross(dp2, N);
    vec3 dp1perp = cross(N, dp1);
    vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
    vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
    float invmax = inversesqrt(max(dot(T, T), dot(B, B)));
    return mat3(T * invmax, B * invmax, N);
  }

  void main() {
    vec3 N = normalize(vNormal);

    // 仅在已压雪区域叠加刀纹法线贴图
    if (vGroomed > 0.5 && uCorduroyOn > 0.5) {
      vec3 mapN = texture2D(uNormalMap, vGuv).xyz * 2.0 - 1.0;
      mat3 TBN = cotangentFrame(N, vWorldPos, vGuv);
      vec3 detailN = normalize(TBN * mapN);
      N = normalize(mix(N, detailN, 0.55));
    }

    vec3 L = normalize(uLightDir);
    float diff = max(dot(N, L), 0.0);
    float ambient = 0.55;
    vec3 base = mix(uSnowColor, uGrooveColor, vGroomed * 0.45);
    vec3 color = base * (ambient + diff * 0.65);

    // 压雪沟纹略带蓝灰，增强深度感
    if (vGroomed > 0.5) {
      float grooveShade = 0.9 + 0.1 * sin(vGuv.y * 6.2831853 * 40.0);
      color *= grooveShade;
    }

    // 指数雾：半透明雾层与不透明雪层共用同一套深度雾色
    float dist = length(cameraPosition - vWorldPos);
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    color = mix(color, uFogColor, clamp(fogFactor, 0.0, 0.85));

    gl_FragColor = vec4(color, uOpacity);
  }
`;

export function createTerrainMaterials(): TerrainMaterialHandles {
  const normalCanvas = createCorduroyNormalMap();
  const normalTex = new THREE.CanvasTexture(normalCanvas);
  normalTex.wrapS = THREE.RepeatWrapping;
  normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.anisotropy = 4;

  const uniforms = {
    uNormalMap: { value: normalTex },
    uLightDir: { value: new THREE.Vector3(-0.45, 0.8, 0.35).normalize() },
    uSnowColor: { value: new THREE.Color(0xf3f7fb) },
    uGrooveColor: { value: new THREE.Color(0xc9d8e6) },
    uFogColor: { value: new THREE.Color(0xe8eef4) },
    uFogDensity: { value: 0.0042 },
    uCorduroyOn: { value: 1 },
    uOpacity: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.FrontSide,
  });

  // 雾层：复制一份材质状态，半透明、不写深度，靠深度测试被实体遮挡
  const fogMaterial = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  fogMaterial.uniforms.uOpacity.value = 0.16;

  return {
    material,
    fogMaterial,
    setFogVisible: (v) => {
      fogMaterial.uniforms.uOpacity.value = v ? 0.16 : 0;
    },
    setCorduroyVisible: (v) => {
      material.uniforms.uCorduroyOn.value = v ? 1 : 0;
      fogMaterial.uniforms.uCorduroyOn.value = v ? 1 : 0;
    },
    setWireframe: (v) => {
      material.wireframe = v;
      fogMaterial.wireframe = false;
    },
    dispose: () => {
      normalTex.dispose();
      material.dispose();
      fogMaterial.dispose();
    },
  };
}
