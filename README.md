# 车灯透镜光型渲染工具

面向汽车灯具造型阶段的前照灯光型确认工具：LED 光源经透镜折射后，在测试墙面上形成等照度光型分布。
基于 **SolidJS + TypeScript + three.js + three-mesh-bvh**。

## 功能模块

| 模块 | 能力 |
| --- | --- |
| 光源布局 | 灯腔内最多 16 颗 LED（4×4 槽位），逐颗调整位置、俯仰/偏航角、亮度，可启停；3D 视口拾取灯珠并显示采样光路 |
| 透镜编辑 | 三档曲率（R140 / R80 / R50 球面）、中心厚度 2–8mm、折射率可调；水密闭合网格，厚度受边缘厚度物理约束时自动抬升下限 |
| 光型投射 | 墙面接收面，对每颗 LED 发射采样光线，经透镜两次 BVH 求交 + Snell 折射后落到墙面累加照度；显示截止线、15° 折线、明暗过渡带、等照度线；截止线可在图上直接拖动 |
| 配置导出 | 光源/透镜/投射参数序列化为带 FNV-1a 校验和的 JSON，支持下载、复制、导入回灌 |

## 光学与渲染管线

```
LED（锥形采样）
  → 第 1 次 BVH raycastFirst（空气→玻璃，Snell 折射）
  → 第 2 次 BVH raycastFirst（玻璃→空气，含全反射判定）
  → 与墙面 z=wallDistance 求交
  → 2×2 双线性 splat 累加到浮点照度缓冲
  → 能量守恒 box 平滑（消除蒙特卡洛颗粒，截止线遮罩之前作用）
  → smoothstep 截止线遮罩（含 15° 折线）
  → 多项式 tonemap + 256 级色图 LUT + Uint32 打包写色
```

### 关键工程决策

- **BVH 求交**：透镜为水密 indexed `BufferGeometry`（凸面 + 平面 + 侧壁，18k 三角面），构建 SAH `MeshBVH`，每光线两次 `raycastFirst`。4096 条光线追踪实测 ~45ms。
- **无条带**：① 落点用 2×2 双线性 splat 而非最近邻；② 照度场先做两遍能量守恒 box 平滑再叠加截止线遮罩，所以光斑连续而截止线依然锐利；③ 遮罩为逐像素解析 smoothstep，不做纹理拉伸。
- **两帧内重算**：`RenderCoordinator` 区分两条路径——光源/透镜/光线数变化才重跑光学追踪；仅截止线/过渡带/色图变化时复用照度缓冲与模糊结果（按源数组身份缓存），只重走图像合成，p95 ≈ 16ms。
- **半透明叠加顺序**：灯腔围壁 `renderOrder=1, depthWrite=false` → LED 不透明正常写深度 → 透镜 `MeshPhysicalMaterial` 透射体 `renderOrder=3, depthWrite=false`，保证灯腔与 LED 透过透镜正确可见。
- **透镜取向**：凸面朝 LED、平面朝墙的准直取向（平凸透镜会聚配置），近轴焦距与薄透镜公式 `f=R/(n−1)` 吻合；大角度边缘光线呈现真实球差。

## 开发

```bash
npm install
npm run dev        # http://127.0.0.1:5180
npm run build      # 类型检查 + 生产构建
npm run test:smoke # Node 无头光学管线冒烟测试（几何水密/追踪/连续性/耗时/能量守恒）
npm run test:e2e   # Playwright 浏览器 E2E（需先起 dev server）
```

## 数据与单位

- 内部长度单位统一为 **mm**；默认测试墙 10m（可调 3–25m），墙面 8m × 4m，累积纹理 768×384。
- 配置自动持久化到 `localStorage`，导出 JSON 带版本号（当前 `version: 1`）与校验和。

## 目录结构

```
src/
  optics/      透镜几何、BVH 光线追踪、墙面渲染器、渲染调度
  three/       灯腔 3D 场景（半透明叠加、拾取、光路预览）
  store/       SolidJS 配置 store、默认值、JSON 导入导出
  panels/      四个模块的 Solid 面板
  components/  通用控件与 3D 视口桥接
tests/         无头冒烟测试 + Playwright E2E
```
