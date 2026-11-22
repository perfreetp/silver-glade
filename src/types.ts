/** 全局工作区配置的数据模型（所有长度单位均为 mm） */

export type CurvatureLevel = 0 | 1 | 2;

export interface LedConfig {
  id: number;
  /** 是否点亮（灯腔内最多 16 个槽位，未点亮的槽位不参与光型计算） */
  enabled: boolean;
  /** 灯腔板面上的位置 */
  x: number;
  y: number;
  /** 俯仰角（绕 X 轴），度，正方向向上 */
  tiltX: number;
  /** 偏航角（绕 Y 轴），度，正方向向右 */
  tiltY: number;
  /** 亮度权重 0..1 */
  brightness: number;
}

export interface LensConfig {
  /** 曲率档位：0 低 / 1 中 / 2 高 */
  curvature: CurvatureLevel;
  /** 中心厚度 mm，名义范围 2..8，受曲率物理约束时自动抬升下限 */
  thickness: number;
  /** 透镜折射率（默认近似 BK7 玻璃） */
  ior: number;
}

export interface ProjectionConfig {
  /** 截止线在墙面上的高度（相对光轴），mm */
  cutoffY: number;
  /** 明暗过渡带宽度（墙面），mm */
  gradientWidth: number;
  /** 截止线是否带 15° 折线（近光光型标准） */
  elbow: boolean;
  /** 显示曝光增益 */
  exposure: number;
  /** 色图：灰度 / 伪彩等照度 */
  colormap: 'gray' | 'isolux';
  /** 是否叠加等照度线 */
  contours: boolean;
  /** 每帧每颗 LED 的采样光线数 */
  raysPerLed: number;
}

export interface WorkspaceConfig {
  version: 1;
  unit: 'mm';
  wallDistance: number;
  leds: LedConfig[];
  lens: LensConfig;
  projection: ProjectionConfig;
}
