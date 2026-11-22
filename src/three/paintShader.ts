import * as THREE from 'three';
import type { LightState, PaintParams } from '../types';

/**
 * 四层车漆着色器
 * 物理叠层顺序（背向 → 面向观察者）：
 *   电泳衬底层 → 中涂层（Beer-Lambert 厚度吸收）→ 金属/珠光片层 → 清漆层（IOR 菲涅尔界面）
 * 清漆高光以加法合成在最上层，数学上保证不会被片层遮挡。
 *
 * debugMode:
 *   0 完整合成  1 清漆层高光贡献  2 底层高光贡献（粘结剂+片层+闪烁）
 *   3 片层法线可视化  4 四层逐段叠加分解
 */

const vertexShader = /* glsl */ `
  out vec3 vWorldPos;
  out vec3 vWorldNormal;
  out vec2 vUv;
  out vec3 vViewDir;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = cameraPosition - worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  in vec3 vWorldPos;
  in vec3 vWorldNormal;
  in vec2 vUv;
  in vec3 vViewDir;

  out vec4 fragColor;

  // 电泳层
  uniform vec3  uElectroColor;
  uniform float uElectroRough;
  uniform float uElectroThick;
  // 中涂层
  uniform vec3  uMidColor;
  uniform float uMidRough;
  uniform float uMidThick;
  uniform float uMidOpacity;
  // 片层
  uniform float uFlakeType;       // 0 金属 / 1 珠光
  uniform float uFlakeOrientation; // 0 高光泽取向集中 / 1 低光泽取向散乱
  uniform vec3  uFlakeColor;
  uniform float uFlakeDensity;
  uniform float uFlakeRough;
  uniform float uFlakeThick;
  uniform float uFlakeSize;
  uniform float uSparkle;
  // 清漆层
  uniform float uClearThick;
  uniform float uClearIor;
  uniform float uClearRough;
  uniform vec3  uClearTint;
  // 光照 / 环境
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform float uLightIntensity;
  uniform samplerCube uEnvMap;
  uniform float uEnvIntensity;
  uniform float uTime;
  uniform int uDebugMode;

  const float PI = 3.14159265359;

  // ───────────────────────── 微表面 BRDF 工具 ─────────────────────────
  float D_GGX(float NdotH, float alpha) {
    float a2 = alpha * alpha;
    float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / max(PI * d * d, 1e-7);
  }

  float V_SmithGGX(float NdotV, float NdotL, float alpha) {
    float a2 = alpha * alpha;
    float ggxV = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
    float ggxL = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
    return 0.5 / max(ggxV + ggxL, 1e-7);
  }

  vec3 F_Schlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
  }

  vec3 specBRDF(vec3 N, vec3 V, vec3 L, float rough, vec3 F0, out float NdotL) {
    float alpha = max(rough * rough, 1e-3);
    vec3 H = normalize(L + V);
    NdotL = max(dot(N, L), 0.0);
    float NdotV = max(dot(N, V), 1e-4);
    float NdotH = max(dot(N, H), 0.0);
    float VdotH = max(dot(V, H), 0.0);
    float D = D_GGX(NdotH, alpha);
    float Vis = V_SmithGGX(NdotV, NdotL, alpha);
    vec3 F = F_Schlick(VdotH, F0);
    return D * Vis * F;
  }

  // 以参考厚度 40μm 反推吸收系数，再按实际厚度做 Beer-Lambert
  vec3 beerTransmittance(vec3 color, float thickness) {
    vec3 sigma = -log(clamp(color, 0.002, 1.0)) / 40.0;
    return exp(-sigma * thickness);
  }

  // ───────────────────────── 程序化鳞片场 ─────────────────────────
  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  float vnoise(vec3 p) {
    vec3 cell = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); // quintic，C2 连续
    float n000 = hash31(cell + vec3(0.0, 0.0, 0.0));
    float n100 = hash31(cell + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(cell + vec3(0.0, 1.0, 0.0));
    float n110 = hash31(cell + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(cell + vec3(0.0, 0.0, 1.0));
    float n101 = hash31(cell + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(cell + vec3(0.0, 1.0, 1.0));
    float n111 = hash31(cell + vec3(1.0, 1.0, 1.0));
    float nx00 = mix(n000, n100, u.x);
    float nx10 = mix(n010, n110, u.x);
    float nx01 = mix(n001, n101, u.x);
    float nx11 = mix(n011, n111, u.x);
    float nxy0 = mix(nx00, nx10, u.y);
    float nxy1 = mix(nx01, nx11, u.y);
    return mix(nxy0, nxy1, u.z);
  }

  // 连续鳞片法线：三路偏移值噪声解析差分，无细胞边界硬切；spread 控制朝向散布
  vec3 flakeField(vec3 p, float scale, float spread) {
    vec3 q = p * scale;
    float e = 0.18;
    float n  = vnoise(q);
    float nx = vnoise(q + vec3(e, 0.0, 0.0)) - n;
    float ny = vnoise(q + vec3(0.0, e, 0.0)) - n;
    float nz = vnoise(q + vec3(0.0, 0.0, e)) - n;
    vec3 grad = vec3(nx, ny, nz) / e;
    // 高光泽 spread 小 → 法线贴近几何面；低光泽 spread 大 → 朝向散乱
    return normalize(vec3(grad.xy * spread, 1.0 - abs(grad.z) * spread * 0.3));
  }

  vec3 envSample(vec3 R, float rough) {
    float lod = clamp(rough * 6.0, 0.0, 6.0);
    return textureLod(uEnvMap, R, lod).rgb * uEnvIntensity;
  }

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(vViewDir);
    vec3 L = normalize(uLightDir);
    float NdotV = max(dot(N, V), 1e-4);

    // 切线基，用于把鳞片局部法线转到世界空间
    vec3 T = normalize(cross(N, abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 B = cross(N, T);

    // 两档光泽度：高光泽鳞片取向集中（spread 小），低光泽散乱（spread 大）
    float spread = mix(0.22, 0.78, uFlakeOrientation);
    // 世界空间频率：尺寸越大片数越少
    float flakeScale = 14.0 / max(uFlakeSize, 0.1);
    vec3 flakePos = vWorldPos * 2.2 + N * 0.37;
    vec3 ff = flakeField(flakePos, flakeScale, spread);
    // 鳞片法线仅在切线方向扰动；掠射角（NdotV 小）处扰动收敛回几何法线，避免边缘翻转
    float grazingFade = smoothstep(0.05, 0.35, NdotV);
    vec3 Nf = normalize(N + (T * ff.x + B * ff.y) * 0.42 * grazingFade);

    // 高遮盖金属漆覆盖模型：以 density 为基底，噪声只产生低振幅片间亮度差异，
    // 高密度下趋近全覆盖，避免 0/1 细胞在掠射弱光区形成黑孔斑驳。
    float coverNoise =
      vnoise(flakePos * flakeScale) * 0.72 + vnoise(flakePos * flakeScale * 2.3 + 5.1) * 0.28;
    float density = clamp(uFlakeDensity, 0.0, 1.0);
    float coverage = clamp(density + (coverNoise - 0.5) * (1.0 - density) * 0.9, 0.0, 1.0);
    // 每片随机量（用于闪烁相位），改由连续噪声派生
    float cellRand = coverNoise;

    // 闪烁：每片独立随机强度 + 极慢时序呼吸，门槛收窄只在半矢量附近触发
    float twinkle = 0.75 + 0.25 * sin(uTime * 1.4 + cellRand * 40.0);
    float sparkleGate = smoothstep(0.92, 0.99, dot(Nf, normalize(L + V)));

    // ── 第 1 层：电泳衬底（漫反射 + 微弱粗糙高光）──
    float eNdotL;
    vec3 electroSpec = specBRDF(N, V, L, uElectroRough, vec3(0.03), eNdotL)
      * uLightColor * uLightIntensity * eNdotL;
    vec3 electroDiff = uElectroColor * (uLightColor * eNdotL * uLightIntensity
      + max(envSample(N, 0.9), uElectroColor * 0.15) * 0.55);
    vec3 accElectro = electroDiff + electroSpec;

    // ── 第 2 层：中涂色素层。色漆为高遮盖不透明层：opacity 主导，
    // Beer-Lambert 厚度只决定对电泳衬底的微弱透出，避免掠射处衬底斑驳翻出。──
    vec3 TmidBeer = beerTransmittance(uMidColor, uMidThick);
    // 实际透射 = 仅在未遮盖比例内，且被厚度吸收进一步压制
    vec3 Tmid = TmidBeer * (1.0 - uMidOpacity);
    float mNdotL;
    vec3 midSpec = specBRDF(N, V, L, uMidRough, vec3(0.04), mNdotL)
      * uLightColor * uLightIntensity * mNdotL;
    // 漫反射加环境下限，保证背光/掠射处仍保持色漆本色而非发黑
    vec3 midEnv = max(envSample(N, 0.85), uMidColor * 0.18);
    vec3 midDiff = uMidColor * (uLightColor * mNdotL * uLightIntensity + midEnv * 0.5);
    // 不透明部分显示色漆自身，透射部分才露出电泳层
    vec3 accMid = midDiff * (1.0 - Tmid) + accElectro * Tmid + midSpec;

    // ── 第 3 层：金属 / 珠光片层 ──
    vec3 flakeF0 = uFlakeColor;
    if (uFlakeType > 0.5) {
      // 珠光干涉：掠射角向互补干涉色偏移，产生随角异色
      vec3 interference = clamp(vec3(1.0) - uFlakeColor, 0.0, 1.0);
      float fres = pow(1.0 - NdotV, 2.2);
      flakeF0 = mix(uFlakeColor, interference, fres * 0.65);
    }
    float fNdotL;
    vec3 flakeSpecDir = specBRDF(Nf, V, L, uFlakeRough, flakeF0, fNdotL)
      * uLightColor * uLightIntensity * fNdotL;
    vec3 Rf = reflect(-V, Nf);
    // 环境反射加片体色兜底，避免掠射处采样到黑色天幕产生黑孔
    vec3 envRaw = max(envSample(Rf, uFlakeRough), flakeF0 * 0.12);
    vec3 flakeEnv = envRaw * flakeF0;
    float sparkle = sparkleGate * uSparkle * twinkle * cellRand * uLightIntensity;
    // 鳞片反射只做正向加法：任何角度下鳞片不产生黑色，无反射贡献处自然透出中涂层
    vec3 flakeReflect = max(flakeSpecDir + flakeEnv * 0.7, vec3(0.0));
    // 掠射处片层整体平滑淡出，避免覆盖噪声在弱环境光区形成明暗斑驳（由清漆菲涅尔接管）
    float flakeViewWeight = smoothstep(0.25, 0.65, NdotV);
    vec3 flakeContrib =
      (flakeReflect * coverage + max(vec3(sparkle), vec3(0.0)) * coverage) * flakeViewWeight;

    // 珠光片层附加一层宽角度柔光泽
    if (uFlakeType > 0.5) {
      float sheen = pow(1.0 - NdotV, 3.0) * coverage * 0.35;
      flakeContrib += flakeF0 * sheen * uEnvIntensity;
    }

    // 片层为反射性鳞片：反射按覆盖率加法叠加；片层粘结剂随厚度产生微弱中性透射衰减，
    // 不压黑鳞片本身（此前对片体色做 Beer-Lambert 是珠光黑斑根因）。
    float binderT = exp(-0.006 * uFlakeThick);
    vec3 accFlake = flakeContrib + accMid * binderT;

    // 底层（清漆以下）全部高光贡献：电泳/中涂粘结剂高光 + 片层高光 + 闪烁
    vec3 baseSpecOnly = midSpec + electroSpec
      + (flakeSpecDir + vec3(sparkle)) * coverage;

    // ── 第 4 层：清漆层（IOR 菲涅尔界面，高光永远叠加在最上层）──
    float F0clear = pow((uClearIor - 1.0) / (uClearIor + 1.0), 2.0);
    float cNdotL;
    vec3 clearSpecDir = specBRDF(N, V, L, uClearRough, vec3(F0clear), cNdotL)
      * uLightColor * uLightIntensity * cNdotL;
    vec3 R = reflect(-V, N);
    float fresnel = F_Schlick(NdotV, vec3(F0clear)).r;
    vec3 clearEnv = envSample(R, uClearRough) * fresnel;
    vec3 Tclear = beerTransmittance(uClearTint, uClearThick);
    vec3 clearSpecOnly = clearSpecDir + clearEnv;
    vec3 accClear = clearSpecOnly + accFlake * Tclear;

    // ── 调试输出 ──
    if (uDebugMode == 1) {
      fragColor = vec4(clearSpecOnly, 1.0);
      return;
    }
    if (uDebugMode == 2) {
      fragColor = vec4(baseSpecOnly, 1.0);
      return;
    }
    if (uDebugMode == 3) {
      fragColor = vec4(Nf * 0.5 + 0.5, 1.0);
      return;
    }
    if (uDebugMode == 4) {
      float band = vUv.y;
      vec3 c = band < 0.25 ? accElectro
             : band < 0.50 ? accMid
             : band < 0.75 ? accFlake
             : accClear;
      fragColor = vec4(c, 1.0);
      return;
    }

    fragColor = vec4(accClear, 1.0);
  }
`;

