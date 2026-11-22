/**
 * WGSL 着色器
 *
 * compute 阶段：field（温度场）→ mc（移动立方体）
 * 绘制材质：iso（等值面，两趟半透明）、heatmap（风面色带）、rack（机柜本体）、floor（地面）
 *
 * 约定：所有 compute 参数都通过只读 storage buffer（f32 数组）传入，
 * 避开 WGSL uniform 的 16 字节对齐陷阱，也便于随时更新而不重建管线。
 */

/* ------------------------------------------------------------------ */
/*  参数下标（必须与 TS 侧打包顺序一致）                                */
/* ------------------------------------------------------------------ */

/** 全局网格参数 gparams */
export const GRID_IDX = {
  DIM_X: 0,
  DIM_Y: 1,
  DIM_Z: 2,
  CELL_SIZE: 3,
  ORIGIN_X: 4,
  ORIGIN_Y: 5,
  ORIGIN_Z: 6,
  AMBIENT: 7,
  LEN: 8,
} as const;

/** 温度场参数 fparams */
export const FIELD_IDX = {
  N_RACKS: 0,
  COLS: 1,
  ROWS: 2,
  FALLOFF: 3,
  /** 空间加速格参数 */
  CELLS_X: 4,
  CELLS_Y: 5,
  CELLS_Z: 6,
  CELL_MIN_X: 7,
  CELL_MIN_Y: 8,
  CELL_MIN_Z: 9,
  CELL_SIZE: 10,
  LEN: 11,
} as const;

/** 移动立方体参数 mparams */
export const MC_IDX = {
  THRESHOLD: 0,
  MAX_VERTS: 1,
  DIM_X: 2,
  DIM_Y: 3,
  DIM_Z: 4,
  CELL_SIZE: 5,
  ORIGIN_X: 6,
  ORIGIN_Y: 7,
  ORIGIN_Z: 8,
  LEN: 9,
} as const;

/** 每顶点浮点数：pos(3) + normal(3) + temp(1) + pad(1) */
export const VERTEX_FLOATS = 8;

/* ------------------------------------------------------------------ */
/*  1. 温度场（compute）                                               */
/* ------------------------------------------------------------------ */

