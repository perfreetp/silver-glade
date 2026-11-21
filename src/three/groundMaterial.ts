import * as THREE from 'three';
import { ROOM } from '../core/config';

/**
 * 地面材质：采样累积湿度纹理 → 热区色带；
 * 超过阈值显示脉冲饱和标记；遮挡掩码区域显示为灰色。
 */
export function makeGroundMaterial(
  humTex: THREE.DataTexture,
  occTex: THREE.DataTexture,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHum: { value: humTex },
      uOcc: { value: occTex },
      uThreshold: { value: 1.0 },
      uShowOcc: { value: 1.0 },
      uTime: { value: 0 },
      uMax: { value: 2.5 },
      uMin: { value: new THREE.Vector2(-ROOM.width / 2, -ROOM.depth / 2) },
      uSize: { value: new THREE.Vector2(ROOM.width, ROOM.depth) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uHum;
      uniform sampler2D uOcc;
      uniform float uThreshold;
      uniform float uShowOcc;
      uniform float uTime;
      uniform float uMax;
      uniform vec2 uMin;
      uniform vec2 uSize;
      varying vec3 vW;

      vec3 heat(float t) {
        vec3 c1 = vec3(0.05, 0.10, 0.35);
        vec3 c2 = vec3(0.00, 0.65, 0.75);
        vec3 c3 = vec3(0.15, 0.85, 0.35);
        vec3 c4 = vec3(1.00, 0.85, 0.15);
        vec3 c5 = vec3(0.95, 0.15, 0.10);
        vec3 c = mix(c1, c2, smoothstep(0.00, 0.28, t));
        c = mix(c, c3, smoothstep(0.28, 0.50, t));
        c = mix(c, c4, smoothstep(0.50, 0.75, t));
        c = mix(c, c5, smoothstep(0.75, 1.00, t));
        return c;
      }

      void main() {
        vec2 uv = (vW.xz - uMin) / uSize;
        float h = texture2D(uHum, uv).r;
        float occ = texture2D(uOcc, uv).r;
        float t = clamp(h / uMax, 0.0, 1.0);

        // 底色 + 淡网格
        vec3 base = vec3(0.10, 0.11, 0.13);
        vec2 g = abs(fract(vW.xz) - 0.5);
        float line = smoothstep(0.48, 0.5, max(g.x, g.y));
        base += line * 0.03;

        vec3 col = mix(base, heat(t), smoothstep(0.005, 0.06, t));

        // 饱和标记：超过阈值 → 红色脉冲 + 圆点纹理
        if (h > uThreshold) {
          float pulse = 0.5 + 0.5 * sin(uTime * 5.0);
          vec2 dp = fract(uv * vec2(88.0, 56.0)) - 0.5;
          float mk = step(length(dp), 0.16);
          col = mix(col, vec3(1.0, 0.25, 0.25), 0.55 + 0.35 * pulse);
          col += mk * vec3(0.3) * pulse;
        }

        // 遮挡区域变灰
        if (uShowOcc > 0.5 && occ > 0.5) {
          col = mix(col, vec3(0.42, 0.43, 0.46), 0.8);
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
