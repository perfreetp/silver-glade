// 冒烟测试:在 Node 中构建 TSL 节点图,验证无 JS 级错误
import { Storage3DTexture, Data3DTexture, RGBAFormat, RedFormat, HalfFloatType, UnsignedByteType } from 'three/webgpu';
import { createSharedUniforms, createNoiseUniforms, buildDensityCompute, buildLightCompute, buildRaymarchColorNode } from '../src/engine/graphs.js';
import { DEFAULT_SETTINGS, cloneSettings } from '../src/defaults.js';

const settings = cloneSettings(DEFAULT_SETTINGS);
const shared = createSharedUniforms(settings);

const N = 8;
const editTex = new Data3DTexture(new Uint16Array(N * N * N), N, N, N);
editTex.format = RedFormat;
editTex.type = HalfFloatType;

const densityTex = new Storage3DTexture(N, N, N);
densityTex.format = RGBAFormat;
densityTex.type = HalfFloatType;

const lightTex = new Storage3DTexture(N, N, N);
lightTex.format = RGBAFormat;
lightTex.type = UnsignedByteType;

const view = {
  resolution: N,
  noiseU: createNoiseUniforms(settings.noise),
  editTex, densityTex, lightTex,
};

const densityCompute = buildDensityCompute(view, shared);
console.log('densityCompute OK, isComputeNode:', !!densityCompute.isComputeNode, 'count:', densityCompute.count);

const lightCompute = buildLightCompute(view, shared);
console.log('lightCompute OK, isComputeNode:', !!lightCompute.isComputeNode);

const colorNode = buildRaymarchColorNode(view, shared);
console.log('raymarch colorNode OK, isNode:', !!colorNode.isNode);

console.log('SMOKE TEST PASSED');