export const FIELD_COMPUTE = /* wgsl */ `
struct RackInfo {
  ip0: vec4f, ip1: vec4f, ip2: vec4f, ip3: vec4f,
  ep0: vec4f, ep1: vec4f, ep2: vec4f, ep3: vec4f,
  inormal: vec4f, enormal: vec4f,
  bmin: vec4f, bmax: vec4f,
};

@group(0) @binding(0) var<storage, read> racks: array<RackInfo>;
@group(0) @binding(1) var<storage, read> samples: array<f32>;
@group(0) @binding(2) var<storage, read> gparams: array<f32>;
@group(0) @binding(3) var<storage, read> fparams: array<f32>;
@group(0) @binding(4) var<storage, read> cellStart: array<u32>;
@group(0) @binding(5) var<storage, read> cellItems: array<u32>;
@group(0) @binding(6) var<storage, read_write> fieldOut: array<f32>;

/** 在采样栅格上双线性取值，uv ∈ [0,1]（行优先存储） */
fn sampleFace(base: u32, cols: u32, rows: u32, uv: vec2f) -> f32 {
  let lastC = f32(cols - 1u);
  let lastR = f32(rows - 1u);
  let fc = clamp(uv * vec2f(lastC, lastR), vec2f(0.0), vec2f(lastC, lastR));
  let c0 = u32(floor(fc.x));
  let r0 = u32(floor(fc.y));
  let c1 = min(c0 + 1u, cols - 1u);
  let r1 = min(r0 + 1u, rows - 1u);
  let tx = fract(fc.x);
  let ty = fract(fc.y);
  let v00 = samples[base + r0 * cols + c0];
  let v10 = samples[base + r0 * cols + c1];
  let v01 = samples[base + r1 * cols + c0];
  let v11 = samples[base + r1 * cols + c1];
  return mix(mix(v00, v10, tx), mix(v01, v11, tx), ty);
}

/** 点到轴对齐包围盒的有符号距离（盒内为负） */
fn boxDistance(p: vec3f, bmin: vec3f, bmax: vec3f) -> f32 {
  let c = (bmin + bmax) * 0.5;
  let e = (bmax - bmin) * 0.5;
  let q = abs(p - c) - e;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dim = vec3u(u32(gparams[0]), u32(gparams[1]), u32(gparams[2]));
  if (any(gid >= dim)) { return; }

  let cellSize = gparams[3];
  let origin = vec3f(gparams[4], gparams[5], gparams[6]);
  let ambient = gparams[7];

  // 体素中心的世界坐标
  let wp = origin + (vec3f(gid) + vec3f(0.5)) * cellSize;

  let nRacks = u32(fparams[0]);
  let cols = u32(fparams[1]);
  let rows = u32(fparams[2]);
  let falloff = max(fparams[3], 1e-4);
  let faceCount = cols * rows;

  let cellsX = u32(fparams[4]);
  let cellsY = u32(fparams[5]);
  let cellsZ = u32(fparams[6]);
  let cellMin = vec3f(fparams[7], fparams[8], fparams[9]);
  let accelSize = max(fparams[10], 1e-4);

  // 定位体素所在的空间加速格
  let ci = vec3u(clamp(
    floor((wp - cellMin) / accelSize),
    vec3f(0.0),
    vec3f(f32(cellsX - 1u), f32(cellsY - 1u), f32(cellsZ - 1u))
  ));
  let cellIdx = (ci.z * cellsY + ci.y) * cellsX + ci.x;

  var wsum = 0.0;
  var tsum = 0.0;
  var wmax = 0.0;

  let start = cellStart[cellIdx];
  let end = cellStart[cellIdx + 1u];

  for (var k = start; k < end; k++) {
    let ri = cellItems[k];
    if (ri >= nRacks) { continue; }
    let r = racks[ri];

    let d = boxDistance(wp, r.bmin.xyz, r.bmax.xyz);
    if (d > falloff * 5.0) { continue; }

    // 局部坐标：u 横向，v 纵向，t 沿深度（0=进风面，1=出风面）
    let rightV = r.ip1.xyz - r.ip0.xyz;
    let upV = r.ip3.xyz - r.ip0.xyz;
    let wLen = max(length(rightV), 1e-5);
    let hLen = max(length(upV), 1e-5);
    let depthV = r.ep0.xyz - r.ip0.xyz;
    let dLen = max(length(depthV), 1e-5);

    let rel = wp - r.ip0.xyz;
    let u = dot(rel, rightV / wLen) / wLen;
    let v = dot(rel, upV / hLen) / hLen;
    let t = clamp(dot(rel, depthV / dLen) / dLen, 0.0, 1.0);

    let baseI = ri * 2u * faceCount;
    let ti = sampleFace(baseI, cols, rows, vec2f(u, v));
    let te = sampleFace(baseI + faceCount, cols, rows, vec2f(u, v));

    // 选"代表性温度"：盒外按所在侧面取，进风侧取得进风温度、出风侧取出风温度、
    // 侧面与顶面取两面均值；盒内沿深度过渡（只在柜体内部变化，不影响外壳形状）。
    var surfaceT = (ti + te) * 0.5;
    if (d >= 0.0) {
      let inSide = dot(wp - r.ip0.xyz, r.inormal.xyz) > 0.02 && dot(wp - r.ep0.xyz, r.enormal.xyz) <= 0.02;
      let exSide = dot(wp - r.ep0.xyz, r.enormal.xyz) > 0.02 && dot(wp - r.ip0.xyz, r.inormal.xyz) <= 0.02;
      if (inSide) { surfaceT = ti; }
      else if (exSide) { surfaceT = te; }
    } else {
      surfaceT = mix(ti, te, smoothstep(0.0, 1.0, t));
    }

    // 场值 = 环境温度 + (代表温度 - 环境温度) * 衰减。
    // 盒内与表面处衰减=1，场值等于该点温度；离开表面按 falloff 指数衰减回环境。
    // 这样等值面只会出现在"温度高于阈值"的机柜及其外薄层上，形成封闭包裹体。
    let strength = select(exp(-d / falloff), 1.0, d <= 0.0);
    let w = select(strength, 1000.0, d < 0.0);
    wsum += w;
    tsum += w * surfaceT;
    wmax = max(wmax, min(w, 1.0));
  }

  // 用"最大权重"决定与环境的混合比例，避免相邻机柜叠加抬高整体温度。
  let idx = (gid.z * dim.y + gid.y) * dim.x + gid.x;
  if (wsum > 1e-6) {
    fieldOut[idx] = mix(ambient, tsum / wsum, clamp(wmax, 0.0, 1.0));
  } else {
    fieldOut[idx] = ambient;
  }
}
`;

