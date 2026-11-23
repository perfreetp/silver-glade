# 线路地形融合展示工具

浏览器内运行的线路(铁路)与地形三维融合展示 / 编辑工具。TypeScript + Vue 3 + Babylon.js,优先使用 **WebGPU** 渲染,不支持时自动回退 WebGL2。

## 运行

```bash
npm install
npm run dev        # 开发,默认 http://127.0.0.1:5173
npm run build      # 生产构建到 dist/
npm run preview    # 预览生产构建
```

WebGPU 需要 Chrome / Edge 113+;不支持的浏览器会自动用 WebGL2 运行(界面右上角显示当前引擎)。

## 功能

- **起伏地形**:128×128 高度网格,分形噪声生成,可一键随机换一块地形
- **线路定义**:平面走向控制点(3D 场景中的橙色球,直接拖动)+ 纵断面控制点(底部纵断面图上的白色圆点,可横向拖里程、纵向拖高程)
- **实时重建**:拖动控制点即重算轨道几何;轨面按纵断面高程铺设
- **挖填方分析**:轨面高于地形为填方(橙色)、低于地形为挖方(蓝色),按 1:1.5 边坡推算影响范围,直接染色显示在地形表面
- **纵断面视图**:灰色为地形线、红色为线路线,标出每个坡度变化点、各坡段坡度值,最大坡度黄色高亮并显示在图题
- **道床断面**:中心线加宽为道床带状面,宽度 4–24m 可调,附钢轨与红色中心线
- **里程标**:沿线按 250m / 500m / 1000m 间距自动布设,标注 K 里程
- **视图切换**:可单独只看地形或只看轨道
- **数据持久化**:所有编辑自动保存到浏览器 localStorage
- **导出 / 导入**:地形高度 + 全部控制点 + 参数导出为 JSON 文件;导入后轨道几何与挖填方自动重新计算

## 导出文件格式

```json
{
  "version": 1,
  "terrain": { "size": 2000, "res": 128, "heights": [ ... 16384 个数 ... ] },
  "planPoints": [{ "x": -820, "z": -680 }, ...],
  "profilePoints": [{ "s": 0, "elev": 12.3 }, ...],
  "bedWidth": 12,
  "milepostInterval": 500,
  "showTerrain": true,
  "showTrack": true
}
```

## 代码结构

| 文件 | 职责 |
| --- | --- |
| `src/types.ts` | 工程数据类型(导出文件格式) |
| `src/noise.ts` | 确定性分形噪声地形生成 |
| `src/alignment.ts` | 平面线形采样(Catmull-Rom + 弧长重采样)、纵断面插值、坡度计算 |
| `src/terrain.ts` | 地形高度双线性采样 |
| `src/store.ts` | 响应式状态、派生线形重算、localStorage 持久化 |
| `src/file.ts` | 导出 / 导入 JSON |
| `src/scene3d.ts` | Babylon 场景:地形网格与挖填方染色、道床/钢轨/中心线、里程标、控制点拖拽 |
| `src/ProfileView.vue` | 纵断面 2D 曲线视图(可拖动控制点) |
| `src/App.vue` | 布局与工具栏 |
| `scripts/smoke.ts` | 核心逻辑冒烟测试(`npx esbuild scripts/smoke.ts --bundle --platform=node --format=cjs --outfile=scripts/smoke.bundle.cjs && node scripts/smoke.bundle.cjs`) |
