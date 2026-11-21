/**
 * 菇架模拟状态：
 * 持有全部菌棒的固定参数与逐棒生长阶段，环境输入变化时按生长曲线重算形态。
 * 与渲染完全解耦 — 渲染器每帧只读这里的 TypedArray。
 */
import type {
  EnvironmentInput,
  GrowthSnapshot,
  LayerStat,
  RackConfig,
  StickMorphology,
  StickParams,
} from '../types';
import { advanceStage, computeMorphology, FULL_CYCLE_HOURS } from './growth';
import { buildRackLayout, layerIndexRange, type RackLayout } from './rackLayout';
import { base64ToFloat32, float32ToBase64, mulberry32 } from './mathUtils';

/** 每条形态记录写入 Float32Array 的字段数（与 StickMorphology 对应） */
export const MORPH_FIELDS = 8;

export class RackSimulation {
  readonly layout: RackLayout;
  readonly config: RackConfig;
  readonly total: number;

  /** 固定个体参数 */
  readonly stickParams: StickParams[];
  /** 逐棒当前生长阶段 0–1 */
  readonly stages: Float32Array;
  /** 逐棒当前形态（结构数组，MORPH_FIELDS 条/棒） */
  readonly morphology: Float32Array;

  environment: EnvironmentInput;
  elapsedHours = 0;

  constructor(config: RackConfig, environment: EnvironmentInput, seed = 20260601) {
    this.config = config;
    this.layout = buildRackLayout(config, seed);
    this.total = this.layout.total;
    this.environment = { ...environment };
    this.stickParams = new Array(this.total);
    this.stages = new Float32Array(this.total);
    this.morphology = new Float32Array(this.total * MORPH_FIELDS);

    const rng = mulberry32(seed ^ 0x9e3779b9);
    for (let i = 0; i < this.total; i++) {
      this.stickParams[i] = {
        rateJitter: 0.85 + rng() * 0.3,
        startOffset: rng() * 0.04,
        // 限制在 2^24 内：快照以 Float32 打包，超出会丢整数精度导致无法逐棒还原
        fruitingSeed: Math.floor(rng() * 0x1000000) >>> 0,
      };
      this.stages[i] = this.stickParams[i]!.startOffset;
    }
    this.recomputeAll();
  }

  /** 时间推进（小时），逐棒积分生长阶段 */
  step(dtHours: number): void {
    if (dtHours <= 0) return;
    this.elapsedHours += dtHours;
    for (let i = 0; i < this.total; i++) {
      const p = this.stickParams[i]!;
      this.stages[i] = advanceStage(this.stages[i]!, this.environment, dtHours, p.rateJitter);
    }
    this.recomputeAll();
  }

  /**
   * 环境实时调节：不改变已积累的阶段（生长不可逆），
   * 只按当前阶段 + 生长曲线立即重算整架形态。
   */
  setEnvironment(env: EnvironmentInput): void {
    this.environment = { ...env };
    this.recomputeAll();
  }

  /** 整架按生长曲线重算形态（温湿度滑杆拖动时调用） */
  recomputeAll(): void {
    for (let i = 0; i < this.total; i++) {
      this.writeMorphology(i, computeMorphology(this.stages[i]!));
    }
  }

  getMorphology(index: number): StickMorphology {
    const o = index * MORPH_FIELDS;
    return {
      stage: this.morphology[o]!,
      coverage: this.morphology[o + 1]!,
      fruiting: this.morphology[o + 2]!,
      capRadius: this.morphology[o + 3]!,
      capThickness: this.morphology[o + 4]!,
      stemHeight: this.morphology[o + 5]!,
      membraneOpacity: this.morphology[o + 6]!,
    } as StickMorphology;
  }

  /** 分层统计（对比视图用） */
  layerStats(): LayerStat[] {
    const stats: LayerStat[] = [];
    for (let l = 0; l < this.config.layers; l++) {
      const [from, to] = layerIndexRange(this.config, l);
      let sumStage = 0;
      let sumCap = 0;
      for (let i = from; i < to; i++) {
        sumStage += this.stages[i]!;
        sumCap += this.morphology[i * MORPH_FIELDS + 3]!;
      }
      const count = to - from;
      stats.push({
        layer: l,
        avgStage: sumStage / count,
        avgCapRadius: sumCap / count,
        count,
      });
    }
    return stats;
  }

  private writeMorphology(index: number, m: StickMorphology): void {
    const o = index * MORPH_FIELDS;
    this.morphology[o] = m.stage;
    this.morphology[o + 1] = m.coverage;
    this.morphology[o + 2] = m.fruiting;
    this.morphology[o + 3] = m.capRadius;
    this.morphology[o + 4] = m.capThickness;
    this.morphology[o + 5] = m.stemHeight;
    this.morphology[o + 6] = m.membraneOpacity;
    this.morphology[o + 7] = 0; // 预留：对比高亮标记位
  }

  // ── 快照导出 / 载入（导出内容可再次载入还原形态）────────────────────

  exportSnapshot(exportedAt: string): GrowthSnapshot {
    const params = new Float32Array(this.total * 3);
    for (let i = 0; i < this.total; i++) {
      const p = this.stickParams[i]!;
      params[i * 3] = p.rateJitter;
      params[i * 3 + 1] = p.startOffset;
      params[i * 3 + 2] = p.fruitingSeed;
    }
    return {
      format: 'mushroom-rack-growth-snapshot',
      version: 1,
      exportedAt,
      rackConfig: { ...this.config },
      environment: { ...this.environment },
      elapsedHours: this.elapsedHours,
      stickParams: float32ToBase64(params),
      stages: float32ToBase64(this.stages),
      morphology: float32ToBase64(this.morphology),
    };
  }

  /** 从快照还原：优先采用快照内的形态数组，保证逐棒形态完全一致 */
  static fromSnapshot(snap: GrowthSnapshot): RackSimulation {
    const sim = new RackSimulation(snap.rackConfig, snap.environment);
    const params = base64ToFloat32(snap.stickParams);
    const stages = base64ToFloat32(snap.stages);
    const morph = base64ToFloat32(snap.morphology);

    if (params.length !== sim.total * 3) throw new Error('快照菌棒参数数量与菇架配置不匹配');
    if (stages.length !== sim.total) throw new Error('快照生长阶段数量与菇架配置不匹配');
    if (morph.length !== sim.total * MORPH_FIELDS) throw new Error('快照形态数据数量与菇架配置不匹配');

    for (let i = 0; i < sim.total; i++) {
      sim.stickParams[i] = {
        rateJitter: params[i * 3]!,
        startOffset: params[i * 3 + 1]!,
        fruitingSeed: params[i * 3 + 2]!,
      };
      sim.stages[i] = stages[i]!;
    }
    sim.morphology.set(morph);
    sim.elapsedHours = snap.elapsedHours;
    return sim;
  }

  /** 当前环境下，从空白长到现状所需的等效小时数（信息展示用） */
  equivalentProgressHours(): number {
    return this.elapsedHours || FULL_CYCLE_HOURS * this.meanStage();
  }

  meanStage(): number {
    let s = 0;
    for (let i = 0; i < this.total; i++) s += this.stages[i]!;
    return s / this.total;
  }
}