/* ------------------------------------------------------------------ */
/*  2. 移动立方体（compute）                                           */
/* ------------------------------------------------------------------ */

export const MC_COMPUTE = /* wgsl */ `
@group(0) @binding(0) var<storage, read> fieldData: array<f32>;
@group(0) @binding(1) var<storage, read> triTable: array<u32>;
@group(0) @binding(2) var<storage, read> triCount: array<u32>;
@group(0) @binding(3) var<storage, read_write> verts: array<f32>;
@group(0) @binding(4) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read> mparams: array<f32>;

const STRIDE: u32 = 8u;

fn fieldAt(dims: vec3u, x: i32, y: i32, z: i32) -> f32 {
  let cx = clamp(x, 0, i32(dims.x) - 1);
  let cy = clamp(y, 0, i32(dims.y) - 1);
  let cz = clamp(z, 0, i32(dims.z) - 1);
  let idx = (u32(cz) * dims.y + u32(cy)) * dims.x + u32(cx);
  return fieldData[idx];
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec3u(u32(mparams[2]), u32(mparams[3]), u32(mparams[4]));
  let cells = dims - vec3u(1u);
  if (any(gid >= cells)) { return; }

  let threshold = mparams[0];
  let maxVerts = u32(mparams[1]);
  let cellSize = mparams[5];
  let origin = vec3f(mparams[6], mparams[7], mparams[8]);

  var corners = array<vec3i, 8>(
    vec3i(0,0,0), vec3i(1,0,0), vec3i(1,1,0), vec3i(0,1,0),
    vec3i(0,0,1), vec3i(1,0,1), vec3i(1,1,1), vec3i(0,1,1)
  );
  var edgeA = array<u32, 12>(0u,1u,2u,3u,4u,5u,6u,7u,0u,1u,2u,3u);
  var edgeB = array<u32, 12>(1u,2u,3u,0u,5u,6u,7u,4u,4u,5u,6u,7u);

  var grid: array<f32, 8>;
  var mask: u32 = 0u;
  for (var i = 0u; i < 8u; i++) {
    let o = corners[i];
    let s = fieldAt(dims, i32(gid.x) + o.x, i32(gid.y) + o.y, i32(gid.z) + o.z);
    grid[i] = s;
    if (s >= threshold) { mask = mask | (1u << i); }
  }

  let nTris = triCount[mask];
  if (nTris == 0u) { return; }

  // 单元格内场值的峰值：等值面本身温度恒等于阈值，因此用"该处热区的峰值温度"
  // 作为顶点的温度属性，色带才有真正的信息量（表示这个包裹体有多热）。
  var cellPeak = grid[0];
  for (var ci = 1u; ci < 8u; ci++) { cellPeak = max(cellPeak, grid[ci]); }

  // 预算检查与预留必须原子完成：先预占、超了再退还，
  // 这样既不会写出越界数据，也绝不会留下半个三角形。
  let need = nTris * 3u;
  let base = atomicAdd(&counters[0], need);
  if (base + need > maxVerts) {
    atomicSub(&counters[0], need);
    return;
  }
  // counter[1] 记录高水位，供 CPU 端决定实际绘制多少个顶点
  atomicMax(&counters[1], base + need);

  for (var t = 0u; t < nTris; t++) {
    for (var k = 0u; k < 3u; k++) {
      let local_idx = t * 3u + k;

      let edge = triTable[mask * 16u + t * 3u + k];
      let a = edgeA[edge];
      let b = edgeB[edge];
      let va = grid[a];
      let vb = grid[b];
      var f = 0.5;
      let denom = vb - va;
      if (abs(denom) > 1e-6) { f = clamp((threshold - va) / denom, 0.0, 1.0); }

      let local = mix(vec3f(corners[a]), vec3f(corners[b]), f);
      let world = origin + (vec3f(gid) + local) * cellSize;

      // 梯度即场值上升方向；法线取反指向低温侧（等值面外侧）
      let gx = mix(mix(grid[1] - grid[0], grid[2] - grid[3], local.y),
                   mix(grid[5] - grid[4], grid[6] - grid[7], local.y), local.z);
      let gy = mix(mix(grid[3] - grid[0], grid[2] - grid[1], local.x),
                   mix(grid[7] - grid[4], grid[6] - grid[5], local.x), local.z);
      let gz = mix(mix(grid[4] - grid[0], grid[5] - grid[1], local.x),
                   mix(grid[7] - grid[3], grid[6] - grid[2], local.x), local.y);
      let grad = vec3f(gx, gy, gz);
      let gLen = length(grad);
      var n = vec3f(0.0, 1.0, 0.0);
      if (gLen > 1e-9) { n = -grad / gLen; }

      let slot = (base + local_idx) * STRIDE;
      verts[slot + 0u] = world.x;
      verts[slot + 1u] = world.y;
      verts[slot + 2u] = world.z;
      verts[slot + 3u] = n.x;
      verts[slot + 4u] = n.y;
      verts[slot + 5u] = n.z;
      verts[slot + 6u] = cellPeak;
      verts[slot + 7u] = 0.0;
    }
  }
}
`;

