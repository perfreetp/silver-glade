import {
  Color3,
  Mesh,
  MeshBuilder,
  Node,
  PBRMaterial,
  Scene,
  StandardMaterial,
  TransformNode,
  VertexBuffer,
  VertexData,
  Vector3,
} from '@babylonjs/core';

/**
 * 柱面展开 UV：绕车身长度轴(X)环绕，v 沿车长方向。
 * 环绕接缝落在车底（atan2 切割线在 y 负方向），绘制主面无 UV 镜像/断裂。
 */
export function applyCylindricalUV(mesh: Mesh): void {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const indices = mesh.getIndices();
  if (!positions || !indices) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);

  const uvs: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    // 绕 X 轴的环绕角
    const u = Math.atan2(z, y) / (Math.PI * 2) + 0.5;
    const v = (x - minX) / spanX;
    void spanY;
    uvs.push(u, v);
  }

  const vertexData = new VertexData();
  vertexData.positions = positions.slice();
  vertexData.indices = indices.slice();
  vertexData.normals = (mesh.getVerticesData(VertexBuffer.NormalKind) ?? []).slice();
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh, true);
}

export interface DemoCar {
  body: Mesh;
  /** 门缝/轮拱等装饰节点（不参与拾取，随车身一起缩放） */
  deco: TransformNode;
}

/** 程序化演示车身：胶囊体车身 + 胶囊体座舱，合并为单一网格 */
export function createDemoCar(scene: Scene, bodyMaterial: PBRMaterial): DemoCar {
  // ---- 主车身 ----
  const body = MeshBuilder.CreateCapsule(
    'demoBody',
    { height: 3.6, radius: 0.62, tessellation: 32, subdivisions: 16 },
    scene,
  );
  body.rotation.z = Math.PI / 2; // 躺平，长度沿 X
  body.bakeCurrentTransformIntoVertices();
  body.scaling.set(1, 0.78, 1); // 压扁
  body.bakeCurrentTransformIntoVertices();

  // ---- 座舱 ----
  const cabin = MeshBuilder.CreateCapsule(
    'demoCabin',
    { height: 1.7, radius: 0.46, tessellation: 32, subdivisions: 12 },
    scene,
  );
  cabin.rotation.z = Math.PI / 2;
  cabin.bakeCurrentTransformIntoVertices();
  cabin.scaling.set(1, 0.85, 0.92);
  cabin.bakeCurrentTransformIntoVertices();
  cabin.position.set(-0.12, 0.62, 0);
  cabin.bakeCurrentTransformIntoVertices();

  const merged = Mesh.MergeMeshes([body, cabin], true, true, undefined, false, false);
  if (!merged) throw new Error('演示车身合并失败');
  merged.name = 'carBody';
  merged.material = bodyMaterial;
  applyCylindricalUV(merged);
  merged.forceSharedVertices();
  merged.refreshBoundingInfo();

  // ---- 门缝 / 翼子板缝 / 轮拱装饰（不可拾取，仅视觉） ----
  const deco = new TransformNode('panelDeco', scene);
  const gapMat = new StandardMaterial('gapMat', scene);
  gapMat.diffuseColor = new Color3(0.01, 0.01, 0.012);

  const addGap = (name: string, x: number, y: number, h: number, side: number) => {
    const g = MeshBuilder.CreateBox(
      name,
      { width: 0.02, height: h, depth: 0.02 },
      scene,
    );
    g.position.set(x, y, side * 0.628);
    g.material = gapMat;
    g.isPickable = false;
    g.parent = deco;
    return g;
  };

  for (const side of [1, -1]) {
    // 前后车门缝
    addGap('doorGapFront', 0.62, 0.05, 0.66, side);
    addGap('doorGapRear', -0.5, 0.05, 0.66, side);
    // 翼子板缝
    addGap('fenderGapFront', 1.28, 0.0, 0.42, side);
    addGap('fenderGapRear', -1.3, 0.0, 0.42, side);

    // 轮拱
    for (const wx of [1.2, -1.2]) {
      const arch = MeshBuilder.CreateTorus(
        'wheelArch',
        { diameter: 0.72, thickness: 0.025, tessellation: 40 },
        scene,
      );
      arch.position.set(wx, -0.28, side * 0.6);
      arch.material = gapMat;
      arch.isPickable = false;
      arch.parent = deco;

      // 车轮
      const wheel = MeshBuilder.CreateCylinder(
        'wheel',
        { diameter: 0.58, height: 0.24, tessellation: 32 },
        scene,
      );
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, -0.3, side * 0.52);
      const wheelMat = new StandardMaterial('wheelMat', scene);
      wheelMat.diffuseColor = new Color3(0.02, 0.02, 0.025);
      wheel.material = wheelMat;
      wheel.isPickable = false;
      wheel.parent = deco;
    }
  }

  deco.parent = merged;
  return { body: merged, deco };
}
