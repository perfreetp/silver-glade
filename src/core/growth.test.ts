/**
 * 生长模型与快照往返的纯逻辑单测（不依赖 WebGL / DOM）。
 */
import { describe, expect, it } from 'vitest';
import {
  advanceStage,
  capMorph,
  computeMorphology,
  FULL_CYCLE_HOURS,
  growthRate,
  humidityFactor,
  MEMBRANE_OPACITY_MAX,
  MEMBRANE_OPACITY_MIN,
  temperatureFactor,
} from './growth';
import { RackSimulation } from './RackSimulation';
import { DEFAULT_RACK } from './rackLayout';
import { base64ToFloat32, float32ToBase64 } from './mathUtils';

describe('环境因子', () => {
  it('温度在最适 18°C 取峰值，两侧对称衰减', () => {
    expect(temperatureFactor(18)).toBeCloseTo(1, 10);
    expect(temperatureFactor(11)).toBeCloseTo(temperatureFactor(25), 6);
    expect(temperatureFactor(29)).toBeLessThan(temperatureFactor(23));
  });

  it('湿度 85% 最适，低湿惩罚强于过湿', () => {
    expect(humidityFactor(85)).toBeCloseTo(1, 10);
    expect(humidityFactor(100)).toBeCloseTo(0.92, 6);
    expect(humidityFactor(20)).toBeLessThan(0.12);
  });

  it('生长速率非负，最适环境下完整周期约为 1', () => {
    const env = { temperature: 18, humidity: 85 };
    expect(growthRate(env)).toBeCloseTo(1 / FULL_CYCLE_HOURS, 12);
    const stage = advanceStage(0, env, FULL_CYCLE_HOURS, 1);
    expect(stage).toBeCloseTo(1, 6);
  });
});

describe('形态曲线', () => {
  it('菌膜透明度严格落在 0.2–0.7 并随阶段单调下降', () => {
    let prev = Infinity;
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const m = computeMorphology(Math.min(1, s));
      expect(m.membraneOpacity).toBeGreaterThanOrEqual(MEMBRANE_OPACITY_MIN - 1e-9);
      expect(m.membraneOpacity).toBeLessThanOrEqual(MEMBRANE_OPACITY_MAX + 1e-9);
      expect(m.membraneOpacity).toBeLessThanOrEqual(prev + 1e-12);
      prev = m.membraneOpacity;
    }
    expect(computeMorphology(0).membraneOpacity).toBeCloseTo(MEMBRANE_OPACITY_MAX, 6);
    expect(computeMorphology(1).membraneOpacity).toBeCloseTo(MEMBRANE_OPACITY_MIN, 6);
  });

  it('菌盖随阶段放大且厚度变薄（展开）', () => {
    const young = computeMorphology(0.45);
    const mature = computeMorphology(1);
    expect(mature.capRadius).toBeGreaterThan(young.capRadius);
    expect(mature.capThickness).toBeLessThan(young.capThickness);
    expect(mature.stemHeight).toBeGreaterThan(young.stemHeight);
  });

  it('穹顶形变在原基期接近 1、成熟期接近 0', () => {
    expect(capMorph(0.4)).toBeGreaterThan(0.9);
    expect(capMorph(1)).toBeCloseTo(0, 6);
  });
});

describe('菇架模拟', () => {
  it('默认菇架不少于 4000 根菌棒且分层连续', () => {
    const sim = new RackSimulation(DEFAULT_RACK, { temperature: 20, humidity: 80 });
    expect(sim.total).toBeGreaterThanOrEqual(4000);
    expect(sim.layout.sticks).toHaveLength(sim.total);
    expect(sim.layout.sticks[0]!.layer).toBe(0);
    expect(sim.layout.sticks[sim.total - 1]!.layer).toBe(DEFAULT_RACK.layers - 1);
  });

  it('环境调节后整架形态立即重算，且阶段不回退', () => {
    const sim = new RackSimulation(DEFAULT_RACK, { temperature: 18, humidity: 85 });
    sim.step(24 * 10);
    const before = sim.stages[0]!;
    sim.setEnvironment({ temperature: 8, humidity: 10 });
    expect(sim.stages[0]).toBe(before);
    expect(sim.morphology[0]).toBe(computeMorphology(before).stage);
  });

  it('快照导出再载入可逐棒还原形态', () => {
    const sim = new RackSimulation(DEFAULT_RACK, { temperature: 23, humidity: 78 }, 4242);
    sim.step(24 * 12);
    const snap = sim.exportSnapshot('2026-11-22T00:00:00.000Z');
    expect(snap.format).toBe('mushroom-rack-growth-snapshot');

    const restored = RackSimulation.fromSnapshot(snap);
    expect(restored.total).toBe(sim.total);
    expect(restored.elapsedHours).toBe(sim.elapsedHours);
    for (let i = 0; i < sim.total; i++) {
      expect(restored.stages[i]).toBeCloseTo(sim.stages[i]!, 8);
      expect(restored.morphology[i * 8 + 3]).toBeCloseTo(sim.morphology[i * 8 + 3]!, 8);
      expect(restored.stickParams[i]!.fruitingSeed).toBe(sim.stickParams[i]!.fruitingSeed);
    }
  });

  it('分层统计覆盖全部菌棒', () => {
    const sim = new RackSimulation(DEFAULT_RACK, { temperature: 20, humidity: 85 });
    const stats = sim.layerStats();
    expect(stats).toHaveLength(DEFAULT_RACK.layers);
    const sum = stats.reduce((acc, s) => acc + s.count, 0);
    expect(sum).toBe(sim.total);
  });
});

describe('base64 往返', () => {
  it('Float32 数组编码解码后位级一致', () => {
    const data = new Float32Array([0.123, -456.789, 0, 1, Math.PI]);
    const back = base64ToFloat32(float32ToBase64(data));
    expect(Array.from(back)).toEqual(Array.from(data));
  });
});