/* ------------------------------------------------------------------ */
/*  3. 等值面（顶点拉取，两趟半透明）                                  */
/* ------------------------------------------------------------------ */

export const WRAPPER_VERTEX = /* wgsl */ `
// 每顶点 8 个 f32 打包成两个 vec4f：pos.xyz + temp、normal.xyz + pad。
// 这样 struct 的 stride 恰好 32 字节，可与 MC 输出的扁平数组完全对应。
struct V { p: vec4f, n: vec4f };

var<storage, read> verts: array<V>;
var<storage, read> counters: array<u32>;

uniform worldViewProjection: mat4x4f;

varying vNormal: vec3f;
varying vWorld: vec3f;
varying vTemp: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let i = u32(vertexInputs.vertexIndex);
  var p = vec3f(0.0, -1.0e4, 0.0);
  var n = vec3f(0.0, 1.0, 0.0);
  var t = 0.0;
  if (i < counters[1]) {
    let v = verts[i];
    p = v.p.xyz;
    n = v.n.xyz;
    t = v.p.w;
  }
  vertexOutputs.vNormal = n;
  vertexOutputs.vWorld = p;
  vertexOutputs.vTemp = t;
  vertexOutputs.position = uniforms.worldViewProjection * vec4f(p, 1.0);
}
`;

