/**
 * Parametric faceted gem geometry, ported from the offline asset pipeline so
 * all three cuts live in the browser and can be swapped with a visibility
 * toggle (no geometry build, no shader rebuild) during interaction.
 *
 * Builder frame: table normal +Y. The return value is rotated so the table
 * faces +Z, matching the ring GLB's head orientation.
 */
import * as THREE from 'three/webgpu';
import type { CutId } from '../state/presets';

interface GemProfile {
	tableRatio: number;
	crownHeight: number;
	pavillionDepth: number;
	facets: number;
	widthScale: number;
	stepCut: boolean;
	stepCount: number;
}

export const GEM_PROFILES: Record<CutId, GemProfile> = {
	round: { tableRatio: 0.55, crownHeight: 0.27, pavillionDepth: 0.74, facets: 32, widthScale: 1.0, stepCut: false, stepCount: 1 },
	emerald: { tableRatio: 0.48, crownHeight: 0.32, pavillionDepth: 0.86, facets: 8, widthScale: 0.82, stepCut: true, stepCount: 5 },
	oval: { tableRatio: 0.56, crownHeight: 0.25, pavillionDepth: 0.7, facets: 24, widthScale: 0.7, stepCut: false, stepCount: 1 }
};

class GeoBuilder {
	positions: number[] = [];
	indices: number[] = [];

	vertex( x: number, y: number, z: number ): number {
		const i = this.positions.length / 3;
		this.positions.push( x, y, z );
		return i;
	}

	tri( a: number, b: number, c: number ): void {
		this.indices.push( a, b, c );
	}

	quad( a: number, b: number, c: number, d: number ): void {
		this.tri( a, b, c );
		this.tri( a, c, d );
	}

