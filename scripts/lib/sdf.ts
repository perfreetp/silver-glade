/**
 * Signed distance field primitives used offline to sculpt the hand mesh.
 * All distances are negative inside, positive outside. Units: hand model space.
 */
export type Vec3 = [number, number, number];

export const v3 = (x: number, y: number, z: number): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
	const l = len(a) || 1;
	return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
	a[0] + (b[0] - a[0]) * t,
	a[1] + (b[1] - a[1]) * t,
	a[2] + (b[2] - a[2]) * t
];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0]
];

/** Unit vector, or null when the input is degenerate. */
export const norm = (a: Vec3): Vec3 | null => {
	const l = len(a);
	return l < 1e-6 ? null : [a[0] / l, a[1] / l, a[2] / l];
};

/** Polynomial smooth minimum (smooth union). */
export function smin(a: number, b: number, k: number): number {
	const h = Math.max(k - Math.abs(a - b), 0) / k;
	return Math.min(a, b) - h * h * k * 0.25;
}

/** Polynomial smooth maximum (smooth subtraction of b from a). */
export function smax(a: number, b: number, k: number): number {
	return -smin(-a, -b, k);
}

/** Rounded box, non-uniform half extents. */
export function sdRoundBox(p: Vec3, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, r: number): number {
	const qx = Math.abs(p[0] - cx) - hx;
	const qy = Math.abs(p[1] - cy) - hy;
	const qz = Math.abs(p[2] - cz) - hz;
	const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
	return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

export function sdSphere(p: Vec3, c: Vec3, r: number): number {
	return len(sub(p, c)) - r;
}

export function sdEllipsoid(p: Vec3, c: Vec3, r: Vec3): number {
	// Approximate (bounded) ellipsoid distance.
	const qx = (p[0] - c[0]) / r[0];
	const qy = (p[1] - c[1]) / r[1];
	const qz = (p[2] - c[2]) / r[2];
	const k0 = Math.hypot(qx, qy, qz);
	const k1 = Math.hypot(qx / r[0], qy / r[1], qz / r[2]);
	return k1 === 0 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
}

/** Tapered capsule between a and b with radii ra and rb (Inigo Quilez round cone). */
export function sdRoundCone(p: Vec3, a: Vec3, b: Vec3, ra: number, rb: number): number {
	const ba = sub(b, a);
	const l2 = ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2];
	const rr = ra - rb;
	const a2 = l2 - rr * rr;
	const il2 = 1 / l2;
	const pa = sub(p, a);
	const y = pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2];
	const z = y - l2;
	const xv = pa[0] * l2 - ba[0] * y;
	const yv = pa[1] * l2 - ba[1] * y;
	const zv = pa[2] * l2 - ba[2] * y;
	const x2 = xv * xv + yv * yv + zv * zv;
	const y2 = y * y * l2;
	const z2 = z * z * l2;
	const k = Math.sign(rr) * rr * rr * x2;
	if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
	if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
	return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - ra;
}

/** Torus around the Y axis at height cy, centered at (cx, cy, cz). */
export function sdTorusY(p: Vec3, cx: number, cy: number, cz: number, R: number, r: number): number {
	const qx = Math.hypot(p[0] - cx, p[2] - cz) - R;
	const qy = p[1] - cy;
	return Math.hypot(qx, qy) - r;
}

/** Rotate a point around the X axis. */
export function rotX(p: Vec3, a: number): Vec3 {
	const c = Math.cos(a), s = Math.sin(a);
	return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
}

/** Rotate a point around the Y axis. */
export function rotY(p: Vec3, a: number): Vec3 {
	const c = Math.cos(a), s = Math.sin(a);
	return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

/** Rotate a point around the Z axis. */
export function rotZ(p: Vec3, a: number): Vec3 {
	const c = Math.cos(a), s = Math.sin(a);
	return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
}
