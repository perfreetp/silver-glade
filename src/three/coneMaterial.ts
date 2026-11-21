import * as THREE from 'three';

/**
 * 雾锥材质：加色混合使多锥叠加区域亮度自然累加（配合 Bloom 后处理），
 * 边缘菲涅尔增亮 + 沿轴向由喷口向地面衰减 + 轻微流动闪烁。
 * 几何为单位锥（顶点在原点、开口朝 -Y、高 1、底半径 1），由 mesh 缩放定向。
 */
export function makeConeMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: color.clone() },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying float vAxial;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vAxial = -position.y; // 0 = 喷口, 1 = 锥底
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      varying float vAxial;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.4);
        float fade = 1.0 - vAxial;
        float shimmer = 0.92 + 0.08 * sin(uTime * 3.0 + vAxial * 14.0);
        float a = (0.06 * fade + 0.30 * rim * fade + 0.05 * rim) * shimmer;
        gl_FragColor = vec4(uColor * (0.55 + 0.85 * rim), a);
      }
    `,
  });
}
