# 菌包菌丝蔓延生长可视化工具

把食用菌菌包横截面离散成大规模格点，在截面上布置接种点后，菌丝按扩散-反应规则从接种点向外推进，
用半透明分层渲染浓度分布，支持参数调节、接种点编辑、时间回放与生长记录导出。

技术栈：**原生 TypeScript + Web Components + three.js（WebGPURenderer，自动回退 WebGL）+ Web Worker 并行 + SharedArrayBuffer**。

## 功能与需求对照

| 需求 | 实现 |
| --- | --- |
| 主模块：菌丝扩散渲染器 | `src/renderer/MyceliumRenderer.ts`，正视正交相机 + 可缩放/平移 |
| 横截面离散成格点、每格存菌丝浓度 | `src/sim/geometry.ts` 构建 N×N 环形基质域，`Float32Array` 浓度场（支持 512~2048，最高 419 万格） |
| 接种点向外扩散推进 | `src/sim/kernel.ts` 显式 5 点格式扩散 + 逻辑斯蒂生长项 |
| 半透明层叠加、随浓度加深 | 浓度量化 5 级，每级一张 alpha 蒙版层，`NormalBlending` + `depthWrite=false` + `renderOrder` 保证正确叠加 |
| 温度（+湿度）改变扩散速度 | Q10 温度系数（最适 23℃，>30℃ 高温胁迫）+ 湿度抑制因子，见 `environmentFactor` |
| 边缘 vs 中心气孔不同行为 | 外缘零通量反射（菌丝堆积）；中心气孔吸收边界（菌丝到此消亡、孔内恒 0） |
| 浓度分布视图 + 时间回放 | 回放条支持播放/暂停/步进/循环/变速，滑杆可跳到任意帧 |
| 培养参数面板 | 温度、湿度、格点规模、气孔占比、步数、快照间隔、步长 |
| 接种点增删并重算整段 | 视图左键点击新增、列表删除/随机/清空，任意变更触发全量重算 |
| 生长记录导出 | JSON（可重新导入）、CSV 稀疏浓度矩阵、PNG 灰度图序列 |
| 大规模格点 + 多任务并行 | 水平行带切分给多个 worker，SharedArrayBuffer 双缓冲零拷贝；无跨源隔离时降级单线程 |
| 浓度分 5 级 | `LEVEL_THRESHOLDS` 5 级 + 0 级无菌丝，图例与渲染共用配色 |

## 快速开始

```bash
npm install
npm run dev        # 开发服务器（自动带 COOP/COEP 跨源隔离头）
```

打开终端提示的地址。生产构建：

```bash
npm run build
npm run preview
```

> SharedArrayBuffer 多 worker 并行要求跨源隔离（COOP `same-origin` + COEP `require-corp`），
> 已在 `vite.config.ts` 中为 dev/preview 配置响应头。浏览器不支持时工具自动降级为单线程模式，功能不受影响。

## URL 参数

可通过查询参数直接指定模拟配置（便于分享/测试）：

```
?gridSize=1024&totalSteps=800&snapshotEvery=10&temperature=25&humidity=90&holeRatio=0.16
```

## 操作说明

- **新增接种点**：在截面基质区域（棕色环内）左键点击；点到外缘外或中心气孔内会被拒绝。
- **平移/缩放**：右键拖动平移，滚轮缩放，中键缩放。
- **回放**：底部滑杆拖拽可跳到任意时刻；支持 0.5×~4× 变速与循环播放。
- **重算**：修改培养参数后点击「应用参数并重算整段蔓延」；接种点增删会自动重算。

## 架构

```
src/
  sim/
    types.ts            共享类型、5 级阈值/配色、温湿度因子
    geometry.ts         环形基质域离散（基质/气孔/外部三类格点）
    kernel.ts           扩散-反应内核（边界差异、接种布源、量化）
    codec.ts            浓度场 RLE 压缩（大规模快照内存可控）
    diffusion-worker.ts 行带并行 worker（SAB 双缓冲）
    engine.ts           调度引擎：worker 池、双缓冲步进、快照、降级
  renderer/
    MyceliumRenderer.ts WebGPU/WebGL 渲染器、5 级半透明层、拾取、回退
  components/           6 个原生 Web Component（视图/回放/参数/接种/导出/状态）
  state/store.ts        轻量响应式状态容器
  main.ts               应用编排与模拟生命周期
test/
  smoke.mjs             Playwright 端到端冒烟（并行、回放、增删、导出、像素）
  extra-checks.mjs      温度效应/气孔吸收/CSV/1024² 性能
```

### 数值模型

- 扩散：`c' = c + D·∇²c + G·c·(1−c/csat) − sink`，显式格式，`D` 裁剪到稳定域 ≤0.24。
- 外缘 `Outside` 邻格：零通量，跳过该方向通量 → 菌丝在袋壁内侧堆积。
- 气孔 `Hole` 邻格：按 `holeAbsorption` 比例流失，气孔格每步清零。
- 快照：Float32 场量化为 Uint8（0~255）后 RLE 压缩，兼顾回放精度与内存。

## 测试

```bash
npm run typecheck     # 应用与测试两套 tsconfig 严格类型检查
npm run test:kernel   # Node 内核对：几何/RLE/扩散/边界/温湿度/分级/2048² 大规模
npm run test:smoke    # 需先启动 dev server；Playwright 浏览器端到端
```

内核测试覆盖：环形域格点计数、RLE 往返与长游程拆分、扩散向外推进、外缘零通量、
气孔恒零、温湿度单调性、5 级分级边界、2048²（约 419 万格）场分配与推进。