export interface PaintUniforms {
  uElectroColor: { value: THREE.Color };
  uElectroRough: { value: number };
  uElectroThick: { value: number };
  uMidColor: { value: THREE.Color };
  uMidRough: { value: number };
  uMidThick: { value: number };
  uMidOpacity: { value: number };
  uFlakeType: { value: number };
  uFlakeOrientation: { value: number };
  uFlakeColor: { value: THREE.Color };
  uFlakeDensity: { value: number };
  uFlakeRough: { value: number };
  uFlakeThick: { value: number };
  uFlakeSize: { value: number };
  uSparkle: { value: number };
  uClearThick: { value: number };
  uClearIor: { value: number };
  uClearRough: { value: number };
  uClearTint: { value: THREE.Color };
  uLightDir: { value: THREE.Vector3 };
  uLightColor: { value: THREE.Color };
  uLightIntensity: { value: number };
  uEnvMap: { value: THREE.CubeTexture | null };
  uEnvIntensity: { value: number };
  uTime: { value: number };
  uDebugMode: { value: number };
  [uniform: string]: THREE.IUniform;
}

export function createPaintUniforms(): PaintUniforms {
  return {
    uElectroColor: { value: new THREE.Color('#3a3d42') },
    uElectroRough: { value: 0.55 },
    uElectroThick: { value: 22 },
    uMidColor: { value: new THREE.Color('#b8bcc2') },
    uMidRough: { value: 0.32 },
    uMidThick: { value: 38 },
    uMidOpacity: { value: 0.92 },
    uFlakeType: { value: 0 },
    uFlakeOrientation: { value: 0 },
    uFlakeColor: { value: new THREE.Color('#e8ebee') },
    uFlakeDensity: { value: 0.85 },
    uFlakeRough: { value: 0.22 },
    uFlakeThick: { value: 18 },
    uFlakeSize: { value: 1 },
    uSparkle: { value: 0.55 },
    uClearThick: { value: 45 },
    uClearIor: { value: 1.52 },
    uClearRough: { value: 0.04 },
    uClearTint: { value: new THREE.Color('#ffffff') },
    uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.6).normalize() },
    uLightColor: { value: new THREE.Color('#fff4e6') },
    uLightIntensity: { value: 2.2 },
    uEnvMap: { value: null },
    uEnvIntensity: { value: 0.5 },
    uTime: { value: 0 },
    uDebugMode: { value: 0 },
  };
}

