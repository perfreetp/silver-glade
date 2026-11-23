// 全局常量与默认参数
export const FRAME_COUNT = 48; // 时间轴固定 48 帧
export const RESOLUTIONS = [64, 128, 256]; // 密度场分辨率档位 (N^3)
export const STEP_TIERS = [32, 64, 128, 256]; // 光线步进次数档位

export const DEFAULT_SETTINGS = {
  resolution: 128,
  frame: 0,
  // 噪声 / 爆炸形态参数
  noise: {
    seed: 7,            // 随机种子
    shellRadius: 0.14,  // 起爆壳体初始半径 (盒子半宽=1)
    expansion: 0.55,    // 壳体随时间膨胀量
    shellThickness: 0.1, // 壳体厚度
    shellDensity: 3.0,  // 壳体密度
    coreDensity: 2.2,   // 核心密度 (起爆初期火球)
    coreFade: 2.4,      // 核心随时间衰减速度
    turbScale: 4.0,     // 湍流空间频率
    turbStrength: 1.1,  // 湍流强度 (翻涌结构)
    turbFlow: 0.7,      // 湍流随时间流动速度
  },
  // 球刷
  brush: {
    mode: 'add',   // 'add' | 'sub'
    radius: 0.12,  // 半径 (UVW 单位, 盒子=1)
    strength: 0.6, // 强度
    depth: 0.5,    // 视线方向深度 (0=近表面, 1=远表面)
  },
  // 渲染
  render: {
    steps: 128,      // 步进次数档位
    extinction: 2.4, // 消光系数 sigma_t
    albedo: 0.9,     // 散射反照率
    exposure: 1.15,  // 曝光
    bgColor: '#0b0e14',
  },
  // 光照
  light: {
    azimuth: 40,     // 方向光方位角 (度)
    elevation: 50,   // 方向光仰角 (度)
    color: '#ffd9a8',
    intensity: 4.5,
    ambientColor: '#44557a',
    ambientIntensity: 0.9,
    aoStrength: 1.4, // 环境光遮蔽近似强度
    phaseG: 0.35,    // HG 相位函数 g
    lightSteps: 12,  // 体积阴影步进数
  },
};

export function cloneSettings(s) {
  return JSON.parse(JSON.stringify(s));
}
