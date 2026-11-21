# 菇架栽培生长可视化工具

基于 **TypeScript + React 18 + three.js** 的多层菇架菌棒生长实例化渲染器。
温湿度两个环境输入驱动每根菌棒从菌丝萌发到菌盖展开的完整形态变化，支持单架监视、
双批次对比与生长快照导出/还原。

## 运行

```bash
npm install
npm run dev        # 开发服务器（默认 http://127.0.0.1:5173）
npm test           # 11 项纯逻辑单测（生长模型 / 快照往返 / base64 编解码）
npm run build      # 类型检查 + 生产构建
```

## 规模与性能

- 默认菇架 **5 层 × 30 列 × 28 行 = 4200 根菌棒**（≥ 4000 要求）
- 每棒固定 3 个出菇点 → 菌盖/菌柄各 **12600 个实例**，菌棒体/菌膜各 **4200 个实例**
- 全部走 `InstancedMesh`，几何与材质只创建一次；温湿度调节只重写
  `instanceMatrix` 与实例属性缓冲，**视角切换零 GPU 资源重建**

## 功能与需求对照

| 需求 | 实现 |
| --- | --- |
| 温湿度驱动生长 | `core/growth.ts`：温度高斯响应（最适 18°C）× 湿度二次曲线（最适 85%），完整周期 30 天 |
| 8 档温度滑杆 | 8 / 11 / 14 / 17 / 20 / 23 / 26 / 29 °C 离散档位 |
| 参数化菌盖几何 | `three/geometries.ts` LatheGeometry 单位穹顶，每实例 `aMorph` 控制厚度（纽扣→平展）+ 边缘下卷 |
| 菌膜半透明 + 深度排序 | ShaderMaterial `transparent`、每实例透明度 0.2–0.7、`depthWrite:false` + `depthTest:true`、renderOrder=10 进透明队列，附菲涅耳边缘 |
| 俯视/侧视双视角 | `RackRenderer.setView()` 仅做相机 700ms 补间（俯视重设 up 向量避免极轴退化），实例数据原样保留 |
| 环境面板实时重算 | 滑杆 onChange → `sim.setEnvironment()` → `recomputeAll()` 整架形态立即重写 |
| 批次对比 | 两个 `RackCanvas` 并排，逐层平均阶段差，差异最大层 3D 呼吸高亮 + 表格标记，1.5s 自动刷新 |
| 快照导出/载入 | JSON（Float32 以 base64 打包），含逐棒阶段、形态、固定参数、环境、时长；载入后逐棒还原 |
| 视角切换不重建 | `view-switch-no-rebuild` 冒烟断言：切换前后 `instanceMatrix` 引用不变 |

## 架构

```
src/
├─ core/                  与渲染无关的纯逻辑层（可单测）
│  ├─ growth.ts           环境因子、生长积分、阶段→形态曲线、尺寸常量
│  ├─ rackLayout.ts       多层菇架位姿布局（确定性种子）
│  ├─ RackSimulation.ts   逐棒阶段/形态 TypedArray、分层统计、快照导出/载入
│  ├─ mathUtils.ts        clamp/lerp/smoothstep、mulberry32、Float32 base64
│  └─ snapshotIo.ts       快照文件下载/读取/校验
├─ three/                 WebGL 层
│  ├─ geometries.ts       菌盖/菌柄/菌棒/菌膜参数化几何（全程复用）
│  ├─ shaders.ts          四对实例化着色器（覆盖率/阶段/透明度/穹顶形变属性）
│  └─ RackRenderer.ts     主模块：实例渲染器、相机补间、层架、高亮、资源释放
└─ components/
   ├─ RackCanvas.tsx      React 生命周期边界（渲染器只挂载一次）
   ├─ EnvironmentPanel.tsx 温湿度滑杆 + 播放/倍速/快照控制
   └─ CompareLayerPanel.tsx 层位差异表
```

### 生长阶段分段

`stage 0→1`：0–0.4 菌丝萌发（菌棒白化膨胀）→ 0.4–0.6 原基纽扣 →
0.6–0.85 菌柄伸长 → 0.85–1.0 菌盖展平变薄；菌膜透明度同步由 0.7 退到 0.2。

## 快照格式

```jsonc
{
  "format": "mushroom-rack-growth-snapshot",
  "version": 1,
  "rackConfig": { "layers": 5, "columns": 30, "rows": 28 },
  "environment": { "temperature": 20, "humidity": 85 },
  "elapsedHours": 123.4,
  "stickParams": "<base64 Float32，每棒 3 字段：速率抖动/起始相位/出菇种子>",
  "stages": "<base64 Float32，逐棒生长阶段>",
  "morphology": "<base64 Float32，每棒 8 字段形态记录>"
}
```

载入时校验数量与格式，形态数组直接采用快照值，保证逐棒位级还原。

## 冒烟测试（headless WebGL）

`scripts/` 下为 CDP 驱动脚本（仅依赖 Node 内置 WebSocket/fetch），
配合 `public/smoke.html` 在 SwiftShader 软件 GL 下验证：
4200 实例创建、生长推进、视角切换不重建、快照往返、WebGL 上下文存活、零控制台错误。
