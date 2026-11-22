// 后处理:双色调色彩映射 + 对比度

import { Effect } from 'postprocessing';
import { Uniform, Vector3 } from 'three';

const fragmentShader = /* glsl */ `
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uAmount;
uniform float uContrast;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 tint = mix(uShadowTint, uHighlightTint, smoothstep(0.05, 0.95, l));
  c = mix(c, c * tint * 1.15, uAmount);
  c = (c - 0.5) * uContrast + 0.5;
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}
`;

export class ColorMappingEffect extends Effect {
  constructor() {
    super('ColorMappingEffect', fragmentShader, {
      uniforms: new Map<string, Uniform>([
        ['uShadowTint', new Uniform(new Vector3(0.72, 0.82, 1.05))],
        ['uHighlightTint', new Uniform(new Vector3(1.08, 1.02, 0.92))],
        ['uAmount', new Uniform(0.35)],
        ['uContrast', new Uniform(1.06)],
      ]),
    });
  }
}
