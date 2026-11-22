// 全局配置：机房尺寸、网格、机柜、端口、线缆参数
export const ROOM = {
  minX: -10, maxX: 10,
  minY: 0,   maxY: 5,
  minZ: -9,  maxZ: 9,
};

// A* 搜索网格
export const GRID = {
  cell: 0.4,                 // 网格边长 (m)
  inflate: 0.15,             // 机柜包围盒膨胀量，保证线缆不贴墙穿模
  maxIterations: 80000,      // 单次 A* 最大扩展节点
};

// 机柜
export const CABINET = {
  width: 1.1,                // x 方向
  depth: 1.2,                // z 方向
  height: 4.2,
  rows: 2,                   // 两排机柜（冷热通道）
  perRow: 10,                // 每排 10 个
  rowX: [-3.2, 3.2],         // 两排机柜中心 x
  zStart: -7.2,
  zSpacing: 1.6,
};

// 端口：每个机柜正面 16 列 × 2 行 = 32 个，全机房 640 个（满足 300 条线缆配对）
export const PORT = {
  cols: 16,
  rows: 2,
  pitchZ: 0.066,
  ys: [1.6, 2.3],
  size: 0.09,
  protrude: 0.05,
};

// 线缆
export const CABLE = {
  maxCount: 320,             // 容量按 300+ 预留
  segments: 120,             // 每条线缆重采样段数（实例数 = 段数）
  defaultRadius: 0.035,
  minRadius: 0.012,
  maxRadius: 0.08,
  defaultBendRadius: 0.25,
  palette: [
    '#ffb347', '#4fc3f7', '#81c784', '#ba68c8',
    '#f06292', '#fff176', '#e57373', '#aed581',
  ],
  collisionColor: 0xff2222,
};

// 候选路径代价方案（在 Worker 中使用）
// waypointY：必经航点高度（世界坐标），分段 A* 强制经过对应高度的走廊
//   balanced 取起终点平均高度；overhead 走机柜顶部桥架；low 贴端口低位走线
export const VARIANTS = [
  { key: 'balanced', name: '候选 1 · 均衡走线', turn: 0.15, yMode: 0, waypointY: null },
  { key: 'overhead', name: '候选 2 · 顶部桥架', turn: 0.05, yMode: 1, waypointY: 4.6 },
  { key: 'low',      name: '候选 3 · 低位少爬升', turn: 0.35, yMode: 2, waypointY: 0.6 },
];
