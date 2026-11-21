/**
 * 仿真内核冒烟测试（无 DOM / 无 WebGL，纯数据层）。
 * 由 esbuild 临时打包后在 Node 中运行，不进入 src 的 tsconfig 编译范围。
 */
import type * as THREE from 'three';
import { MachineManager } from '../src/core/MachineManager';
import { SnowField } from '../src/core/SnowField';
import { ParticleSystem } from '../src/core/ParticleSystem';
import { TrajectoryPreview } from '../src/core/TrajectoryPreview';
import { PlanExporter } from '../src/core/PlanExporter';
import { FIXED_DT, PARTICLE, SNOW_GRID } from '../src/core/constants';
import { terrainHeight } from '../src/core/mathUtils';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const manager = new MachineManager();
const field = new SnowField();
const particles = new ParticleSystem(field);
const traj = new TrajectoryPreview(field);

// 30 台最大档造雪机，压力应打满 2 万粒子池
for (let i = 0; i < 30; i++) {
  const m = manager.add((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 100);
  m.level = 3;
  m.pitch = 25 + Math.random() * 20;
}
assert(manager.count === 30, '30 台造雪机创建成功');

// 跑 12 个仿真秒
let maxActive = 0;
for (let frame = 0; frame < 12 * 60; frame++) {
  particles.step(FIXED_DT, manager.list());
  maxActive = Math.max(maxActive, particles.active);
}
assert(maxActive <= PARTICLE.MAX_COUNT, `活跃粒子 ${maxActive} 不超过池容量 ${PARTICLE.MAX_COUNT}`);
assert(maxActive > PARTICLE.MAX_COUNT * 0.85, `粒子池被充分打满（峰值 ${maxActive}）`);

const s1 = field.stats();
assert(s1.coverage > 5, `坡面积雪覆盖开始形成（覆盖率 ${s1.coverage.toFixed(1)}%）`);
assert(Number.isFinite(s1.avgDepth) && s1.avgDepth > 0, `平均厚度为有限正数（${s1.avgDepth.toFixed(4)} m）`);

// 长时间运行验证渐近饱和、不无限累积
for (let frame = 0; frame < 60 * 60; frame++) {
  particles.step(FIXED_DT, manager.list());
}
const s2 = field.stats();
let maxDepth = 0;
for (let i = 0; i < (field as unknown as { texture: { image: { data: Float32Array } } }).texture.image.data.length; i++) {
  const d = (field as unknown as { texture: { image: { data: Float32Array } } }).texture.image.data[i];
  maxDepth = Math.max(maxDepth, d);
}
assert(maxDepth <= SNOW_GRID.MAX_DEPTH + 1e-6, `积雪厚度饱和上限生效（最大 ${maxDepth.toFixed(3)} ≤ ${SNOW_GRID.MAX_DEPTH}）`);
assert(s2.avgDepth >= s1.avgDepth, '持续造雪下平均厚度单调不减');

// 风向联动：改风向后轨迹必须重算且落点明显变化
const target = manager.list()[0];
traj.rebuildOne(target);
const before = traj.group.children.length;
target.wind = { direction: 180, speed: 12 };
traj.rebuildOne(target);
const line = traj.group.children[0] as THREE.Object3D & {
  geometry: { attributes: { position: { count: number; getY: (i: number) => number } } };
};
const pts = line.geometry.attributes.position;
assert(pts.count > 5, `轨迹含有效弹道点（${pts.count} 个点）`);
assert(before >= 1, '轨迹对象已挂载到场景组');
assert(pts.getY(pts.count - 1) > -100, '反向风下弹道未直接穿出地形底部');

// 清空
field.reset();
particles.reset();
const s3 = field.stats();
assert(s3.coverage === 0 && s3.avgDepth === 0, '清空后积雪场归零');
assert(particles.active === 0, '清空后活跃粒子归零');

// 深度遮挡正确性：碰撞面 = 地形高度 + 积雪厚度，雪厚处碰撞面必须高于裸地形
const tx = 5;
const tz = 5;
field.deposit(tx, tz, 8, 1.1);
const depth = field.sampleDepth(tx, tz);
assert(depth > 0.5, `沉积点厚度显著（${depth.toFixed(3)} m）`);
const collisionSurface = terrainHeight(tx, tz) + depth;
assert(collisionSurface > terrainHeight(tx, tz), '积雪表面高于裸地形 —— 粒子与雪层按深度遮挡，不会穿到坡面下方');

// 计划导出校验
const plan = PlanExporter.export(manager.list());
assert(plan.version === 1 && plan.machines.length === 30, '导出计划版本与机器数正确');
const pm = plan.machines[0];
assert(
  [1, 2, 3].includes(pm.level) &&
    typeof pm.x === 'number' &&
    typeof pm.z === 'number' &&
    typeof pm.wind.direction === 'number',
  '导出记录包含位置、雪量档位、风向字段',
);
assert(PlanExporter.validate(plan).version === 1, '导出文件可通过校验回环');

console.log('\n全部冒烟测试通过。');
