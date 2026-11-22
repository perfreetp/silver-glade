# 开发用测试脚本

这些脚本不参与构建, 只用于验证求解器与渲染器:

- `solver-smoke.ts` — 求解一次风场, 打印统计、采样点流速、色带分布与散度
- `particle-leak.ts` — 大量粒子长时间推进, 检查是否有粒子逃出房间 / 穿墙
- `particle-perf.ts` — 不同粒子数下的 CPU 更新耗时
- `drag-perf.ts` — 完整解算 vs 拖动模式的耗时对比

运行: `npx tsx tests/solver-smoke.ts`