export function createPaintMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'FourLayerCarPaint',
    uniforms: createPaintUniforms(),
    vertexShader,
    fragmentShader,
    glslVersion: THREE.GLSL3,
  });
}

/** 滑块调参路径：只写 uniform，不触发 shader 重编译 */
export function applyParamsToUniforms(u: PaintUniforms, p: PaintParams): void {
  u.uElectroColor.value.set(p.electro.color);
  u.uElectroRough.value = p.electro.roughness;
  u.uElectroThick.value = p.electro.thickness;

  u.uMidColor.value.set(p.mid.color);
  u.uMidRough.value = p.mid.roughness;
  u.uMidThick.value = p.mid.thickness;
  u.uMidOpacity.value = p.mid.opacity;

  u.uFlakeType.value = p.flake.type === 'pearlescent' ? 1 : 0;
  u.uFlakeOrientation.value = p.flake.orientation === 'highGloss' ? 0 : 1;
  u.uFlakeColor.value.set(p.flake.flakeColor);
  u.uFlakeDensity.value = p.flake.flakeDensity;
  u.uFlakeRough.value = p.flake.roughness;
  u.uFlakeThick.value = p.flake.thickness;
  u.uFlakeSize.value = p.flake.flakeSize;
  u.uSparkle.value = p.flake.sparkle;

  u.uClearThick.value = p.clear.thickness;
  u.uClearIor.value = p.clear.ior;
  u.uClearRough.value = p.clear.roughness;
  u.uClearTint.value.set(p.clear.tint);
}

export function applyLightToUniforms(u: PaintUniforms, light: LightState): void {
  const az = THREE.MathUtils.degToRad(light.azimuth);
  const el = THREE.MathUtils.degToRad(light.elevation);
  u.uLightDir.value.set(
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    Math.cos(el) * Math.cos(az),
  ).normalize();
  u.uLightIntensity.value = light.intensity;
}
