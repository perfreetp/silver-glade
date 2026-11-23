# Jewel Studio · 珠宝试戴渲染台

基于 **TypeScript + React + three.js `WebGPURenderer`（TSL 节点材质）** 的浏览器端珠宝试戴渲染工具。加载程序化生成的手部与戒指模型，实时调整金属、宝石、光照与佩戴位置，并保存 / 对比 / 导出材质组合。

全部渲染在浏览器内完成，数据只存在本地（`localStorage`），不上传任何内容。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
```

其他命令：

| 命令 | 说明 |
| --- | --- |
| `npm run build` | 生产构建到 `dist/` |
| `npm run preview` | 预览构建结果（:4173） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run assets` | 重新生成 `public/models/` 下的手部与戒指资产 |

> **浏览器要求**：支持 WebGPU 的 Chrome / Edge 113+。不支持时自动回退到 WebGL 2（`WebGPURenderer` 内置 fallback），两条路径都验证过渲染结果一致。

## 功能

### 材质与切工
- **戒托（band）**：黄金 / 白金 / 玫瑰金三种金属预设，粗糙度、金属度可调。金属反射来自程序化「工作室」环境贴图（PMREM），有长条形高光。
- **宝石（gem）**：圆钻 / 祖母绿 / 椭圆三种切工。三种切工的几何体在启动时全部构建并**预编译**，切换时只是切换可见性——不重建几何、不重编译着色器。
- **光学参数**：折射率 IOR（1.3–3.0）与色散强度独立可调，另有透射率与宝石尺寸。
- **色散火彩随视角变化**：见下方「实现说明」。

### 遮挡与前后关系
宝石是真正的**透射材质**（`transmission` + `ior`），取样自不透明视口缓冲。因此：
- 宝石后面的手指会透过宝石被折射看到；
- 手指、戒托挡在宝石前面时会正确遮挡宝石；
- 宝石背面不会「穿过」手指显示。

### 场景
- **三盏可调光源**：主光（带阴影）、补光、轮廓光，强度分别可调。
- 肤色 5 种预设（瓷白 / 白皙 / 自然 / 橄榄 / 深棕），用于对比不同手部效果；皮肤使用 `MeshSSSNodeMaterial` 的次表面散射 + 烘焙顶点 AO。
- 曝光、环境反射强度可调。

### 佩戴
- 沿手指移动、绕手指旋转、倾斜、戒圈尺寸四个滑块。
- 戒指尺寸会根据网格实测的手指截面自动缩放，换手指也贴合。
- 「聚焦戒指」一键回到戒指特写。

### 组合与导出
- 最多保存 **4 套**材质组合，保存时自动捕获当前视角缩略图。
- 「并排对比」视图并排展示所有缩略图与关键参数，可一键载入或删除。
- 导出当前视角 PNG（1600×1600）、导出 / 导入 JSON 材质参数。
- 外观与组合自动保存在 `localStorage`，刷新后恢复。

## 实现说明

### 为什么宝石的「色散」要做两项工作

three.js 的 `MeshPhysicalNodeMaterial` 支持 `dispersion`：在透射 pass 中把 R/G/B 用略有差异的 IOR 折射，物理上正确。但在戒指尺度上，这些彩色边缘只有一两个像素宽，又会被色调映射冲淡，肉眼几乎看不出「火彩」。

因此宝石材质同时：

1. 设置真实的 `dispersionNode`（物理基础）；
2. 叠一个 emissive 项：以**刻面法线 + 视线夹角**作为相位，映射到可见光谱色带，再用「掠射角」作门控（正面平滑、越接近掠射越强）。

两个输入都随相机变化，所以火彩会随视角在刻面上流动——这正是真实钻石火彩的观察方式，也不依赖任何贴图或预烘焙。

```ts
// src/scene/materials.ts
const viewDot = normalView.dot( positionViewDirection ).abs().clamp();
const phase   = normalView.x.mul( 0.62 ).add( normalView.y.mul( 0.48 ) ).add( viewDot.mul( 0.9 ) );
const hue     = fract( phase.add( 0.15 ).mul( u.dispersion.mul( 0.35 ).add( 0.9 ) ) );
const gate    = float( 1 ).sub( viewDot ).clamp().pow( 2.6 );
mat.emissiveNode = spectral( hue ).mul( gate ).mul( u.dispersion.mul( 0.16 ) );
```

### 「一次交互内完成切换」

启动时：

1. 构建三档切工的几何体（`buildGemGeometry`），共享同一个宝石材质；
2. 依次让每档切工可见，调用两次 `renderer.compileAsync(scene, camera)`，把三档的管线都编译好；
3. 切换切工时只写 uniform / 切换 `visible`，不触碰材质和管线。

实测（SwiftShader 之外的本机 Chrome + WebGPU）：**60 fps**，切工切换约 **70 ms**，滑块更新约 **37 ms**。

### 所有可调控件都只写 uniform

材质参数全部以 TSL `uniform()` 承载（`GemUniforms` / `MetalUniforms` / `SkinUniforms`），React 侧只更新这些值。拖动滑块不会触发重新编译。

### 资产管线

`public/models/` 下的模型不来自外部下载，而是由 `scripts/` 里的 Node 脚本程序化生成：

- **手**：用 SDF（圆角盒、锥形胶囊、椭球）雕出放松的右手，`marching cubes` 多边形化 → Taubin 平滑 → 投影回等值面 → 按 SDF 梯度重定向三角形 → 半球 SDF 光线行进烘焙顶点 AO。同时导出戒指座点、指轴与该处实测手指半径。
- **戒指**：扫掠出方形截面戒圈、肩部弧线、四爪与腰围轨道，宝石形式为开放单石镶嵌；宝石几何另有运行时版本，用于切换三种切工。
- 自带一个极小的 glTF `.glb` 写入器（`scripts/lib/glb.ts`），无第三方依赖。

### 目录结构

```
src/
  main.tsx / App.tsx        应用入口与主界面
  components/Controls.tsx   滑块、分段控件、按钮等基础控件
  scene/
    SceneController.ts      渲染器 / 场景 / 相机 / 光照 / 资产装配
    materials.ts            宝石、金属、皮肤材质与 uniform
    gemGeometry.ts          三档切工的运行时几何
    RingGizmo.ts            戒指在手指上的坐标框架
    studio.ts               程序化工作室环境
  state/presets.ts          预设、默认值、JSON 归一化
  state/storage.ts          localStorage 持久化
  export/                   PNG / JSON 导出与导入
scripts/
  make-assets.ts            资产构建入口
  make-hand.ts / make-ring.ts
  lib/                      SDF、marching cubes、GLB 写入
```

## 已知限制

- WebGPU 需要安全上下文（`https://` 或 `localhost`）。局域网 IP 直连会退回 WebGL 2。
- 透射本身是屏幕空间近似，宝石极度贴近皮肤时折射边缘会出现拉伸。
- 手部为程序化生成的示意模型，不是扫描资产；手指姿态是固定的。