export const WRAPPER_FRAGMENT = /* wgsl */ `
varying vNormal: vec3f;
varying vWorld: vec3f;
varying vTemp: f32;

uniform cameraPosition: vec3f;
uniform opacity: f32;
uniform tempRange: vec2f;
uniform passFront: f32;   // 1 = 只画朝向相机的面，0 = 只画背面

var lut: texture_2d<f32>;
var lutSampler: sampler;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let viewDir = normalize(uniforms.cameraPosition - input.vWorld);
  var n = normalize(input.vNormal);
  let facingCam = dot(n, viewDir) > 0.0;

  // 按朝向分两趟绘制：背面先画、正面后画，得到正确的半透明叠加次序
  let wantFront = uniforms.passFront > 0.5;
  if (facingCam != wantFront) { discard; }

  if (!facingCam) { n = -n; }

  let key = normalize(vec3f(0.35, 0.78, 0.52));
  let diffuse = max(dot(n, key), 0.0);
  let realFacing = max(dot(n, viewDir), 0.0);
  let rim = pow(1.0 - realFacing, 2.0);

  let span = max(uniforms.tempRange.y - uniforms.tempRange.x, 1e-3);
  let t01 = clamp((input.vTemp - uniforms.tempRange.x) / span, 0.0, 1.0);
  let base = textureSampleLevel(lut, lutSampler, vec2f(t01, 0.5), 0.0).rgb;

  // 提高整体亮度，并让边缘更亮，让半透明的包裹体在深色背景下依然可辨
  let lit = base * (0.55 + 0.55 * diffuse) + base * rim * 0.9 + vec3f(0.06, 0.09, 0.12) * rim;
  let backBoost = select(0.82, 1.0, wantFront);
  let alpha = clamp(uniforms.opacity * (0.70 + 0.60 * rim) * backBoost, 0.0, 1.0);
  fragmentOutputs.color = vec4f(lit, alpha);
}
`;

/* ------------------------------------------------------------------ */
/*  4. 机柜风面热力图                                                  */
/* ------------------------------------------------------------------ */

export const HEATMAP_VERTEX = /* wgsl */ `
attribute position: vec3f;
attribute normal: vec3f;
attribute uv: vec2f;
attribute rackmeta: vec2f;   // x = 机柜索引, y = 0 进风 / 1 出风

uniform worldViewProjection: mat4x4f;

varying vUV: vec2f;
varying vRack: f32;
varying vFace: f32;
varying vNormal: vec3f;
varying vWorld: vec3f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vUV = vertexInputs.uv;
  vertexOutputs.vRack = vertexInputs.rackmeta.x;
  vertexOutputs.vFace = vertexInputs.rackmeta.y;
  vertexOutputs.vNormal = vertexInputs.normal;
  vertexOutputs.vWorld = vertexInputs.position;
  vertexOutputs.position = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
}
`;

export const HEATMAP_FRAGMENT = /* wgsl */ `
varying vUV: vec2f;
varying vRack: f32;
varying vFace: f32;
varying vNormal: vec3f;
varying vWorld: vec3f;

var<storage, read> samples: array<f32>;
uniform faceDims: vec4f;      // x = 列, y = 行
uniform tempRange: vec2f;
uniform highlight: vec2f;     // x = 高亮机柜索引, y = 启用

var lut: texture_2d<f32>;
var lutSampler: sampler;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let cols = u32(uniforms.faceDims.x);
  let rows = u32(uniforms.faceDims.y);
  let perFace = cols * rows;
  let faceOff = select(0u, perFace, input.vFace > 0.5);
  let rackIdx = u32(input.vRack);
  let base = rackIdx * perFace * 2u + faceOff;

  let lastC = f32(cols - 1u);
  let lastR = f32(rows - 1u);
  let fc = clamp(input.vUV * vec2f(lastC, lastR), vec2f(0.0), vec2f(lastC, lastR));
  let c0 = u32(floor(fc.x));
  let r0 = u32(floor(fc.y));
  let c1 = min(c0 + 1u, cols - 1u);
  let r1 = min(r0 + 1u, rows - 1u);
  let tx = fract(fc.x);
  let ty = fract(fc.y);
  let v00 = samples[base + r0 * cols + c0];
  let v10 = samples[base + r0 * cols + c1];
  let v01 = samples[base + r1 * cols + c0];
  let v11 = samples[base + r1 * cols + c1];
  let temp = mix(mix(v00, v10, tx), mix(v01, v11, tx), ty);

  let span = max(uniforms.tempRange.y - uniforms.tempRange.x, 1e-3);
  let t01 = clamp((temp - uniforms.tempRange.x) / span, 0.0, 1.0);
  var col = textureSampleLevel(lut, lutSampler, vec2f(t01, 0.5), 0.0).rgb;

  // 采样点网格线，便于辨认读数位置
  let gx = abs(fract(fc.x) - 0.5);
  let gy = abs(fract(fc.y) - 0.5);
  let gridLine = max(smoothstep(0.40, 0.5, gx), smoothstep(0.40, 0.5, gy));
  col = mix(col, col * 0.55, gridLine * 0.6);

  let dim = select(1.0, 0.42, uniforms.highlight.y > 0.5 && abs(input.vRack - uniforms.highlight.x) > 0.5);
  fragmentOutputs.color = vec4f(col * dim, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/*  5. 机柜本体                                                        */
/* ------------------------------------------------------------------ */

export const RACK_VERTEX = /* wgsl */ `
attribute position: vec3f;
attribute normal: vec3f;
attribute rackmeta: vec2f;   // x = 机柜索引

