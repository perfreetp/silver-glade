// 冒烟测试：参数化轮毂生成 + BVH 间隙检测的 headless 逻辑验证
import * as THREE from 'three';
import { buildWheel } from '../src/wheel/wheelGenerator.ts';
import { buildCar, ARCH_LINER_RADIUS } from '../src/wheel/carBuilder.ts';
import { initBVH, measureWheelClearance } from '../src/wheel/clearance.ts';
import {
  DEFAULT_CONFIG,
  PARAM_RANGES,
  STYLE_LIST,
  WHEEL_POSITIONS,
  tireOuterRadius,
} from '../src/constants.ts';
import { WHEEL_IDS } from '../src/types.ts';
import type { WheelConfig } from '../src/types.ts';

let failures = 0;
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    console.log(`  PASS  ${name} ${extra}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name} ${extra}`);
  }
}

console.log('1) 六款式 × 辐条 5-10 参数化生成');
let totalVertices = 0;
for (const style of STYLE_LIST) {
  for (let spokes = PARAM_RANGES.spokes.min; spokes <= PARAM_RANGES.spokes.max; spokes++) {
    const cfg: WheelConfig = { ...DEFAULT_CONFIG, style: style.id, spokes };
    const { group, dispose } = buildWheel(cfg);
    let verts = 0;
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry?.attributes?.position) verts += m.geometry.attributes.position.count;
    });
    totalVertices += verts;
    check(`${style.id} / ${spokes} 辐条`, verts > 100, `(${verts} 顶点)`);
    dispose();
  }
}
console.log(`   累计生成顶点样本: ${totalVertices}`);

console.log('2) 滑杆极值参数不产生 NaN/退化几何');
for (const rim of [PARAM_RANGES.rimDiameter.min, PARAM_RANGES.rimDiameter.max]) {
  for (const dish of [PARAM_RANGES.dishDepth.min, PARAM_RANGES.dishDepth.max]) {
    for (const offset of [PARAM_RANGES.offset.min, PARAM_RANGES.offset.max]) {
      const cfg = { ...DEFAULT_CONFIG, rimDiameter: rim, dishDepth: dish, offset };
      const { group, dispose } = buildWheel(cfg);
      let bad = false;
      group.traverse((o) => {
        const attr = (o as THREE.Mesh).geometry?.attributes?.position;
        if (attr) {
          for (let i = 0; i < attr.count; i++) {
            if (!Number.isFinite(attr.getX(i)) || !Number.isFinite(attr.getY(i)) || !Number.isFinite(attr.getZ(i))) bad = true;
          }
        }
      });
      check(`rim=${rim} dish=${dish} off=${offset}`, !bad);
      dispose();
    }
  }
}

console.log('3) 车身与轮拱 BVH 构建');
const car = buildCar();
initBVH();
const archGeo = car.archMesh.geometry as unknown as { computeBoundsTree: () => void; boundsTree?: unknown };
archGeo.computeBoundsTree();
check('轮拱网格存在 BVH', Boolean(archGeo.boundsTree));
check('四个翼子板警示环就位', WHEEL_IDS.every((id) => Boolean(car.fenderRings[id])));

console.log('4) 默认配置四轮间隙检测');
for (const id of WHEEL_IDS) {
  const cfg = { ...DEFAULT_CONFIG };
  const base = WHEEL_POSITIONS[id];
  const sign = base.z >= 0 ? 1 : -1;
  const center = new THREE.Vector3(base.x, base.y, base.z + sign * cfg.offset);
  const r = measureWheelClearance({
    id,
    archMesh: car.archMesh,
    center,
    tireRadius: tireOuterRadius(cfg.rimDiameter),
  });
  const expected = ARCH_LINER_RADIUS - tireOuterRadius(cfg.rimDiameter);
  check(
    `${id} 最小间隙合理 (~${(expected * 1000).toFixed(1)}mm)`,
    r.min !== null && Math.abs(r.min - expected) < 0.004 && r.rayCount > 30,
    `min=${r.min === null ? 'null' : (r.min * 1000).toFixed(2) + 'mm'} rays=${r.rayCount} status=${r.status}`,
  );
}

console.log('5) 大直径轮辋 → 间隙单调变小');
const bigCfg = { ...DEFAULT_CONFIG, rimDiameter: PARAM_RANGES.rimDiameter.max };
const base = WHEEL_POSITIONS.FL;
const rBig = measureWheelClearance({
  id: 'FL',
  archMesh: car.archMesh,
  center: new THREE.Vector3(base.x, base.y, base.z + bigCfg.offset),
  tireRadius: tireOuterRadius(bigCfg.rimDiameter),
});
check('最大轮辋间隙 < 默认轮辋间隙', rBig.min !== null && rBig.min < ARCH_LINER_RADIUS - tireOuterRadius(DEFAULT_CONFIG.rimDiameter), `min=${rBig.min?.toFixed(4)}`);
check('最大轮辋仍处安全区（径向几何不干涉）', rBig.status === 'ok', `status=${rBig.status}`);

// 极端组合：大轮辋 + 大偏距（轮胎外廓在侧上方贴近封盖）触发干涉
const extremeCfg = {
  ...DEFAULT_CONFIG,
  rimDiameter: PARAM_RANGES.rimDiameter.max,
  offset: PARAM_RANGES.offset.max,
};
const rExtreme = measureWheelClearance({
  id: 'FL',
  archMesh: car.archMesh,
  center: new THREE.Vector3(base.x, base.y, base.z + extremeCfg.offset),
  tireRadius: tireOuterRadius(extremeCfg.rimDiameter),
});
check('极端组合（大轮辋+大偏距）触发 collision', rExtreme.status === 'collision', `status=${rExtreme.status} min=${rExtreme.min?.toFixed(4)}`);

console.log('6) 偏距外移 → 侧面封盖命中 + 越界标志');
const outCfg = { ...DEFAULT_CONFIG, offset: PARAM_RANGES.offset.max };
const rOut = measureWheelClearance({
  id: 'FL',
  archMesh: car.archMesh,
  center: new THREE.Vector3(base.x, base.y, base.z + outCfg.offset),
  tireRadius: tireOuterRadius(outCfg.rimDiameter),
});
check('最大偏距标记越界', rOut.boundaryViolation === true, `status=${rOut.status}`);
check('越界状态为 collision', rOut.status === 'collision');
const inCfg = { ...DEFAULT_CONFIG, offset: PARAM_RANGES.offset.min };
const rIn = measureWheelClearance({
  id: 'FL',
  archMesh: car.archMesh,
  center: new THREE.Vector3(base.x, base.y, base.z + inCfg.offset),
  tireRadius: tireOuterRadius(inCfg.rimDiameter),
});
check('内收偏距不越界', rIn.boundaryViolation === false);
check('内收偏距状态为 ok', rIn.status === 'ok', `status=${rIn.status} min=${rIn.min?.toFixed(4)}`);

car.dispose();

if (failures > 0) {
  console.error(`\n${failures} 项检查失败`);
  process.exit(1);
}
console.log('\n全部冒烟检查通过');
