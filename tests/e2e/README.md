# 端到端测试

需要本机装有 Chrome，并能用 WebGPU 跑起来。

```bash
npm run build
npm run preview          # 另开一个终端，占用 4173 端口
npm run test:e2e         # 四模块功能验收
npm run test:stress      # 200 机柜容量与性能
```

两个脚本都会在 `tests/e2e/shots/` 下留下截图与 JSON 报告。
可用环境变量覆盖默认值：`APP_URL`、`CHROME_PATH`。

验收要点：

- 等值面顶点数在所有阈值下都不超过 300,000
- 连续拖动阈值实测帧率 ≥ 30fps（当前机器上稳定 60fps）
- 拖动阈值前后，等值面/温度场/计数三块 GPUBuffer 是同一个对象（零重新分配）
- 导出的 zip 能被解压，且 OBJ / PLY / manifest 内容与当前阈值一致
