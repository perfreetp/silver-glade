// 后处理:基于深度的指数高度雾(体积雾近似)

import { Effect, EffectAttribute } from 'postprocessing';
import { Matrix4, Uniform, Vector3 } from 'three';

const fragmentShader = /* glsl */ `
uniform mat4 uInvViewProj;
uniform vec3 uCameraPos;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uHeightFalloff;
uniform float uStrength;

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 wp4 = uInvViewProj * clip;
  vec3 wp = wp4.xyz / max(abs(wp4.w), 1e-5) * sign(wp4.w);
  float dist = length(wp - uCameraPos);
  float hf = exp(-max(wp.y, 0.0) * uHeightFalloff);
  float f = 1.0 - exp(-uFogDensity * hf * dist);
  vec3 c = mix(inputColor.rgb, uFogColor, clamp(f, 0.0, 1.0) * uStrength);
  outputColor = vec4(c, inputColor.a);
}
`;

export class VolumetricFogEffect extends Effect {
  constructor() {
    super('VolumetricFogEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['uInvViewProj', new Uniform(new Matrix4())],
        ['uCameraPos', new Uniform(new Vector3())],
        ['uFogColor', new Uniform(new Vector3(0.62, 0.68, 0.76))],
        ['uFogDensity', new Uniform(0.016)],
        ['uHeightFalloff', new Uniform(0.22)],
        ['uStrength', new Uniform(0.9)],
      ]),
    });
  }

  updateCamera(cameraPos: Vector3, invViewProj: Matrix4): void {
    (this.uniforms.get('uCameraPos')!.value as Vector3).copy(cameraPos);
    (this.uniforms.get('uInvViewProj')!.value as Matrix4).copy(invViewProj);
  }
}
