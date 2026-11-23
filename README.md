# VolSmoke Lab — 爆炸烟雾体积渲染工具

基于 **three.js WebGPURenderer + TSL** 的爆炸烟雾体积渲染工具。核心为 GPU 体积光线步进 (ray marching),密度场由噪声参数程序化生成,支持球刷编辑、方向光体积阴影、AO 近似与单次散射相位函数,可将时间轴逐帧导出为 PNG 序列。

## 运行

```bash
npm install
npm run dev        # 开发模式
# 或
npm run build && npm run preview   # 生产构建
```

**浏览器要求**: Chrome / Edge 113+(需 WebGPU)。

## 功能总览

### 1. 密度场生成(噪声参数)
- 分辨率档位: 64³ / 128³ / 256³(GPU compute 生成,256³ 约 1670 万体素)
- 爆炸壳体: 初始半径 + 随时间膨胀,高斯壳厚度可调
- 起爆核心: 初期高密度火球,随时间指数衰减
- 翻涌结构: 4 倍频脊状 FBM 噪声 (2|fbm|−1),空间尺度 / 强度 / 时间平流速度可调
- 随机种子实时切换形态

### 2. 时间轴(48 帧)
- 拖动滑块查看起爆 → 扩散全过程,支持播放 / 暂停
- 每帧切换触发 GPU 密度场与光照重算

### 3. 步进渲染
- 步进档位: 32 / 64 / 128 / 256 步
- 消光系数 σ、反照率、曝光、背景色可调
- 方向光体积阴影: 光照计算阶段朝光源步进累计透射率,烘焙进 3D 纹理
- 环境光遮蔽近似: 6 邻域密度 → exp 衰减
- Henyey-Greenstein 单次散射相位函数 (g 可调)

### 4. 密度场编辑(球刷)
- 在体积上按住左键拖动即可以球刷增 / 删密度
- 半径、强度可调;Alt + 滚轮调整笔刷沿视线深度
- 每次编辑后体积纹理与光照自动重算(去重合并调度,拖动不卡顿)
- 支持撤销一笔 / 清空全部

### 5. 对比视图
- 左右分屏: 左 = 修改前基准(进入对比时快照),右 = 当前实时编辑
- 两视图共享同一相机(同步旋转缩放),各自独立重算光照
- 可随时将当前状态设为新基准

### 6. 序列帧导出
- 按当前步进档位,将 48 帧时间轴逐帧渲染为 PNG
- 打包 ZIP 下载(附 project.json 参数备份)

### 7. 数据持久化与分享
- 所有参数与笔刷笔画自动保存到浏览器 IndexedDB(防抖 900ms)
- 可导出 / 导入项目文件(.json),跨机器分享完整工程
- `examples/sample-project.json` 为示例项目,可直接导入体验

## 技术架构

```
src/
├── defaults.js            # 默认参数与常量(48 帧、分辨率/步进档位)
├── engine/
│   ├── graphs.js          # TSL 计算图:密度生成 compute、光照 compute、光线步进材质
│   ├── VolumeView.js      # 单视图:3D 纹理、compute 节点、场景、编辑数据
│   └── VolumeEngine.js    # 渲染器、相机、重算调度、笔刷交互、对比分屏、导出渲染
├── persistence.js         # IndexedDB 读写 + 项目文件导入导出
├── exporter.js            # 序列帧 → PNG → ZIP
└── components/            # React UI:Viewport / Sidebar / Timeline / 控件
```

**渲染管线**:

1. **密度生成 (compute)**: 每体素计算 爆炸壳体(高斯环)+ 起爆核心 + 脊状 FBM 湍流扰动 + 用户编辑纹理,写入 `rgba16float` 3D 存储纹理
2. **光照重算 (compute)**: 每体素朝光源步进 N 步累计 Beer-Lambert 透射率(体积阴影),6 邻域密度估算 AO,写入 `rgba8unorm` 3D 纹理
3. **光线步进 (fragment)**: 包围盒背面渲染,射线与单位盒求交,按档位步进采样密度与光照纹理,前向合成,叠加 HG 相位方向光 + AO 环境光

**编辑持久化**: 笔刷笔画以归一化坐标记录(与分辨率无关),换分辨率后自动重放;编辑增量存于独立 3D 纹理,与程序化密度在 compute 中合成。

## 测试

```bash
node scripts/smoke-test.mjs        # TSL 图构建冒烟测试(无需 GPU)
node scripts/e2e-test2.mjs         # 真实 Chrome WebGPU 端到端(需本机 Chrome)
node scripts/test-persistence.mjs  # IndexedDB 持久化 + 项目导入导出
node scripts/visual-sweep.mjs      # 多帧截图
```

端到端测试使用本机 Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`) + puppeteer-core,覆盖:引擎初始化、笔刷笔画、撤销、逐帧像素渲染、序列帧导出 ZIP(48 张 PNG)、256³ 分辨率、IndexedDB 恢复、项目导入导出。
