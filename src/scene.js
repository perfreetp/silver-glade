import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSM } from 'three/addons/csm/CSM.js';

const DEG = Math.PI / 180;

// 级联染色调试用:按视距给片元染上 近=红 / 中=绿 / 远=蓝
const CASCADE_TINT_GLSL = /* glsl */ `
  {
    float viewDepth = -vViewPosition.z;
    vec3 cTint = viewDepth < uBreaks.x ? vec3(1.0, 0.45, 0.45)
               : (viewDepth < uBreaks.y ? vec3(0.55, 1.0, 0.55)
               : vec3(0.5, 0.65, 1.0));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * cTint * 1.7, uCascadeDebug);
  }
`;

export function initScene(canvas, { onPersonMoved } = {}) {
  // ---------- 渲染器 ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCF 才支持 radius 调采样核
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b5e0);
  scene.fog = new THREE.Fog(0x87b5e0, 70, 180);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 300);
  camera.position.set(20, 16, 26);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.06;
  controls.minDistance = 6;
  controls.maxDistance = 90;

  // ---------- 环境光 ----------
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.65);
  scene.add(hemi);

  // ---------- 太阳:三级级联阴影(CSM) ----------
  const csm = new CSM({
    camera,
    parent: scene,
    cascades: 3, // 按距离分三级,远处精度低
    maxFar: 120,
    mode: 'practical',
    shadowMapSize: 1024,
    lightDirection: new THREE.Vector3(-0.5, -1, -0.5).normalize(),
    lightIntensity: 2.6,
    lightNear: 1,
    lightFar: 300,
  });
  csm.fade = true; // 级联交界处平滑过渡

  // 所有要接收阳光的材质都要注册进 CSM,并注入级联染色调试代码
  const debugUniforms = {
    uCascadeDebug: { value: 0 },
    uBreaks: { value: new THREE.Vector3(15, 45, 120) },
  };
  function makeMat(opts) {
    const m = new THREE.MeshStandardMaterial(opts);
    csm.setupMaterial(m);
    const csmOBC = m.onBeforeCompile;
    m.onBeforeCompile = (shader) => {
      csmOBC(shader);
      shader.uniforms.uCascadeDebug = debugUniforms.uCascadeDebug;
      shader.uniforms.uBreaks = debugUniforms.uBreaks;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uCascadeDebug;\nuniform vec3 uBreaks;',
        )
        .replace(
          '#include <dithering_fragment>',
          CASCADE_TINT_GLSL + '\n#include <dithering_fragment>',
        );
    };
    return m;
  }

  // ---------- 地面 / 马路 / 人行道 ----------
  const groundMat = makeMat({ color: 0x7fae6a, roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const roadMat = makeMat({ color: 0x565b63, roughness: 0.9 });
  const road = new THREE.Mesh(new THREE.BoxGeometry(90, 0.1, 7), roadMat);
  road.position.y = 0.05;
  road.receiveShadow = true;
  scene.add(road);

  const walkMat = makeMat({ color: 0xa8adb5, roughness: 0.95 });
  for (const z of [-4.4, 4.4]) {
    const walk = new THREE.Mesh(new THREE.BoxGeometry(90, 0.14, 1.8), walkMat);
    walk.position.set(0, 0.07, z);
    walk.receiveShadow = true;
    scene.add(walk);
  }

  // ---------- 小房子 ----------
  const wallMaterials = [];
  function wallMat(color) {
    const m = makeMat({ color, roughness: 0.6 });
    wallMaterials.push(m);
    return m;
  }
  const roofColors = [0xc0574f, 0x7a5fa0, 0x4f7ec0, 0xc08a4f];
  function makeHouse(x, z, color, rotY, i) {
    const g = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), wallMat(color));
    walls.position.y = 1.5;
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(3.5, 2, 4),
      makeMat({ color: roofColors[i % roofColors.length], roughness: 0.8 }),
    );
    roof.position.y = 4;
    roof.rotation.y = Math.PI / 4;
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.6, 0.1),
      makeMat({ color: 0x6b4a2f, roughness: 0.7 }),
    );
    door.position.set(0, 0.8, 2.03);
    g.add(walls, roof, door);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    scene.add(g);
  }
  makeHouse(-11, -9.5, 0xf2e3c6, 0.15, 0);
  makeHouse(1, -10.5, 0xd6e6f2, -0.1, 1);
  makeHouse(13, -9, 0xf2d6d6, 0.2, 2);
  makeHouse(-5, 9.5, 0xe4efd0, Math.PI + 0.1, 3);

  // ---------- 小树 ----------
  function makeTree(x, z, s = 1) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16 * s, 0.22 * s, 1.1 * s, 8),
      makeMat({ color: 0x7a5230, roughness: 0.9 }),
    );
    trunk.position.y = 0.55 * s;
    const leaves = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.95 * s, 1),
      makeMat({ color: 0x4d8f3f, roughness: 0.85 }),
    );
    leaves.position.y = 1.7 * s;
    g.add(trunk, leaves);
    g.position.set(x, 0, z);
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    scene.add(g);
  }
  makeTree(-16, 6, 1.2);
  makeTree(-7, -6.5, 1);
  makeTree(6, 7.5, 1.1);
  makeTree(17, 6, 0.9);
  makeTree(19, -6, 1.3);
  makeTree(-18, -7, 1);

  // ---------- 小人(可拖动) ----------
  const people = [];
  function makePerson(x, z, color) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.55, 6, 12),
      makeMat({ color, roughness: 0.6 }),
    );
    body.position.y = 0.62;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 16, 16),
      makeMat({ color: 0xffd9b3, roughness: 0.7 }),
    );
    head.position.y = 1.32;
    g.add(body, head);
    g.position.set(x, 0, z);
    g.userData.isPerson = true;
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    scene.add(g);
    people.push(g);
  }
  makePerson(-2, 1.8, 0xe04f4f);
  makePerson(3, -1.6, 0xf0c040);
  makePerson(6.5, 2.4, 0x4f7fe0);

  // ---------- 路灯(点光源,立方体阴影贴图) ----------
  function makeLamp(x, z) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 4.4, 10),
      makeMat({ color: 0x3c4148, roughness: 0.5, metalness: 0.6 }),
    );
    pole.position.y = 2.2;
    pole.castShadow = true;
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff2cc,
      emissive: 0xffc878,
      emissiveIntensity: 2.2,
      roughness: 0.4,
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), bulbMat);
    bulb.position.y = 4.55;
    const light = new THREE.PointLight(0xffc878, 30, 30, 2);
    light.position.y = 4.55;
    light.castShadow = true; // 点光源 → 立方体阴影贴图
    light.shadow.mapSize.set(512, 512);
    light.shadow.bias = -0.004;
    light.shadow.radius = 2;
    light.shadow.camera.near = 0.3;
    light.shadow.camera.far = 30;
    g.add(pole, bulb, light);
    g.position.set(x, 0, z);
    scene.add(g);
    return { group: g, light, bulbMat };
  }
  const lamp1 = makeLamp(-6, 4.6);
  const lamp2 = makeLamp(8, -4.6);

  // ---------- 太阳小球 ----------
  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffdd66, fog: false }),
  );
  scene.add(sunMesh);

  // ---------- 阴影贴图调试小窗 ----------
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.Camera();
  const quadMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: null } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      #include <packing>
      uniform sampler2D map;
      varying vec2 vUv;
      void main() {
        float d = unpackRGBAToDepth(texture2D(map, vUv));
        d = pow(d, 20.0); // 拉开对比度,方便孩子看清
        gl_FragColor = vec4(vec3(d), 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat));

  const depthMat = new THREE.MeshDepthMaterial();

  // ---------- 小人拖拽 ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  let dragging = null;

  function setPointer(e) {
    const r = canvas.getBoundingClientRect();
    pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
  }
  function personOf(obj) {
    let o = obj;
    while (o) {
      if (o.userData.isPerson) return o;
      o = o.parent;
    }
    return null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(people, true);
    if (hits.length) {
      dragging = personOf(hits[0].object);
      controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    if (dragging) {
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        dragging.position.set(
          THREE.MathUtils.clamp(hitPoint.x, -30, 30),
          0,
          THREE.MathUtils.clamp(hitPoint.z, -30, 30),
        );
      }
    } else {
      const hits = raycaster.intersectObjects(people, true);
      canvas.style.cursor = hits.length ? 'grab' : '';
    }
  });
  function endDrag() {
    if (dragging) {
      dragging = null;
      controls.enabled = true;
      canvas.style.cursor = '';
      onPersonMoved?.();
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---------- 参数应用 ----------
  const sunColorLow = new THREE.Color(0xff7733);
  const sunColorHigh = new THREE.Color(0xfff3dd);
  const skyLow = new THREE.Color(0xf0956a);
  const skyHigh = new THREE.Color(0x87b5e0);
  const tmpColor = new THREE.Color();
  let showShadowMap = false;
  let debugCascadeIndex = 0;

  function applyParams(p) {
    // 太阳位置与方向
    const el = p.elevation * DEG;
    const az = p.azimuth * DEG;
    const dir = new THREE.Vector3(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    );
    sunMesh.position.copy(dir).multiplyScalar(70);
    csm.lightDirection.copy(dir).negate();

    // 太阳越低越红、越暗;天空在 40° 以上保持蔚蓝,低角度才转黄昏色
    const t = (p.elevation - 10) / 70; // 0=傍晚 1=正午
    const skyT = THREE.MathUtils.smoothstep(p.elevation, 12, 40);
    tmpColor.copy(sunColorLow).lerp(sunColorHigh, Math.pow(t, 0.6));
    for (const l of csm.lights) {
      l.color.copy(tmpColor);
      l.intensity = 1.5 + 1.5 * t;
    }
    sunMesh.material.color.copy(tmpColor).lerp(new THREE.Color(0xffffff), 0.35);
    scene.background.copy(tmpColor.copy(skyLow).lerp(skyHigh, skyT));
    scene.fog.color.copy(scene.background);

    // 阴影质量:分辨率 / 偏移 / 采样核
    // 粗糙的表面会把影子边缘"打散"一点 → 用粗糙度放大有效采样核(模拟效果)
    const roughAvg = (p.groundRoughness + p.wallRoughness) / 2;
    const effRadius = p.radius * (0.35 + 0.65 * roughAvg);
    for (const l of csm.lights) {
      if (l.shadow.mapSize.x !== p.mapSize) {
        l.shadow.mapSize.set(p.mapSize, p.mapSize);
        if (l.shadow.map) {
          l.shadow.map.dispose();
          l.shadow.map = null;
        }
      }
      l.shadow.bias = p.bias;
      l.shadow.normalBias = p.normalBias;
      l.shadow.radius = effRadius;
    }

    // 材质粗糙度
    groundMat.roughness = p.groundRoughness;
    roadMat.roughness = Math.min(1, p.groundRoughness + 0.05);
    for (const m of wallMaterials) m.roughness = p.wallRoughness;

    // 路灯开关
    for (const [lamp, on] of [
      [lamp1, p.lamp1],
      [lamp2, p.lamp2],
    ]) {
      lamp.light.visible = on;
      lamp.bulbMat.emissiveIntensity = on ? 2.2 : 0.03;
    }

    // 调试视图
    debugUniforms.uCascadeDebug.value = p.debugView === 'cascade' ? 1 : 0;
    scene.overrideMaterial = p.debugView === 'depth' ? depthMat : null;
    showShadowMap = p.debugView === 'shadowmap';
    debugCascadeIndex = p.debugCascade;
  }

  // ---------- 主循环 ----------
  let raf = 0;
  function animate() {
    raf = requestAnimationFrame(animate);
    controls.update();
    csm.update();

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      csm.updateFrustums();
    }
    debugUniforms.uBreaks.value.set(
      csm.breaks[0] || 15,
      csm.breaks[1] || 45,
      csm.breaks[2] || 120,
    );

    renderer.setViewport(0, 0, w, h);
    renderer.clear();
    renderer.render(scene, camera);

    // 左下角画出当前级联的阴影贴图本体
    if (showShadowMap) {
      const tex = csm.lights[debugCascadeIndex]?.shadow.map?.texture;
      if (tex) {
        quadMat.uniforms.map.value = tex;
        const s = Math.min(300, h * 0.42);
        renderer.setViewport(14, 14, s, s);
        renderer.render(quadScene, quadCam);
        renderer.setViewport(0, 0, w, h);
      }
    }
  }
  animate();

  return {
    applyParams,
    dispose() {
      cancelAnimationFrame(raf);
      renderer.dispose();
      csm.remove?.();
    },
  };
}
