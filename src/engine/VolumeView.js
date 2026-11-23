// 单个体积视图:密度纹理、编辑纹理、光照纹理、compute 图与渲染场景
import {
  Scene, Mesh, BoxGeometry, EdgesGeometry, LineSegments, LineBasicMaterial,
  SphereGeometry, MeshBasicMaterial, MeshBasicNodeMaterial,
  Storage3DTexture, Data3DTexture,
  RGBAFormat, RedFormat, HalfFloatType, UnsignedByteType, LinearFilter, BackSide,
} from 'three/webgpu';
import {
  createNoiseUniforms, buildDensityCompute, buildLightCompute, buildRaymarchColorNode,
} from './graphs.js';

// Float32 -> Float16 (位操作快速转换)
const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);
function toHalf(v) {
  _f32[0] = v;
  const x = _u32[0];
  const sign = (x >> 16) & 0x8000;
  const exp = ((x >> 23) & 0xff) - 112;
  const man = x & 0x7fffff;
  if (exp <= 0) return sign; // 下溢 -> 0 (编辑值不会这么小)
  if (exp >= 31) return sign | 0x7bff; // 饱和
  return sign | (exp << 10) | (man >> 13);
}

export function float32ToHalf(src, dst) {
  for (let i = 0; i < src.length; i++) dst[i] = toHalf(src[i]);
}

export class VolumeView {
  /**
   * @param {object} shared 引擎共享 uniform 组
   * @param {number} resolution 密度场分辨率 N (N^3)
   * @param {object} noiseParams 噪声参数快照
   */
  constructor(shared, resolution, noiseParams) {
    this.shared = shared;
    this.resolution = resolution;
    this.noiseU = createNoiseUniforms(noiseParams);

    const N = resolution;
    // 用户编辑数据 (CPU 主副本, 值域 [-4, 4])
    this.editData = new Float32Array(N * N * N);
    this.editHalf = new Uint16Array(N * N * N);
    this.strokes = []; // 笔刷笔画: [{ splats: [[x,y,z,r,s], ...] }, ...] (UVW 坐标)

    // 编辑密度纹理 r16float (可过滤)
    this.editTex = new Data3DTexture(this.editHalf, N, N, N);
    this.editTex.format = RedFormat;
    this.editTex.type = HalfFloatType;
    this.editTex.minFilter = LinearFilter;
    this.editTex.magFilter = LinearFilter;
    this.editTex.needsUpdate = true;

    // 密度纹理 rgba16float (compute 写入 + 采样)
    this.densityTex = new Storage3DTexture(N, N, N);
    this.densityTex.format = RGBAFormat;
    this.densityTex.type = HalfFloatType;

    // 光照纹理 rgba8unorm: r=方向光透射率, g=AO
    this.lightTex = new Storage3DTexture(N, N, N);
    this.lightTex.format = RGBAFormat;
    this.lightTex.type = UnsignedByteType;

    this.editDirty = false;

    // compute 图
    this.densityCompute = buildDensityCompute(this, shared);
    this.lightCompute = buildLightCompute(this, shared);

    // 渲染场景
    this.scene = new Scene();
    const mat = new MeshBasicNodeMaterial();
    mat.side = BackSide;
    mat.depthWrite = false;
    mat.colorNode = buildRaymarchColorNode(this, shared);
    this.material = mat;

    this.boxMesh = new Mesh(new BoxGeometry(2, 2, 2), mat);
    this.boxMesh.frustumCulled = false;
    this.scene.add(this.boxMesh);

    const edges = new LineSegments(
      new EdgesGeometry(new BoxGeometry(2.002, 2.002, 2.002)),
      new LineBasicMaterial({ color: 0x3a4a66, transparent: true, opacity: 0.7, depthTest: false })
    );
    edges.renderOrder = 10;
    this.scene.add(edges);

    // 笔刷光标
    this.brushCursor = new Mesh(
      new SphereGeometry(1, 20, 14),
      new MeshBasicMaterial({ wireframe: true, color: 0xffcc66, transparent: true, opacity: 0.45, depthTest: false })
    );
    this.brushCursor.renderOrder = 11;
    this.brushCursor.visible = false;
    this.scene.add(this.brushCursor);
  }

  // ---- 编辑 ----
  splat(cx, cy, cz, radius, strength) {
    const N = this.resolution;
    const data = this.editData;
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor((cx - radius) * N));
    const y0 = Math.max(0, Math.floor((cy - radius) * N));
    const z0 = Math.max(0, Math.floor((cz - radius) * N));
    const x1 = Math.min(N - 1, Math.ceil((cx + radius) * N));
    const y1 = Math.min(N - 1, Math.ceil((cy + radius) * N));
    const z1 = Math.min(N - 1, Math.ceil((cz + radius) * N));
    for (let z = z0; z <= z1; z++) {
      const pz = (z + 0.5) / N - cz;
      for (let y = y0; y <= y1; y++) {
        const py = (y + 0.5) / N - cy;
        for (let x = x0; x <= x1; x++) {
          const px = (x + 0.5) / N - cx;
          const d2 = px * px + py * py + pz * pz;
          if (d2 >= r2) continue;
          const fall = 1 - d2 / r2;
          const v = data[z * N * N + y * N + x] + strength * fall * fall;
          data[z * N * N + y * N + x] = Math.max(-4, Math.min(4, v));
        }
      }
    }
    this.editDirty = true;
  }

  rebuildEditData() {
    this.editData.fill(0);
    for (const stroke of this.strokes) {
      for (const [x, y, z, r, s] of stroke.splats) this.splat(x, y, z, r, s);
    }
    this.editDirty = true;
  }

  uploadEditIfDirty() {
    if (!this.editDirty) return;
    float32ToHalf(this.editData, this.editHalf);
    this.editTex.needsUpdate = true;
    this.editDirty = false;
  }

  setBrushCursor(worldPos, radiusWorld, visible) {
    this.brushCursor.visible = visible;
    if (visible) {
      this.brushCursor.position.copy(worldPos);
      this.brushCursor.scale.setScalar(Math.max(radiusWorld, 1e-4));
    }
  }

  dispose() {
    this.editTex.dispose();
    this.densityTex.dispose();
    this.lightTex.dispose();
    this.material.dispose();
    this.boxMesh.geometry.dispose();
    this.brushCursor.geometry.dispose();
    this.brushCursor.material.dispose();
    this.scene.traverse((o) => {
      if (o.isLineSegments) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
  }
}
