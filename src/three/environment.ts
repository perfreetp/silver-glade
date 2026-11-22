import * as THREE from 'three';

/**
 * 程序化摄影棚环境：渐变天幕 + 多块柔光箱 + 条形轮廓光。
 * 经 PMREM 预过滤，mip 级别直接对应粗糙度采样。
 */
export function createStudioEnv(renderer: THREE.WebGLRenderer): THREE.CubeTexture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileCubemapShader();

  const scene = new THREE.Scene();

  // 渐变天幕
  const skyGeo = new THREE.SphereGeometry(50, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color('#cfd6e4') },
      uMid: { value: new THREE.Color('#7d8494') },
      uBottom: { value: new THREE.Color('#2a2e36') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vPos;
      uniform vec3 uTop;
      uniform vec3 uMid;
      uniform vec3 uBottom;
      void main() {
        float h = normalize(vPos).y;
        vec3 c = h > 0.0
          ? mix(uMid, uTop, pow(h, 0.65))
          : mix(uMid, uBottom, pow(-h, 0.55));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  const addSoftBox = (
    pos: [number, number, number],
    size: [number, number],
    color: string,
    intensity: number,
    target: [number, number, number] = [0, 0, 0],
  ) => {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), mat);
    mesh.position.set(...pos);
    mesh.lookAt(new THREE.Vector3(...target));
    scene.add(mesh);
  };

  // 主柔光箱（上方偏前）
  addSoftBox([0, 14, 6], [11, 7], '#fff3e2', 5.5);
  // 左侧冷色补光
  addSoftBox([-13, 5, 2], [6, 9], '#dfe9ff', 3.2);
  // 右侧条形轮廓光
  addSoftBox([12, 4, -3], [2.4, 10], '#ffffff', 4.0);
  // 背后轮廓条
  addSoftBox([-3, 8, -13], [12, 2.2], '#e8edff', 3.5);
  // 低位反弹光
  addSoftBox([5, -8, 6], [9, 5], '#ffe6cf', 1.4);

  const target = pmrem.fromScene(scene, 0.06);
  pmrem.dispose();
  skyGeo.dispose();
  skyMat.dispose();
  return target.texture as THREE.CubeTexture;
}
