# 车漆多层材质实时调校工作台

面向汽车造型团队的车漆材质实时调校工具。基于 **TypeScript + React 19 + three.js + postprocessing**，在浏览器内对电泳层、中涂层、金属/珠光片层、清漆层四层做物理顺序半透明叠加与实时 BRDF 渲染。

## 功能清单

### 材质库（左侧栏）
- 四类预设：**金属漆 / 珠光漆 / 素色漆 / 哑光漆**，共 10 套工业配方区间参数
- 点击预设卡片即载入到中央球形试片 + 引擎盖单曲率面板 + 车门双曲率面板（三件试片共享同一材质实例）
- **照片底色提取**：拖入本地车漆照片，中心加权采样 + k-means（k=5）量化，主色自动写入中涂层，另给 4 个候选色

### 四层物理叠层（右侧参数区）
物理顺序（背向 → 面向观察者）：

1. **电泳层**：基础色、粗糙度、厚度（5–80μm，步进 1）
2. **中涂层**：基础色、粗糙度、厚度、颜料遮盖率；Beer-Lambert 厚度吸收
3. **金属/珠光片层**：片体类型（金属/珠光，珠光带随角异色干涉）、**朝向分布两档切换（高光泽取向集中 / 低光泽取向散乱）**、片体色、覆盖密度、尺寸、粗糙度、闪烁、厚度
4. **清漆层**：厚度、折射率 IOR（1.3–2.0）、粗糙度、染色；IOR 菲涅尔界面

清漆高光以加法合成在最上层，数学上保证**不会被金属/珠光片层遮挡**。

### 实时预览面板
- 清漆层高光 vs 底层（粘结剂+片层+闪烁）高光的**离屏贡献拆分**：缩略图 + 占比条，每 500ms 刷新
- 光源方位角/仰角/强度滑块，也可直接在视口拖动橙色光源球，高光沿球面与车身曲面滑移
- 单帧性能表：平均/P95/峰值帧耗时、fps、掉帧计数，实时对照 16ms 预算
- 5 种调试视图：完整合成 / 清漆高光 / 底层高光 / 鳞片法线 / 四层分解

### 方案管理与交付
- 命名保存，最多 **12 套**，localStorage 持久化
- 两套方案逐项参数对比（差异高亮），一键套用到试片
- 导出 JSON：含四层全部参数，厚度单位微米，带格式版本号与导出时间

## 性能设计（16ms 单帧预算）

- 调参只写 `uniform`，**零 ShaderMaterial 重编译、零几何体重建**
- 三件试片共享同一材质实例，一次 uniform 更新全局生效
- 高频滑块用 `onInput` 直写 store，数值显示走 DOM ref，避免 React 受控重渲染堆积
- 渲染循环常驻 `requestAnimationFrame`，与 React 渲染解耦
- 鳞片场用解析值噪声（C2 连续），无细胞边界硬切；掠射角法线/反射收敛，无黑孔斑驳
- 后处理：Bloom + ACES Filmic + 暗角 + SMAA，单次 EffectComposer 管线

实测（集成显卡软件渲染无头环境）稳态帧耗时 1–12ms；独立 GPU 上远低于 16ms 预算。

## 开发

```bash
npm install
npm run dev        # 启动开发服务器（默认 5180，端口占用自动递增）
npm run build      # 类型检查 + 生产构建
npm run preview    # 预览生产构建
npm run typecheck  # 仅类型检查
```

### 冒烟测试（可选，需本机 Chrome）

```bash
npm run dev                              # 先起服务
SMOKE_URL=http://127.0.0.1:<port> node .smoke/smoke.mjs
node .smoke/lightdrag.mjs               # 光源拖动 E2E
node .smoke/probe2.mjs                  # 预设视觉探针截图
```

测试覆盖：WebGL 非空渲染、控制台零错误、滑块连续拖动、方案保存、JSON 导出字段校验、照片拖放取色、光源拖动角度联动、高光贡献占比。

## 目录结构

```
src/
├── types.ts                 # 领域模型（四层参数、预设、方案）
├── presets.ts               # 四类 10 套预设
├── store.ts                 # zustand 状态层（方案持久化）
├── engineRegistry.ts        # 引擎实例跨组件桥接
├── three/
│   ├── paintShader.ts       # 核心：四层车漆 GLSL3 BRDF + uniform 映射
│   ├── environment.ts       # PMREM 程序化摄影棚环境
│   ├── geometry.ts          # 球 + 解析法线车身曲面试片
│   └── PaintEngine.ts       # 渲染引擎、后处理、光源拖拽、贡献分析、帧指标
├── components/              # React UI（预设库、参数面板、预览、对比、导出）
└── utils/                   # 照片取色、JSON 导出
```

## 导出 JSON 格式

```json
{
  "format": "car-paint-studio",
  "version": 1,
  "units": { "thickness": "micrometer", "ior": "dimensionless" },
  "layers": {
    "electroCoat": { "color": "#...", "roughness": 0.55, "thickness": 22 },
    "primerBaseCoat": { "...": "中涂层" },
    "flakeCoat": { "...": "金属/珠光片层" },
    "clearCoat": { "thickness": 45, "ior": 1.52, "roughness": 0.04 }
  }
}
```
