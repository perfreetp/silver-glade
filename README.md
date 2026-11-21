# 菇架加湿喷淋雾锥覆盖可视化

TypeScript + Vue 3 + three.js + postprocessing 实现的菇房加湿喷雾覆盖分析工具。

## 运行

```bash
npm install
npm run dev      # 开发服务器
npm run build    # 生产构建（输出 dist/）
npm run preview  # 预览构建产物
```

## 功能

- **场景**：22m × 14m 菇房，3 条 4 层菇架（层板为遮挡体），4–12 个喷头可调
- **交互**：
  - 拖动喷头本体 → 移动位置（XZ 平面）
  - 白色手柄 → 喷射方向（偏角 0–60°）
  - 黄色手柄 → 张角（8–55°）
  - 点选喷头（场景或左侧列表）→ 其余喷头雾锥降为线框
- **雾锥渲染**：锥体 + 自定义着色器（菲涅尔边缘增亮、轴向衰减、流动闪烁），加色混合
- **湿度场**：176×112 地面栅格，按径向 × 距离平方衰减累积；热区色带映射
- **叠加与饱和**：多锥叠加经 Bloom 后处理亮度累加；超过阈值显示红色脉冲饱和标记
- **遮挡**：喷头→地面点线段与菇架层板 AABB 求交；开启遮挡检查时被挡区域变灰且不计入覆盖
- **视角**：顶视 / 侧视切换（平滑过渡）；侧视显示雾锥与每层菇架的交线
- **面板**：每个喷头的覆盖半径与重叠次数、全局覆盖率与过饱和栅格数
- **导出**：喷头参数 + 地面湿度栅格（JSON）下载

## 性能设计

- 每个喷头持有独立贡献栅格，总量为各喷头之和
- 调整单个喷头 → 只重算该喷头栅格并增量合并（`total += new − old`），约 4ms
- 12 喷头全量重算约 9ms（仅在增删喷头 / 切换遮挡时触发）
- 热循环内对响应式数据做快照，避免 Proxy 读取开销
- 湿度纹理为 `FloatType DataTexture`，增量标记 `needsUpdate` 上传

## 测试

`test/sanity.ts` 校验增量更新与全量重算结果一致、遮挡开关行为与性能基准：

```bash
npx esbuild test/sanity.ts --bundle --platform=node --format=esm --outfile=test/sanity.bundle.mjs --external:vue
node test/sanity.bundle.mjs
```
