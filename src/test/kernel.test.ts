/**
 * 模拟内核数值测试（Node 环境，无浏览器依赖）。
 * 运行：vite build 打包后由 node --test 风格断言执行。
 */
import { buildDomain } from '../sim/geometry';
import { stepDiffusion, seedInoculation, type KernelParams } from '../sim/kernel';
import { encodeRLE, decodeRLE } from '../sim/codec';
import { CellType, CONCENTRATION_MAX, environmentFactor, levelOf } from '../sim/types';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}

const baseParams: KernelParams = {
  size: 0,
  envFactor: 1,
  baseDiffusivity: 0.12,
  growthRate: 0.016,
  holeAbsorption: 0.28,
  saturation: CONCENTRATION_MAX,
};

// 1. 几何：环形域类型计数
{
  const N = 128;
  const geo = buildDomain(N, 0.16);
  let nSub = 0;
  let nHole = 0;
  let nOut = 0;
  for (const t of geo.cellType) {
    if (t === CellType.Substrate) nSub++;
    else if (t === CellType.Hole) nHole++;
    else nOut++;
  }
  console.log('几何域测试');
  assert(nSub + nHole + nOut === N * N, '格点类型全覆盖无遗漏');
  assert(nHole > 0 && nOut > 0 && nSub > nHole, '存在基质/气孔/外部三类格点');
  const expectedHole = Math.PI * geo.holeRadius ** 2;
  assert(Math.abs(nHole - expectedHole) / expectedHole < 0.05, '气孔格点数与圆面积近似一致');
}

// 2. RLE 往返
{
  console.log('RLE 编解码测试');
  const src = Uint8Array.from([0, 0, 0, 5, 5, 255, 1, 1, 1, 1, 0]);
  const enc = encodeRLE(src);
  const dec = new Uint8Array(src.length);
  decodeRLE(enc, dec);
  assert(enc.length < src.length * 2, '编码体积合理');
  let same = true;
  for (let i = 0; i < src.length; i++) if (src[i] !== dec[i]) same = false;
  assert(same, '解码与原始数据逐字节一致');

  // 长游程（>255）拆分
  const big = new Uint8Array(600).fill(7);
  const dec2 = new Uint8Array(600);
  decodeRLE(encodeRLE(big), dec2);
  assert(dec2.every((v) => v === 7), '超过 255 的同值游程正确拆分');
}

// 3. 扩散：接种点向外推进 + 质量守恒趋势
{
  console.log('扩散推进测试');
  const N = 96;
  const geo = buildDomain(N, 0.16);
  const params = { ...baseParams, size: N };
  const cur = new Float32Array(N * N);
  const nxt = new Float32Array(N * N);
  const center = (N - 1) / 2;
  // 接种点放在环内基质中部（避开中心气孔）
  const midR = (geo.outerRadius + geo.holeRadius) / 2;
  const seedPt = { x: center, y: center - midR };
  seedInoculation(cur, geo.cellType, N, [seedPt], 4, 200);
  const seeded = cur.reduce((s, v) => s + v, 0);
  assert(seeded > 0, '接种点布源成功');

  let reached = 0;
  let a = cur;
  let b = nxt;
  for (let step = 0; step < 200; step++) {
    stepDiffusion(a, b, geo.cellType, params, 0, N);
    // 交换双缓冲
    const tmp = a;
    a = b;
    b = tmp;
    if (step === 99) {
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) if (a[y * N + x]! > 1) reached++;
    }
  }
  const finalField = a;
  assert(reached > 40, '100 步后菌丝占据格点显著多于初始接种盘');

  // 边缘零通量：圆外始终为 0
  let outsideLeak = 0;
  for (let i = 0; i < N * N; i++) {
    if (geo.cellType[i] === CellType.Outside && finalField[i]! !== 0) outsideLeak++;
  }
  assert(outsideLeak === 0, '菌包外缘外部始终无浓度（零通量反射）');

  // 气孔吸收：孔内始终为 0
  let holeLeak = 0;
  for (let i = 0; i < N * N; i++) {
    if (geo.cellType[i] === CellType.Hole && finalField[i]! !== 0) holeLeak++;
  }
  assert(holeLeak === 0, '中心气孔内浓度恒为 0（吸收边界）');
}

// 4. 温度/湿度因子单调性
{
  console.log('环境因子测试');
  const f10 = environmentFactor(10, 85);
  const f23 = environmentFactor(23, 85);
  const f30 = environmentFactor(30, 85);
  const f36 = environmentFactor(36, 85);
  assert(f23 > f10, '23℃ 扩散快于 10℃');
  assert(f30 >= f23, '30℃ 不低于最适温区');
  assert(f36 < f30, '36℃ 高温胁迫抑制生长');
  const dry = environmentFactor(23, 40);
  const wet = environmentFactor(23, 95);
  assert(wet > dry, '高湿扩散快于低湿');
}

// 5. 五级分级边界
{
  console.log('浓度分级测试');
  assert(levelOf(0) === 0, '0 浓度为无菌丝');
  assert(levelOf(1) === 1, '浓度 1 归 1 级');
  assert(levelOf(80) === 2, '浓度 80 归 2 级');
  assert(levelOf(150) === 3, '浓度 150 归 3 级');
  assert(levelOf(200) === 4, '浓度 200 归 4 级');
  assert(levelOf(240) === 5, '浓度 240 归 5 级');
  assert(levelOf(255) === 5, '浓度 255 归 5 级');
}

if (failures > 0) {
  console.error(`\n${failures} 项断言失败`);
  process.exit(1);
} else {
  console.log('\n全部内核测试通过');
}

// 6. 大规模格点冒烟：2048²（约 419 万格）双缓冲 + 类型 + 快照区可分配、可推进
{
  console.log('大规模格点测试（2048²）');
  const N = 2048;
  const t0 = performance.now();
  const geo = buildDomain(N, 0.16);
  const fieldBytes = N * N * 4;
  const buf = new ArrayBuffer(fieldBytes * 2 + N * N * 2);
  const a = new Float32Array(buf, 0, N * N);
  const b = new Float32Array(buf, fieldBytes, N * N);
  const cellType = new Uint8Array(buf, fieldBytes * 2, N * N);
  cellType.set(geo.cellType);
  const allocMs = performance.now() - t0;
  const params = { ...baseParams, size: N };
  seedInoculation(a, cellType, N, [{ x: N / 2, y: N / 4 }], 12, 200);
  const t1 = performance.now();
  for (let s = 0; s < 3; s++) {
    stepDiffusion(a, b, cellType, params, 0, N);
    const t = a;
    a.set(b);
    void t;
  }
  const stepMs = (performance.now() - t1) / 3;
  let nonzero = 0;
  for (let i = 0; i < a.length; i += 997) if (a[i]! > 0) nonzero++;
  console.log(`  分配 ${(buf.byteLength / 1048576).toFixed(1)} MiB 用时 ${allocMs.toFixed(1)} ms，单步均值 ${stepMs.toFixed(1)} ms`);
  if (nonzero === 0) {
    failures++;
    console.error('  ✗ 大规模场推进后无有效浓度');
    process.exit(1);
  } else {
    console.log('  ✓ 2048² 场分配与扩散推进正常');
  }
}