uniform worldViewProjection: mat4x4f;

varying vNormal: vec3f;
varying vWorld: vec3f;
varying vMeta: vec2f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vNormal = vertexInputs.normal;
  vertexOutputs.vWorld = vertexInputs.position;
  vertexOutputs.vMeta = vertexInputs.rackmeta;
  vertexOutputs.position = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
}
`;

export const RACK_FRAGMENT = /* wgsl */ `
varying vNormal: vec3f;
varying vWorld: vec3f;
varying vMeta: vec2f;

uniform cameraPosition: vec3f;
uniform selection: vec4f;   // x = 高亮机柜索引, y = 是否启用

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let n = normalize(input.vNormal);
  let key = normalize(vec3f(0.4, 0.82, 0.58));
  let fill = max(dot(n, key), 0.0);
  let viewDir = normalize(uniforms.cameraPosition - input.vWorld);
  let rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);

  let hue = fract(input.vMeta.x * 0.137);
  let tint = vec3f(0.26 + 0.09 * hue, 0.29 + 0.07 * (1.0 - hue), 0.35);
  var col = tint * (0.24 + 0.76 * fill) + vec3f(0.10, 0.15, 0.22) * rim;

  let selected = uniforms.selection.y > 0.5 && abs(input.vMeta.x - uniforms.selection.x) < 0.5;
  if (selected) {
    col = mix(col, vec3f(0.40, 0.90, 1.00), 0.60);
  }
  fragmentOutputs.color = vec4f(col, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/*  6. 地面（提供空间参考）                                            */
/* ------------------------------------------------------------------ */

export const FLOOR_VERTEX = /* wgsl */ `
attribute position: vec3f;
uniform worldViewProjection: mat4x4f;
varying vWorld: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vWorld = vertexInputs.position;
  vertexOutputs.position = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
}
`;

export const FLOOR_FRAGMENT = /* wgsl */ `
varying vWorld: vec3f;
uniform center: vec2f;   // 机房中心 xz
uniform extent: vec2f;   // 半宽 xz

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let rel = input.vWorld.xz - uniforms.center;
  // 1 米网格
  let g1 = abs(fract(rel) - 0.5);
  let line1 = 1.0 - smoothstep(0.46, 0.5, max(g1.x, g1.y));
  // 5 米主网格
  let rel5 = rel / 5.0;
  let g5 = abs(fract(rel5) - 0.5);
  let line5 = 1.0 - smoothstep(0.47, 0.5, max(g5.x, g5.y));

  let base = vec3f(0.055, 0.065, 0.085);
  var col = base;
  col = mix(col, vec3f(0.10, 0.12, 0.16), line1 * 0.55);
  col = mix(col, vec3f(0.16, 0.21, 0.27), line5 * 0.85);

  // 边缘淡出
  let d = 1.0 - smoothstep(0.55, 1.0, max(abs(rel.x) / uniforms.extent.x, abs(rel.y) / uniforms.extent.y));
  fragmentOutputs.color = vec4f(col, d);
}
`;
