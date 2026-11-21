# 造雪机雪粒覆盖渲染工具

基于 **three.js + 原生 TypeScript + Web Components** 的雪场造雪可视化工具：在雪道坡面上摆放多台造雪机，
调节每台的雪量三档与风向，实例化雪粒从炮口喷出后按风场飘移、落地堆积为静态积雪，
积雪厚度同时用颜色与坡面高度表现，并带夜间灯光与辉光（Bloom）后期。

## 运行

```bash
npm install
npm run dev        # 开发服务器 http://127.0.0.1:5180
npm run build      # 类型检查 + 生产构建
npm run test:smoke # 仿真内核 Node 冒烟测试（无 WebGL 依赖）
```

真实页面端到端验证（需先 `npm run dev`，使用本机无头 Edge + SwiftShader 软件渲染）：

```bash
node tests/cdp-check.mjs
```

## 四大模块

| # | 模块 | 代码入口 | 能力 |
|---|------|----------|------|
| ① | 造雪机摆放与朝向 | `src/ui/MachinePanel.ts` · `src/three/MachineView.ts` | 双击坡面/按钮摆放、拖拽移动、Yaw/Pitch 调节、列表选中、删除、键盘 Q/E/R/F 微调 |
| ② | 雪量与风向参数 | `src/ui/ParameterPanel.ts` | 小/中/大三档（发射速率+初速）、风向角度与风速滑块、一键应用到全部机器 |
| ③ | 雪粒飘移与坡面堆积 | `src/core/ParticleSystem.ts` · `SnowField.ts` · `TrajectoryPreview.ts` | 固定步长物理、风拖拽+湍流、落地转静态积雪、覆盖率/厚度统计、夜间与风场叠加开关 |
| ④ | 造雪计划导出 | `src/ui/PlanPanel.ts` · `src/core/PlanExporter.ts` | JSON 导出/导入，记录每台机器位置、朝向、雪量档位、风向角度与风速 |

## 关键设计

### 风向三处联动重算

所有模块共享同一份 `MachineConfig`（由 `MachineManager` 持有），`wind:change` 事件触发后：

1. **炮口轨迹** —— `TrajectoryPreview.rebuildOne()` 用与粒子完全相同的物理方程确定性重算弹道虚线与落点圆环；
2. **飘移粒子** —— 每颗粒子通过 `owner` 数组记住所属造雪机，下一个固定步长（1/60s）即按新风场推进；
3. **坡面积雪** —— 粒子在新风场中的新落点调用 `SnowField.deposit()`，堆积位置随之改变。

### 实例化粒子与体积感

- `THREE.InstancedMesh` 单 draw call 渲染 **20,000 粒**，SoA 定长 `Float32Array` + 自由链表回收，零运行时分配；
- 36×54 密度网格每帧统计活跃粒子，按局部密度调制实例尺寸与颜色 —— 高密度簇更白、更大，叠加形成雪雾体积感；
- 主循环固定步长 + 累加器，掉帧时仿真速率不变，最多每帧补 5 步防止螺旋死亡。

### 积雪表现与正确遮挡

- 160×240 的 R 通道浮点 `DataTexture` 存厚度场：顶点着色器沿法线抬升顶点（**高度表现**），
  片元着色器把厚度映射成"裸坡→薄雪蓝灰→厚雪白"色带并带等高刻度（**颜色表现**）；
- CPU 碰撞面 = `terrainHeight(x,z) + sampleDepth(x,z)`，与 GPU 顶点抬升共用同一地形函数（GLSL/TS 双实现，数值一致），
  粒子落在积雪表面而非基岩；粒子材质开启 `depthWrite/depthTest`，雪粒与积雪层按深度缓冲正确互相遮挡；
- 沉积采用渐近饱和模型（上限 `SNOW_GRID.MAX_DEPTH`），粒子落地即销毁转为静态积雪，**不会无限累积**。

### 夜间模式与辉光

太阳/半球光切换为月光冷色低照度，炮口辉光球与雪粒高亮进入 `UnrealBloomPass`；
后期链为 `RenderPass → Bloom → 自定义 ACES ToneMapShader`（线性工作流，避免内置 OutputPass 导致的夜间过曝）。

## 目录结构

```
src/
├── core/            # 与渲染无关的仿真内核（可在 Node 直接单测）
│   ├── constants.ts        # 地形/网格/粒子/风场常量
│   ├── types.ts            # 共享类型
│   ├── EventBus.ts         # 面板与 3D 场景解耦的类型化事件总线
│   ├── MachineManager.ts   # 造雪机数据中心
│   ├── ParticleSystem.ts   # 2 万实例化粒子 + 风场物理 + 密度合成
│   ├── SnowField.ts        # 积雪厚度高度场（DataTexture）
│   ├── TrajectoryPreview.ts# 炮口弹道确定性预览
│   ├── terrainShaders.ts   # 地形/积雪 GLSL（与 CPU 地形函数同源）
│   ├── PlanExporter.ts     # 计划 JSON 导入导出与校验
│   └── mathUtils.ts
├── three/           # three.js 视图层
│   ├── SceneManager.ts     # 渲染管线、交互、昼夜、Bloom、主循环
│   └── MachineView.ts      # 造雪机模型/选中高亮/炮口辉光
├── ui/              # 四个原生 Web Components 面板
├── AppController.ts # 事件总线接线（单向数据流）
└── main.ts
tests/
├── smoke.ts         # 内核冒烟测试（粒子池上限、饱和、遮挡、导出回环）
└── cdp-check.mjs    # 无头浏览器端到端验证（2 万粒子、夜间截图、导出内容）
```

## 验证结论

- 30 台最大档造雪机下活跃粒子稳定打满 **20,000 / 20,000** 且不越池；
- 连续运行后最大积雪厚度收敛在 2.4 m 饱和上限，平均厚度单调不减；
- 无头 Edge（SwiftShader 软件渲染，仅作功能参考）约 10 fps；真机 GPU 下单 draw call 的实例化方案预算满足 60 fps 目标；
- 导出 JSON 含全部约定字段，且风向联动后的最新参数能正确落盘、可回导。
