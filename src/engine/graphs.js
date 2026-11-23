// TSL 计算图构建:密度场生成、光照重算、体积光线步进
import {
  Fn, Loop, If, Break,
  uniform, instanceIndex, texture3D, textureStore,
  vec3, vec4, float, uvec3,
  exp, pow, clamp, smoothstep, max, min, length, normalize, dot,
  cameraPosition, positionWorld, mx_noise_float,
} from 'three/tsl';
import { Color, Vector3 } from 'three/webgpu';
import { FRAME_COUNT } from '../defaults.js';

// ---- 引擎级共享 uniform(主视图与对比视图共用同一组渲染/光照参数) ----
export function createSharedUniforms(settings) {
  const { render, light } = settings;
  return {
    uTime: uniform(settings.frame / (FRAME_COUNT - 1)),
    // 渲染
    uSteps: uniform(render.steps, 'int'),
    uExtinction: uniform(render.extinction),
    uAlbedo: uniform(render.albedo),
    uExposure: uniform(render.exposure),
    uBgColor: uniform(new Color(render.bgColor)),
    // 光照
    uLightDir: uniform(lightDirFromAngles(light.azimuth, light.elevation)),
    uLightColor: uniform(new Color(light.color)),
    uLightIntensity: uniform(light.intensity),
    uAmbientColor: uniform(new Color(light.ambientColor)),
    uAmbientIntensity: uniform(light.ambientIntensity),
    uAoStrength: uniform(light.aoStrength),
    uPhaseG: uniform(light.phaseG),
    uLightSteps: uniform(light.lightSteps, 'int'),
  };
}

export function lightDirFromAngles(azimuthDeg, elevationDeg) {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  // 指向光源的方向
  return new Vector3(
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az)
  ).normalize();
}

// ---- 每个视图独立的噪声参数 uniform ----
export function createNoiseUniforms(noise) {
  return {
    uSeed: uniform(noise.seed),
    uShellRadius: uniform(noise.shellRadius),
    uExpansion: uniform(noise.expansion),
    uShellThickness: uniform(noise.shellThickness),
    uShellDensity: uniform(noise.shellDensity),
    uCoreDensity: uniform(noise.coreDensity),
    uCoreFade: uniform(noise.coreFade),
    uTurbScale: uniform(noise.turbScale),
    uTurbStrength: uniform(noise.turbStrength),
    uTurbFlow: uniform(noise.turbFlow),
  };
}

// 4 倍频 FBM 噪声 (MaterialX Perlin),输出约 [-1, 1]
const fbm4 = Fn(([p]) => {
  const sum = float(0.0).toVar();
  const amp = float(0.5).toVar();
  const pos = p.toVar();
  Loop(4, () => {
    sum.addAssign(mx_noise_float(pos).mul(amp));
    pos.mulAssign(2.03);
    amp.mulAssign(0.5);
  });
  return sum;
});

// ---- 密度场生成 compute:爆炸壳体 + 翻涌湍流 + 用户编辑叠加 ----
export function buildDensityCompute(view, shared) {
  const N = view.resolution;
  const u = view.noiseU;
  const editTex = view.editTex;
  const densityTex = view.densityTex;

  return Fn(() => {
    const idx = instanceIndex;
    const zi = idx.div(N * N);
    const rem = idx.mod(N * N);
    const yi = rem.div(N);
    const xi = rem.mod(N);

    const p = vec3(xi.toFloat(), yi.toFloat(), zi.toFloat()).add(0.5).div(N); // 0..1
    const c = p.sub(0.5).mul(2.0); // -1..1
    const r = length(c);
    const t = shared.uTime;

    // 壳体半径随时间膨胀
    const shellR = u.uShellRadius.add(u.uExpansion.mul(t));

    // 湍流采样点:种子偏移 + 时间平流 (翻涌)
    const np = c
      .mul(u.uTurbScale)
      .add(vec3(u.uSeed.mul(17.13), u.uSeed.mul(9.31), u.uSeed.mul(4.57)))
      .add(vec3(
        t.mul(u.uTurbFlow),
        t.mul(u.uTurbFlow).mul(1.7),
        t.mul(u.uTurbFlow).mul(0.6)
      ));
    // 脊状噪声 (2|fbm|-1) 形成翻涌的絮状结构
    const nRidge = fbm4(np).abs().mul(2.0).sub(1.0);
    const turb = nRidge.mul(u.uTurbStrength).add(1.0).max(0.05);

    // 爆炸壳体: 围绕 shellR 的高斯壳
    const shell = exp(
      pow(r.sub(shellR).div(u.uShellThickness.max(0.01)), 2.0).negate()
    ).mul(u.uShellDensity).mul(turb);

    // 起爆核心: 初期高密度火球,随时间衰减 (WGSL smoothstep 要求 low < high,故反向写法用 1-x)
    const core = u.uCoreDensity
      .mul(exp(t.mul(u.uCoreFade).negate()))
      .mul(float(1.0).sub(smoothstep(0.05, 0.5, r)))
      .mul(turb);

    // 边界衰减,防止密度顶到盒子边缘
    const edge = float(1.0).sub(smoothstep(0.9, 1.0, r));

    // 用户编辑密度 (球刷增删)
    const edit = texture3D(editTex, p).x;

    const d = shell.add(core).mul(edge).add(edit).clamp(0.0, 8.0);
    textureStore(densityTex, uvec3(xi, yi, zi), vec4(d, 0.0, 0.0, 1.0)).toWriteOnly();
  })().compute(N * N * N);
}