	/** Flat-shaded, non-indexed output with per-facet normals. */
	build(): THREE.BufferGeometry {
		// One independent vertex (3 floats) per index, so the output is flat-shaded.
		const positions = new Float32Array( this.indices.length * 3 );
		let p = 0;
		for ( let t = 0; t < this.indices.length; t += 3 ) {
			for ( let k = 0; k < 3; k ++ ) {
				const i = this.indices[ t + k ] * 3;
				positions[ p ++ ] = this.positions[ i ];
				positions[ p ++ ] = this.positions[ i + 1 ];
				positions[ p ++ ] = this.positions[ i + 2 ];
			}
		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
		orientOutward( positions );
		geometry.computeVertexNormals();
		geometry.computeBoundingSphere();
		return geometry;
	}
}

export function buildGemGeometry( cut: CutId, radius: number ): THREE.BufferGeometry {
	const p = GEM_PROFILES[ cut ];
	const g = new GeoBuilder();
	const N = p.facets;
	const sz = p.widthScale;
	const crownY = radius * p.crownHeight;
	const pavY = - radius * p.pavillionDepth;
	const tableR = radius * p.tableRatio;

	const outline = ( i: number, s: number ): [number, number] => {
		const a = ( i / N ) * Math.PI * 2;
		let x = Math.cos( a ), z = Math.sin( a );
		if ( p.stepCut ) {
			const m = Math.max( Math.abs( x ), Math.abs( z ) ) || 1;
			const k = 0.62;
			const cx = x * ( 1 - k ) + Math.sign( x ) * k * Math.abs( x ) / m;
			const cz = z * ( 1 - k ) + Math.sign( z ) * k * Math.abs( z ) / m;
			const l = Math.max( Math.abs( cx ), Math.abs( cz ) ) || 1;
			x = cx / l;
			z = cz / l;
		}
		return [ x * radius * s, z * radius * s * sz ];
	};

	const girdleTop: number[] = [];
	const girdleBot: number[] = [];
	for ( let i = 0; i < N; i ++ ) {
		const [ x, z ] = outline( i, 1.0 );
		girdleTop.push( g.vertex( x, 0.004 * radius, z ) );
		girdleBot.push( g.vertex( x, - 0.004 * radius, z ) );
	}
	for ( let i = 0; i < N; i ++ ) {
		const j = ( i + 1 ) % N;
		g.quad( girdleBot[ i ], girdleBot[ j ], girdleTop[ j ], girdleTop[ i ] );
	}

	const tableRing: number[] = [];
	if ( p.stepCut ) {
		let prev = girdleTop;
		for ( let s = 1; s <= p.stepCount; s ++ ) {
			const t = s / p.stepCount;
			const rScale = 1.0 - ( 1.0 - p.tableRatio ) * t;
			const y = crownY * t;
			const ring: number[] = [];
			for ( let i = 0; i < N; i ++ ) {
				const [ x, z ] = outline( i, rScale );
				ring.push( g.vertex( x, y, z ) );
			}
			for ( let i = 0; i < N; i ++ ) {
				const j = ( i + 1 ) % N;
				g.quad( prev[ i ], prev[ j ], ring[ j ], ring[ i ] );
			}
			prev = ring;
		}
		tableRing.push( ...prev );
	} else {
		const starRing: number[] = [];
		for ( let i = 0; i < N; i ++ ) {
			const [ x, z ] = outline( i + 0.5, ( 1.0 + p.tableRatio ) * 0.5 );
			starRing.push( g.vertex( x, crownY * 0.52, z ) );
		}
		for ( let i = 0; i < N; i ++ ) {
			const [ x, z ] = outline( i, p.tableRatio );
			tableRing.push( g.vertex( x, crownY, z ) );
		}
		for ( let i = 0; i < N; i ++ ) {
			const j = ( i + 1 ) % N;
			g.tri( girdleTop[ i ], girdleTop[ j ], starRing[ i ] );
			g.tri( girdleTop[ j ], starRing[ j ], starRing[ i ] );
			g.tri( starRing[ i ], starRing[ j ], tableRing[ j ] );
			g.tri( starRing[ i ], tableRing[ j ], tableRing[ i ] );
		}
	}

	const tableCenter = g.vertex( 0, crownY, 0 );
	for ( let i = 0; i < N; i ++ ) {
		const j = ( i + 1 ) % N;
		g.tri( tableRing[ i ], tableRing[ j ], tableCenter );
	}

	const culet = g.vertex( 0, pavY, 0 );
	if ( p.stepCut ) {
		let prev = girdleBot;
		for ( let s = 1; s <= p.stepCount; s ++ ) {
			const t = s / p.stepCount;
			const rScale = Math.max( 0.12, 1.0 - t * 0.7 );
			const y = pavY * t * 0.85;
			const ring: number[] = [];
			for ( let i = 0; i < N; i ++ ) {
				const [ x, z ] = outline( i, rScale );
				ring.push( g.vertex( x, y, z ) );
			}
			for ( let i = 0; i < N; i ++ ) {
				const j = ( i + 1 ) % N;
				g.quad( prev[ i ], prev[ j ], ring[ j ], ring[ i ] );
			}
			prev = ring;
		}
		for ( let i = 0; i < N; i ++ ) {
			const j = ( i + 1 ) % N;
			g.tri( prev[ i ], prev[ j ], culet );
		}
	} else {
		const midPav: number[] = [];
		for ( let i = 0; i < N; i ++ ) {
			const [ x, z ] = outline( i + 0.5, 0.46 );
			midPav.push( g.vertex( x, pavY * 0.52, z ) );
		}
		for ( let i = 0; i < N; i ++ ) {
			const j = ( i + 1 ) % N;
			g.tri( girdleBot[ i ], girdleBot[ j ], midPav[ i ] );
			g.tri( girdleBot[ j ], midPav[ j ], midPav[ i ] );
			g.tri( midPav[ i ], midPav[ j ], culet );
		}
	}

	const geometry = g.build();
	// Rotate the table normal from +Y to +Z to match the ring's head.
	const m = new THREE.Matrix4().makeRotationX( Math.PI / 2 );
	geometry.applyMatrix4( m );
	geometry.computeBoundingSphere();
	return geometry;
}

/**
 * The gem is star-shaped about its centroid, so "outward" is unambiguous:
 * flip any triangle whose winding disagrees with the direction away from the
 * gem centre. Doing this here (rather than relying on DoubleSide) keeps the
 * transmission pass sampling an untouched opaque buffer, which is what makes
 * refraction read as a stone instead of a kaleidoscope.
 */
function orientOutward( positions: Float32Array ): void {
	let cx = 0, cy = 0, cz = 0;
	const n = positions.length / 3;
	for ( let i = 0; i < positions.length; i += 3 ) {

		cx += positions[ i ];
		cy += positions[ i + 1 ];
		cz += positions[ i + 2 ];

	}

	cx /= n; cy /= n; cz /= n;

	for ( let t = 0; t < positions.length; t += 9 ) {

		const ax = positions[ t ], ay = positions[ t + 1 ], az = positions[ t + 2 ];
		const bx = positions[ t + 3 ], by = positions[ t + 4 ], bz = positions[ t + 5 ];
		const gx = positions[ t + 6 ], gy = positions[ t + 7 ], gz = positions[ t + 8 ];
		const ux = bx - ax, uy = by - ay, uz = bz - az;
		const vx = gx - ax, vy = gy - ay, vz = gz - az;
		const nx = uy * vz - uz * vy;
		const ny = uz * vx - ux * vz;
		const nz = ux * vy - uy * vx;
		const mx = ( ax + bx + gx ) / 3 - cx;
		const my = ( ay + by + gy ) / 3 - cy;
		const mz = ( az + bz + gz ) / 3 - cz;
		if ( nx * mx + ny * my + nz * mz < 0 ) {

			// Swap the second and third vertex of this triangle.
			positions[ t + 3 ] = gx;
			positions[ t + 4 ] = gy;
			positions[ t + 5 ] = gz;
			positions[ t + 6 ] = bx;
			positions[ t + 7 ] = by;
			positions[ t + 8 ] = bz;

		}

	}

}
