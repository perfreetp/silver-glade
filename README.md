# 压雪刀纹渲染工作台（Corduroy Groom Planner）

面向滑雪场压雪班组的雪道压雪刀纹（corduroy）渲染与作业规划工具。基于 **three.js + three-mesh-bvh + React + TypeScript**，
在浏览器中完成雪道分区、压雪路径绘制、刀纹实时预览、碰撞体局部刷新、测距标注与任务导出复压。

## 运行

```bash
npm install
npm run dev        # 开发服务器（默认 http://127.0.0.1:5190）
npm run build      # 生产构建
npm run typecheck  # 类型检查
npm test           # 单元测试 + 无头 Chrome 端到端测试（需本机 Chrome）
```

## 四个作业模块（左侧面板按流程纵向排布）

1. **雪道底图 · 分区选择** —— 雪面按 6×6 分区（每区 40 m，全场 240 m），网格按分区裁剪作业范围；未启用分区不允许落路径。
2. **路径绘制 · 刀头参数** —— 雪面射线拾取绘制 Catmull-Rom 平滑路径；刀头角度三档（浅 12°/中 22°/深 32°）、
   雪质干湿两档（干雪/湿雪）、作业速度可调；同面板切换测距与标注工具。
3. **刀纹预览 · 残雪堆积** —— 压雪机沿路径推进实时生成沟纹，图层开关（刀纹层/雾层/线框）、作业进度、
   测距结果、贴地标注管理与性能/BVH 状态。
4. **任务导出 · 次日复压** —— 导出 JSON（路径控制点 + 刀头档位 + 雪质档位 + 速度 + 标注测距），可重新导入复压。

## 核心实现

| 需求 | 实现位置 | 做法 |
| --- | --- | --- |
| 雪面网格按分区加载/裁剪 | `three/GroomEngine.ts`、`three/groomDeform.ts` | 规则网格顶点经世界坐标映射到分区，`markSample` 跳过未启用分区 |
| 刀头压过的沟纹 | `three/groomDeform.ts` | 顶点位移 = 沟底下压 + 横向棱纹起伏 + 边缘碎雪隆起 |
| 刀头三档 / 雪质两档 | `three/constants.ts` | 每档固化刀宽、沟深、棱距、碎雪系数、棱纹锐度、堆积保持率 |
| 法线贴图叠加顶点位移 | `three/normalMap.ts`、`three/terrainMaterial.ts` | 程序化 Canvas 法线贴图只在 `aGroomed` 区域经 TBN 基变换叠加 |
| 拐弯沟纹沿行进方向旋转且连续 | `three/path.ts`、`GroomEngine.stampGroomed` | 路径按弧长等距重采样，UV 与棱纹相位都以**弧长 s** 为基准，行进方向逐样本中心差分旋转 |
| BVH 加速碰撞体局部刷新 | `GroomEngine.flushDeformation` | 脏三角形入队，节流调用 `boundsTree.refit(triangleSet)`，射线拾取/测距/标注均走 BVH |
| 60 帧雪面重算 | `three/constants.ts`、`groomDeform.flushBudget` | 每帧顶点预算 `VERTEX_BUDGET_PER_FRAME`（4200），脏顶点分帧消费，跨帧样本余量累积不丢 |
| 雾层与刀纹层深度遮挡 | `terrainMaterial.ts`、`GroomEngine.buildTerrain` | 同一几何的半透明雾层 `depthWrite=false`、`renderOrder=2`，靠深度测试被压雪机等实体正确遮挡 |
| 残雪堆积 | `GroomEngine.maybeSpawnPile` | `InstancedMesh` 雪球池（900），沿刀头两侧投放，湿雪保持率更高、堆更大 |
| 拖拽测距 / 贴地标注 | `GroomEngine.computeMeasure` 等 | BVH 射线拾取落点；测距给直线、贴地采样距离与高差 |
| 次日复压导出 | `modules/exportTask.ts`、`types.ts` | 版本化 JSON，含全部路径点与刀头/雪质档位，导入即恢复 |

## 关键设计说明

- **确定性地形**：`heightAt(x,z)` 为纯函数，网格生成、路径拾取、贴地测距、标注贴地共用同一高度场，
  不依赖随机数，分区边界无缝。
- **作业参数固化到顶点**：每个被压顶点记录作业瞬间的刀深、刀宽、棱距、雪质系数与弧长相位，
  复压或二次作业不会让旧道形丢失参数。
- **帧率与推进解耦**：压雪机推进按 `速度/样本间距 × dt` 计算并保留跨帧小数余量，
  任意刷新率下作业速度一致；雪面形变另走每帧顶点预算队列，避免单帧尖峰掉帧。

## 目录结构

```
src/
  types.ts                 全局类型与导出文件结构
  store.ts                 zustand 状态（模块共享）
  App.tsx / main.tsx       应用壳与入口
  styles.css
  three/
    constants.ts           世界尺寸、档位参数、帧预算
    terrain.ts             确定性地形高度场与法线
    path.ts                Catmull-Rom 平滑 + 弧长等距重采样
    normalMap.ts           程序化刀纹法线贴图
    terrainMaterial.ts     雪面/雾层 ShaderMaterial
    groomDeform.ts         刀纹顶点形变器（脏队列、位移、法线重算）
    uid.ts
    GroomEngine.ts         主引擎（场景、BVH、压雪机、拾取、播放循环）
  modules/
    ZonePanel.tsx          模块一
    PathPanel.tsx          模块二
    PreviewPanel.tsx       模块三
    ExportPanel.tsx        模块四
    Viewer.tsx             3D 视图与 store 双向绑定
    exportTask.ts          任务导入导出
tests/
  smoke.ts                 核心算法单元测试（tsx，Node 直跑）
  headless.mjs             无头 Chrome 端到端测试（CDP）
```

## 验证

- `tests/smoke.ts`：路径等间距/方向单位化/弧长单调、沟底下压与边缘碎雪上隆、脏顶点分帧预算、边界不越界。
- `tests/headless.mjs`：无头 Chrome（SwiftShader）验证 WebGL 初始化、BVH 射线拾取、完整压雪作业、
  顶点位移、BVH refit、残雪堆、测距、标注、导出结构，全程控制台零错误。
  注：软件渲染仅约 20–47 FPS，60 FPS 目标在真实 GPU 上由每帧顶点预算保证；测试用固定 `dt=1/60` 逻辑步进验证作业完整性。