// ---- 光照重算 compute:方向光体积阴影 (透射率) + 环境光遮蔽近似 ----
export function buildLightCompute(view, shared) {
  const N = view.resolution;
  const densityTex = view.densityTex;
  const lightTex = view.lightTex;
  const aoOffset = 2.0 / N;   // AO 邻域采样半径 (UVW)
  const stepLen = 3.5 / N;    // 阴影步进长度 (UVW)

  return Fn(() => {
    const idx = instanceIndex;
    const zi = idx.div(N * N);
    const rem = idx.mod(N * N);
    const yi = rem.div(N);
    const xi = rem.mod(N);
    const p = vec3(xi.toFloat(), yi.toFloat(), zi.toFloat()).add(0.5).div(N);

    // 朝光源方向步进,累计透射率 (体积阴影)
    const trans = float(1.0).toVar();
    Loop(shared.uLightSteps, ({ i }) => {
      const q = p.add(shared.uLightDir.mul(stepLen).mul(i.toFloat().add(1.0)));
      const dd = texture3D(densityTex, q).x;
      trans.mulAssign(exp(dd.mul(shared.uExtinction).mul(stepLen).negate()));
    });

    // AO 近似: 6 邻域平均密度 -> exp 衰减
    const o = float(aoOffset);
    const aoSum = float(0.0).toVar();
    aoSum.addAssign(texture3D(densityTex, p.add(vec3(o, 0.0, 0.0))).x);
    aoSum.addAssign(texture3D(densityTex, p.sub(vec3(o, 0.0, 0.0))).x);
    aoSum.addAssign(texture3D(densityTex, p.add(vec3(0.0, o, 0.0))).x);
    aoSum.addAssign(texture3D(densityTex, p.sub(vec3(0.0, o, 0.0))).x);
    aoSum.addAssign(texture3D(densityTex, p.add(vec3(0.0, 0.0, o))).x);
    aoSum.addAssign(texture3D(densityTex, p.sub(vec3(0.0, 0.0, o))).x);
    const ao = exp(aoSum.div(6.0).mul(shared.uAoStrength).negate());

    // r = 方向光透射率, g = AO
    textureStore(lightTex, uvec3(xi, yi, zi), vec4(trans, ao, 0.0, 1.0)).toWriteOnly();
  })().compute(N * N * N);
}

// ---- 体积光线步进材质 (渲染在包围盒背面) ----
export function buildRaymarchColorNode(view, shared) {
  const densityTex = view.densityTex;
  const lightTex = view.lightTex;

  return Fn(() => {
    const ro = cameraPosition;
    const rd = normalize(positionWorld.sub(ro));

    // 光线与 [-1,1]^3 包围盒求交
    const invD = rd.reciprocal();
    const t0 = vec3(-1.0).sub(ro).mul(invD);
    const t1 = vec3(1.0).sub(ro).mul(invD);
    const tMin = min(t0, t1);
    const tMax = max(t0, t1);
    const tEnter = max(max(tMin.x, tMin.y), tMin.z).max(0.0);
    const tExit = min(min(tMax.x, tMax.y), tMax.z);

    const col = vec3(0.0).toVar();
    const trans = float(1.0).toVar();

    If(tExit.greaterThan(tEnter), () => {
      const dt = tExit.sub(tEnter).div(float(shared.uSteps));
      Loop(shared.uSteps, ({ i }) => {
        const tp = tEnter.add(i.toFloat().add(0.5).mul(dt));
        const pos = ro.add(rd.mul(tp));
        const uvw = pos.mul(0.5).add(0.5);
        const d = texture3D(densityTex, uvw).x;

        If(d.greaterThan(0.003), () => {
          const lg = texture3D(lightTex, uvw);
          const sigmaE = d.mul(shared.uExtinction);
          const sampleT = exp(sigmaE.mul(dt).negate());

          // Henyey-Greenstein 单次散射相位函数
          const cosT = dot(rd, shared.uLightDir);
          const g = shared.uPhaseG;
          const phase = float(1.0).sub(g.mul(g)).div(
            float(12.56637).mul(pow(float(1.0).add(g.mul(g)).sub(g.mul(2.0).mul(cosT)), 1.5))
          );

          // 方向光 (含体积阴影透射率) + 环境光 (含 AO)
          const sun = shared.uLightColor
            .mul(shared.uLightIntensity)
            .mul(lg.x)
            .mul(phase);
          const amb = shared.uAmbientColor.mul(shared.uAmbientIntensity).mul(lg.y);
          const li = sun.add(amb).mul(shared.uAlbedo);

          col.addAssign(trans.mul(float(1.0).sub(sampleT)).mul(li));
          trans.mulAssign(sampleT);
          If(trans.lessThan(0.01), () => {
            Break();
          });
        });
      });
    });

    const outColor = shared.uBgColor.mul(trans).add(col).mul(shared.uExposure);
    return vec4(outColor, 1.0);
  })();
}
