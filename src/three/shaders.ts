/**
 * 实例化着色器。
 * 全部材质走 ShaderMaterial：每实例属性（覆盖率/阶段/层位/透明度/穹顶形变）
 * 由 InstancedBufferAttribute 提供，温湿度调节时只更新缓冲，不重建材质与几何。
 */

/** 通用投影头 */
const COMMON_HEADER = /* glsl */ `
  attribute float aLayer;
  uniform float uHighlightLayer;
  uniform float uTime;
  varying float vLayer;
  varying float vHighlight;

  void applyHighlight() {
    vLayer = aLayer;
    float hl = step(0.5, 1.0 - abs(aLayer - uHighlightLayer));
    // 呼吸脉冲，仅在对比高亮层生效
    vHighlight = hl * (0.55 + 0.45 * sin(uTime * 4.0));
  }
`;

/** 简单半球光 + 方向光（自定义材质不接入 three 灯光管线） */
const LIGHTING = /* glsl */ `
  vec3 shade(vec3 N, vec3 base) {
    vec3 L = normalize(vec3(0.45, 0.85, 0.35));
    float diff = max(dot(N, L), 0.0);
    vec3 hemi = mix(vec3(0.72, 0.76, 0.82), vec3(1.0, 0.98, 0.94), N.y * 0.5 + 0.5);
    vec3 col = base * hemi * (0.55 + 0.5 * diff);
    // 对比高亮：暖橙自发光脉冲
    col += vec3(1.0, 0.42, 0.08) * vHighlight * 0.65;
    return col;
  }
`;

/**
 * 法线 varying 声明。
 * 注意：raw ShaderMaterial 的内建 normal / normalMatrix 只在 vertex shader 可用，
 * fragment 必须通过 varying 接收视图空间法线。
 */
const NORMAL_VARYING = /* glsl */ `
  varying vec3 vNormal;
`;

/** vertex shader 末尾用法线 varying，需在 gl_Position 前调用 */
const NORMAL_VERTEX_WRITE = /* glsl */ `
  vNormal = normalize(normalMatrix * normal);
`;

// ── 菌棒体：培养基棕 → 菌丝白色，覆盖率驱动 ─────────────────────────────
export const STICK_VERTEX = /* glsl */ `
  attribute float aCoverage;
  attribute float aStage;
  varying float vCoverage;
  varying vec2 vUv;
  varying vec3 vNormal;
  ${COMMON_HEADER}
  void main() {
    applyHighlight();
    vCoverage = aCoverage;
    vUv = uv;
    vec3 transformed = position;
    // 菌丝定植后菌棒轻微膨胀（径向最多 +8%）
    float swell = 1.0 + 0.08 * aCoverage;
    transformed.y *= swell;
    transformed.z *= swell;
    // 膨胀近似均匀，直接用内建法线矩阵
    ${NORMAL_VERTEX_WRITE}
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

export const STICK_FRAGMENT = /* glsl */ `
  precision highp float;
  varying float vCoverage;
  varying vec2 vUv;
  varying float vHighlight;
  ${NORMAL_VARYING}
  ${LIGHTING}
  void main() {
    // 培养基深棕 ↔ 菌丝乳白
    vec3 substrate = vec3(0.30, 0.21, 0.14);
    vec3 mycelium = vec3(0.93, 0.91, 0.85);
    // 纵向细微纹理，避免纯色塑料感
    float grain = 0.94 + 0.06 * sin(vUv.x * 90.0 + sin(vUv.y * 17.0) * 2.0);
    vec3 base = mix(substrate, mycelium, vCoverage) * grain;
    gl_FragColor = vec4(shade(normalize(vNormal), base), 1.0);
  }
`;

// ── 菌膜：半透明，每实例透明度 0.2–0.7，参与深度测试 ───────────────────
export const MEMBRANE_VERTEX = /* glsl */ `
  attribute float aOpacity;
  varying float vOpacity;
  varying vec3 vViewDir;
  varying vec3 vNormal;
  ${COMMON_HEADER}
  void main() {
    applyHighlight();
    vOpacity = aOpacity;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mv.xyz);
    ${NORMAL_VERTEX_WRITE}
    gl_Position = projectionMatrix * mv;
  }
`;

export const MEMBRANE_FRAGMENT = /* glsl */ `
  precision highp float;
  varying float vOpacity;
  varying vec3 vViewDir;
  varying vec3 vNormal;
  varying float vHighlight;
  void main() {
    vec3 N = normalize(vNormal);
    // 菲涅耳边缘加强，塑料薄膜质感
    float fresnel = pow(1.0 - abs(dot(N, vViewDir)), 2.0);
    float alpha = clamp(vOpacity + fresnel * 0.12, 0.0, 0.85);
    vec3 base = vec3(0.92, 0.95, 1.0);
    base += vec3(1.0, 0.55, 0.2) * vHighlight * 0.35;
    gl_FragColor = vec4(base, alpha);
  }
`;

// ── 菌盖：aMorph 驱动穹顶厚度（纽扣 → 平展），阶段驱动颜色 ─────────────
export const CAP_VERTEX = /* glsl */ `
  attribute float aMorph;
  attribute float aStage;
  varying float vStage;
  varying float vMorph;
  varying vec3 vNormal;
  ${COMMON_HEADER}
  void main() {
    applyHighlight();
    vStage = aStage;
    vMorph = aMorph;
    vec3 transformed = position;
    // 原基期高穹顶（厚纽扣），成熟后压低展平
    transformed.y *= mix(0.45, 1.25, aMorph);
    // 成熟菌盖边缘轻微下卷
    float radial = length(position.xz);
    transformed.y -= (1.0 - aMorph) * 0.18 * radial * radial;
    ${NORMAL_VERTEX_WRITE}
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

export const CAP_FRAGMENT = /* glsl */ `
  precision highp float;
  varying float vStage;
  varying float vMorph;
  varying vec3 vNormal;
  varying float vHighlight;
  ${LIGHTING}
  void main() {
    // 幼蕾奶油白 → 成熟菌盖浅棕褐
    vec3 young = vec3(0.96, 0.90, 0.80);
    vec3 mature = vec3(0.60, 0.43, 0.28);
    vec3 base = mix(young, mature, smoothstep(0.45, 0.95, vStage));
    // 穹顶中心略深
    base *= 0.95 + 0.05 * vMorph;
    gl_FragColor = vec4(shade(normalize(vNormal), base), 1.0);
  }
`;

// ── 菌柄：奶白色，阶段着色 ─────────────────────────────────────────────
export const STEM_VERTEX = /* glsl */ `
  attribute float aStage;
  varying float vStage;
  varying vec3 vNormal;
  ${COMMON_HEADER}
  void main() {
    applyHighlight();
    vStage = aStage;
    ${NORMAL_VERTEX_WRITE}
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

export const STEM_FRAGMENT = /* glsl */ `
  precision highp float;
  varying float vStage;
  varying vec3 vNormal;
  varying float vHighlight;
  ${LIGHTING}
  void main() {
    vec3 base = mix(vec3(0.95, 0.92, 0.86), vec3(0.88, 0.84, 0.76), smoothstep(0.5, 1.0, vStage));
    gl_FragColor = vec4(shade(normalize(vNormal), base), 1.0);
  }
`;
