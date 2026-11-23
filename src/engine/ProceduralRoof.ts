import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { RoofStats } from "../types";

/**
 * 程序化古建屋面：举折曲面 + 沿坡走向的瓦垄起伏。
 * 曲面为 XZ 平面上的高度场 f(x,z)，同时提供解析投影与法线，
 * 使残损轮廓贴合不依赖逐三角形射线检测。
 */
export class ProceduralRoof {
  readonly width = 20; // 面阔方向（X），米
  readonly depth = 12; // 进深方向（Z），米
  readonly height = 4; // 屋脊高度（Y），米
  readonly ridgeSpacing = 0.5; // 瓦垄间距，米
  readonly ridgeAmplitude = 0.055; // 瓦垄起伏幅度，米
  private readonly curvePower = 1.7; // 举折曲线幂次（越大檐部越平缓）

  /** 屋面高度场：举折曲线 + 瓦垄余弦起伏 */
  heightAt(x: number, z: number): number {
    const zMax = this.depth / 2;
    const u = Math.min(1, Math.abs(z) / zMax);
    // 举折：屋脊处陡、檐口处缓
    const profile = this.height * (1 - Math.pow(u, this.curvePower));
    // 瓦垄沿 Z（坡向）延伸，沿 X 周期起伏；檐口处略减弱
    const tile =
      this.ridgeAmplitude *
      Math.cos((2 * Math.PI * x) / this.ridgeSpacing) *
      (0.35 + 0.65 * u);
    // 檐口轻微起翘（翼角感）
    const edgeX = Math.max(0, (Math.abs(x) - this.width / 2 + 1.2) / 1.2);
    const eaveLift = 0.55 * edgeX * edgeX * Math.pow(u, 3);
    return profile + tile + eaveLift;
  }

  /** 高度场解析法线 */
  normalAt(x: number, z: number): Vector3 {
    const zMax = this.depth / 2;
    const u = Math.min(1, Math.abs(z) / zMax);
    const dzdx =
      this.ridgeAmplitude *
      (-(2 * Math.PI) / this.ridgeSpacing) *
      Math.sin((2 * Math.PI * x) / this.ridgeSpacing) *
      (0.35 + 0.65 * u);
    const safeU = Math.max(u, 1e-4);
    const dzdz =
      -Math.sign(z) *
      this.height *
      this.curvePower *
      Math.pow(safeU, this.curvePower - 1) /
      zMax;
    const n = new Vector3(-dzdx, 1, -dzdz);
    return n.normalize();
  }

  contains(x: number, z: number): boolean {
    return (
      Math.abs(x) <= this.width / 2 && Math.abs(z) <= this.depth / 2
    );
  }

  /** 构建屋面网格 */
  buildMesh(scene: Scene, name = "procedural-roof"): Mesh {
    const nx = 160; // X 向分段（瓦垄间距的 ~4 倍采样）
    const nz = 96;
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    for (let iz = 0; iz <= nz; iz++) {
      const z = -this.depth / 2 + (this.depth * iz) / nz;
      for (let ix = 0; ix <= nx; ix++) {
        const x = -this.width / 2 + (this.width * ix) / nx;
        const y = this.heightAt(x, z);
        positions.push(x, y, z);
        const n = this.normalAt(x, z);
        normals.push(n.x, n.y, n.z);
        uvs.push(ix / nx, iz / nz);
      }
    }
    const row = nx + 1;
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const a = iz * row + ix;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const mesh = new Mesh(name, scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.uvs = uvs;
    vertexData.applyToMesh(mesh, false);
    mesh.useVertexColors = false;
    return mesh;
  }

  stats(mesh: Mesh): RoofStats {
    const bd = mesh.getBoundingInfo().boundingBox;
    const min = bd.minimumWorld;
    const max = bd.maximumWorld;
    // 坡度统计：对高度场抽样做有限差分
    let slopeSum = 0;
    let slopeMax = 0;
    let samples = 0;
    const step = 0.4;
    for (let x = -this.width / 2 + 0.5; x < this.width / 2; x += step) {
      for (let z = -this.depth / 2 + 0.5; z < this.depth / 2; z += step) {
        const dzdx =
          (this.heightAt(x + step, z) - this.heightAt(x - step, z)) /
          (2 * step);
        const dzdz =
          (this.heightAt(x, z + step) - this.heightAt(x, z - step)) /
          (2 * step);
        const slope = (Math.atan(Math.hypot(dzdx, dzdz)) * 180) / Math.PI;
        slopeSum += slope;
        slopeMax = Math.max(slopeMax, slope);
        samples++;
      }
    }
    return {
      triangleCount: mesh.getTotalIndices() / 3,
      vertexCount: mesh.getTotalVertices(),
      min: [min.x, min.y, min.z],
      max: [max.x, max.y, max.z],
      size: [max.x - min.x, max.y - min.y, max.z - min.z],
      avgSlopeDeg: slopeSum / samples,
      maxSlopeDeg: slopeMax,
    };
  }
}
