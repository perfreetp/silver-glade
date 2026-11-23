/**
 * Marching cubes polygonizer with welded vertices.
 *
 * Vertices are shared through a per-grid-edge index table, so the resulting
 * indexed mesh has no duplicate positions and smooth analytic normals can be
 * attached per vertex.
 */
import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js';

export interface FieldSample {
	value: (x: number, y: number, z: number) => number;
	origin: [number, number, number];
	size: [number, number, number];
	cell: number;
}

/** Corner offsets matching the classic Bourke tables (bit i of the cube index). */
const CORNERS: Array<[number, number, number]> = [
	[0, 0, 0],
	[1, 0, 0],
	[1, 1, 0],
	[0, 1, 0],
	[0, 0, 1],
	[1, 0, 1],
	[1, 1, 1],
	[0, 1, 1]
];

/** Grid offsets of the two corners of each of the 12 edges. */
const EDGE_CORNERS: Array<[number, number]> = [
	[0, 1], [1, 2], [2, 3], [3, 0],
	[4, 5], [5, 6], [6, 7], [7, 4],
	[0, 4], [1, 5], [2, 6], [3, 7]
];

export function polygonize( field: FieldSample ): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
	const [ ox, oy, oz ] = field.origin;
	const [ sx, sy, sz ] = field.size;
	const cell = field.cell;
	const nx = Math.floor( sx / cell ) + 1;
	const ny = Math.floor( sy / cell ) + 1;
	const nz = Math.floor( sz / cell ) + 1;

	// --- sample the field -------------------------------------------------
	const values = new Float32Array( nx * ny * nz );
	const idx = ( x: number, y: number, z: number ) => ( z * ny + y ) * nx + x;

	for ( let z = 0; z < nz; z ++ ) {

		const wz = oz + z * cell;
		for ( let y = 0; y < ny; y ++ ) {

			const wy = oy + y * cell;
			let i = idx( 0, y, z );
			for ( let x = 0; x < nx; x ++ ) {

				values[ i ++ ] = field.value( ox + x * cell, wy, wz );

			}

		}

	}

	// --- vertex pools indexed by (grid vertex, axis) ---------------------
	// A grid vertex has up to three outgoing edges (one per axis); sharing the
	// vertices through this table welds the marching-cubes patch soup into an
	// indexed mesh with no cracks.
	const vertexSteps = [ 1, nx, nx * ny ];
	const vertexOfEdge = new Int32Array( nx * ny * nz * 3 ).fill( - 1 );

	const positions: number[] = [];
	const indices: number[] = [];

	const edgeVertex = ( kind: number, x: number, y: number, z: number, v0: number, v1: number ): number => {
		const a = idx( x, y, z );
		const key = a * 3 + kind;
		const cached = vertexOfEdge[ key ];
		if ( cached !== - 1 ) return cached;

		const fa = v0;
		const fb = v1;
		let t = fa / ( fa - fb );
		if ( ! Number.isFinite( t ) ) t = 0.5;
		t = Math.min( 1, Math.max( 0, t ) );

		const px = ox + ( x + ( kind === 0 ? t : 0 ) ) * cell;
		const py = oy + ( y + ( kind === 1 ? t : 0 ) ) * cell;
		const pz = oz + ( z + ( kind === 2 ? t : 0 ) ) * cell;

		const vi = positions.length / 3;
		positions.push( px, py, pz );
		vertexOfEdge[ key ] = vi;
		return vi;
	};

	const v = new Float32Array( 8 );

	for ( let z = 0; z < nz - 1; z ++ ) {

		for ( let y = 0; y < ny - 1; y ++ ) {

			for ( let x = 0; x < nx - 1; x ++ ) {

				let cubeIndex = 0;
				for ( let c = 0; c < 8; c ++ ) {

					const o = CORNERS[ c ];
					const val = values[ idx( x + o[ 0 ], y + o[ 1 ], z + o[ 2 ] ) ];
					v[ c ] = val;
					if ( val < 0 ) cubeIndex |= ( 1 << c );

				}

				const bits = edgeTable[ cubeIndex ];
				if ( bits === 0 ) continue;

				const cornerVertex: number[] = new Array( 12 );
				for ( let e = 0; e < 12; e ++ ) {

					if ( ( bits & ( 1 << e ) ) === 0 ) continue;
					const [ c0, c1 ] = EDGE_CORNERS[ e ];
					const p0 = CORNERS[ c0 ];
					const p1 = CORNERS[ c1 ];
					// Edge axis & base grid cell for the edge.
					const axis = p0[ 0 ] !== p1[ 0 ] ? 0 : p0[ 1 ] !== p1[ 1 ] ? 1 : 2;
					const bx = x + Math.min( p0[ 0 ], p1[ 0 ] );
					const by = y + Math.min( p0[ 1 ], p1[ 1 ] );
					const bz = z + Math.min( p0[ 2 ], p1[ 2 ] );
					cornerVertex[ e ] = edgeVertex( axis, bx, by, bz, v[ c0 ], v[ c1 ] );

				}

				const row = cubeIndex * 16;
				for ( let t = 0; t < 16; t += 3 ) {

					const a = triTable[ row + t ];
					if ( a === - 1 ) break;
					indices.push( cornerVertex[ a ], cornerVertex[ triTable[ row + t + 1 ] ], cornerVertex[ triTable[ row + t + 2 ] ] );

				}

			}

		}

	}

	const positionArray = new Float32Array( positions );
	const indexArray = new Uint32Array( indices );

	return { positions: positionArray, normals: computeGradientNormals( positionArray, field ), indices: indexArray };

}

/** Smooth normals from the central-difference gradient of the SDF. */
function computeGradientNormals( positions: Float32Array, field: FieldSample ): Float32Array {
	const out = new Float32Array( positions.length );
	const e = field.cell * 0.35;
	for ( let i = 0; i < positions.length; i += 3 ) {

		const x = positions[ i ], y = positions[ i + 1 ], z = positions[ i + 2 ];
		const gx = field.value( x + e, y, z ) - field.value( x - e, y, z );
		const gy = field.value( x, y + e, z ) - field.value( x, y - e, z );
		const gz = field.value( x, y, z + e ) - field.value( x, y, z - e );
		const l = Math.hypot( gx, gy, gz ) || 1;
		out[ i ] = gx / l;
		out[ i + 1 ] = gy / l;
		out[ i + 2 ] = gz / l;

	}

	return out;
}

/**
 * Taubin smoothing: alternating positive and negative Laplacian passes shrink
 * marching-cubes stair-stepping without the volume loss of plain Laplacian
 * smoothing. Positions only; normals are recomputed afterwards.
 */
export function taubinSmooth( positions: Float32Array, indices: Uint32Array, iterations = 3, lambda = 0.5, mu = - 0.53 ): Float32Array {
	const n = positions.length / 3;
	const neighbors: Array<Set<number>> = new Array( n );
	for ( let i = 0; i < n; i ++ ) neighbors[ i ] = new Set();

	for ( let t = 0; t < indices.length; t += 3 ) {

		const a = indices[ t ], b = indices[ t + 1 ], c = indices[ t + 2 ];
		neighbors[ a ].add( b );
		neighbors[ a ].add( c );
		neighbors[ b ].add( a );
		neighbors[ b ].add( c );
		neighbors[ c ].add( a );
		neighbors[ c ].add( b );

	}

	const list = neighbors.map( ( s ) => Array.from( s ) );
	let current = Float32Array.from( positions );
	const temp = new Float32Array( current.length );

	const pass = ( factor: number ) => {

		temp.set( current );
		for ( let i = 0; i < n; i ++ ) {

			const nb = list[ i ];
			if ( nb.length === 0 ) continue;
			let ax = 0, ay = 0, az = 0;
			for ( const j of nb ) {

				ax += current[ j * 3 ];
				ay += current[ j * 3 + 1 ];
				az += current[ j * 3 + 2 ];

			}

			const inv = 1 / nb.length;
			const ox = i * 3;
			temp[ ox ] = current[ ox ] + factor * ( ax * inv - current[ ox ] );
			temp[ ox + 1 ] = current[ ox + 1 ] + factor * ( ay * inv - current[ ox + 1 ] );
			temp[ ox + 2 ] = current[ ox + 2 ] + factor * ( az * inv - current[ ox + 2 ] );

		}

		current = Float32Array.from( temp );

	};

	for ( let it = 0; it < iterations; it ++ ) {

		pass( lambda );
		pass( mu );

	}

	return current;

}

/** Recomputes normals from the SDF gradient at the given positions. */
export function gradientNormals( positions: Float32Array, sdf: ( x: number, y: number, z: number ) => number, eps: number ): Float32Array {
	const out = new Float32Array( positions.length );
	for ( let i = 0; i < positions.length; i += 3 ) {

		const x = positions[ i ], y = positions[ i + 1 ], z = positions[ i + 2 ];
		const gx = sdf( x + eps, y, z ) - sdf( x - eps, y, z );
		const gy = sdf( x, y + eps, z ) - sdf( x, y - eps, z );
		const gz = sdf( x, y, z + eps ) - sdf( x, y, z - eps );
		const l = Math.hypot( gx, gy, gz ) || 1;
		out[ i ] = gx / l;
		out[ i + 1 ] = gy / l;
		out[ i + 2 ] = gz / l;

	}

	return out;

}

/** Flips triangle winding so faces point along the outward gradient. */
export function orientTriangles( positions: Float32Array, normals: Float32Array, indices: Uint32Array ): void {
	for ( let t = 0; t < indices.length; t += 3 ) {

		const a = indices[ t ] * 3, b = indices[ t + 1 ] * 3, c = indices[ t + 2 ] * 3;
		const ux = positions[ b ] - positions[ a ];
		const uy = positions[ b + 1 ] - positions[ a + 1 ];
		const uz = positions[ b + 2 ] - positions[ a + 2 ];
		const vx = positions[ c ] - positions[ a ];
		const vy = positions[ c + 1 ] - positions[ a + 1 ];
		const vz = positions[ c + 2 ] - positions[ a + 2 ];
		const cx = uy * vz - uz * vy;
		const cy = uz * vx - ux * vz;
		const cz = ux * vy - uy * vx;
		const nx = normals[ a ], ny = normals[ a + 1 ], nz = normals[ a + 2 ];
		if ( cx * nx + cy * ny + cz * nz < 0 ) {

			const tmp = indices[ t + 1 ];
			indices[ t + 1 ] = indices[ t + 2 ];
			indices[ t + 2 ] = tmp;

		}

	}

}

/** Hemisphere ambient occlusion by short SDF ray marches. */
export function bakeVertexAO( positions: Float32Array, normals: Float32Array, sdf: ( x: number, y: number, z: number ) => number, radius: number ): Float32Array {
	const ao = new Float32Array( positions.length / 3 );
	const dirs: Array<[number, number, number]> = [];
	const n = 14;
	for ( let i = 0; i < n; i ++ ) {

		// Cosine-weighted hemisphere directions around +Y.
		const u1 = ( i + 0.5 ) / n;
		const u2 = ( i * 0.6180339887 ) % 1;
		const r = Math.sqrt( u1 );
		const phi = u2 * Math.PI * 2;
		dirs.push( [ r * Math.cos( phi ), Math.sqrt( Math.max( 0, 1 - u1 ) ), r * Math.sin( phi ) ] );

	}

	const steps = 6;

	for ( let i = 0, vi = 0; i < positions.length; i += 3, vi ++ ) {

		const px = positions[ i ], py = positions[ i + 1 ], pz = positions[ i + 2 ];
		const nx = normals[ i ], ny = normals[ i + 1 ], nz = normals[ i + 2 ];

		// Build a tangent frame around the surface normal.
		const up: [number, number, number] = Math.abs( ny ) < 0.9 ? [ 0, 1, 0 ] : [ 1, 0, 0 ];
		let tx = up[ 1 ] * nz - up[ 2 ] * ny;
		let ty = up[ 2 ] * nx - up[ 0 ] * nz;
		let tz = up[ 0 ] * ny - up[ 1 ] * nx;
		const tl = Math.hypot( tx, ty, tz ) || 1;
		tx /= tl; ty /= tl; tz /= tl;
		const bx = ny * tz - nz * ty;
		const by = nz * tx - nx * tz;
		const bz = nx * ty - ny * tx;

		let occluded = 0;
		for ( const [ u, v, w ] of dirs ) {

			const dx = tx * u + bx * v + nx * w;
			const dy = ty * u + by * v + ny * w;
			const dz = tz * u + bz * v + nz * w;

			let occl = 0;
			for ( let s = 1; s <= steps; s ++ ) {

				const t = radius * ( s / steps );
				const d = sdf( px + dx * t, py + dy * t, pz + dz * t );
				// Fully occluded by a nearby wall, fading with distance.
				occl = Math.max( occl, Math.min( 1, Math.max( 0, ( 0.06 - d ) / 0.06 ) ) * ( 1 - ( s - 1 ) / ( steps + 1 ) ) * 0.9 );

			}

			occluded += occl;

		}

		ao[ vi ] = 1 - Math.min( 1, occluded / dirs.length );

	}

	return ao;

}

/**
 * Closes boundary loops left by marching cubes on ambiguous cells. Each loop
 * is fanned to its centroid, so the surface stays watertight for transmission
 * and shadow passes.
 */
export function fillHoles( positions: Float32Array, normals: Float32Array, indices: Uint32Array ): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
	const counts = new Map<string, number>();
	const edges: Array<[number, number]> = [];
	for ( let t = 0; t < indices.length; t += 3 ) {

		for ( let k = 0; k < 3; k ++ ) {

			const a = indices[ t + k ], b = indices[ t + ( k + 1 ) % 3 ];
			const key = a < b ? a + ',' + b : b + ',' + a;
			counts.set( key, ( counts.get( key ) || 0 ) + 1 );
			edges.push( [ a, b ] );

		}

	}

	const next = new Map<number, number[]>();
	for ( const [ a, b ] of edges ) {

		const key = a < b ? a + ',' + b : b + ',' + a;
		if ( counts.get( key ) === 1 ) {

			if ( ! next.has( a ) ) next.set( a, [] );
			next.get( a )!.push( b );

		}

	}

	if ( next.size === 0 ) return { positions, normals, indices };

	const pos: number[] = Array.from( positions );
	const nor: number[] = Array.from( normals );
	const idx: number[] = Array.from( indices );
	const used = new Set<string>();

	for ( const [ start, targets ] of next ) {

		for ( const first of targets ) {

			if ( used.has( start + '>' + first ) ) continue;
			const loop: number[] = [ start ];
			used.add( start + '>' + first );
			let cur = first;
			let guard = 0;
			while ( cur !== start && guard ++ < 10000 ) {

				loop.push( cur );
				const outs = next.get( cur );
				if ( ! outs || outs.length === 0 ) break;
				let nxt = - 1;
				for ( const o of outs ) {

					if ( ! used.has( cur + '>' + o ) ) {

						nxt = o;
						break;

					}

				}

				if ( nxt === - 1 ) break;
				used.add( cur + '>' + nxt );
				cur = nxt;

			}

			if ( loop.length < 3 ) continue;

			let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
			for ( const v of loop ) {

				cx += pos[ v * 3 ];
				cy += pos[ v * 3 + 1 ];
				cz += pos[ v * 3 + 2 ];
				nx += nor[ v * 3 ];
				ny += nor[ v * 3 + 1 ];
				nz += nor[ v * 3 + 2 ];

			}

			const m = loop.length;
			const center = pos.length / 3;
			pos.push( cx / m, cy / m, cz / m );
			const nl = Math.hypot( nx, ny, nz ) || 1;
			nor.push( nx / nl, ny / nl, nz / nl );
			for ( let i = 0; i < m; i ++ ) idx.push( loop[ i ], loop[ ( i + 1 ) % m ], center );

		}

	}

	return { positions: new Float32Array( pos ), normals: new Float32Array( nor ), indices: new Uint32Array( idx ) };

}

/**
 * Projects vertices back onto the isosurface after smoothing, using Newton
 * steps along the SDF gradient. Without this, Taubin smoothing drifts vertices
 * off-surface and the gradient normals become unreliable (which shows up as
 * dark slivers on grazing facets).
 */
export function projectToSurface( positions: Float32Array, sdf: ( x: number, y: number, z: number ) => number, eps: number, maxSteps = 4 ): Float32Array {
	const out = Float32Array.from( positions );
	for ( let i = 0; i < out.length; i += 3 ) {

		for ( let step = 0; step < maxSteps; step ++ ) {

			const x = out[ i ], y = out[ i + 1 ], z = out[ i + 2 ];
			const d = sdf( x, y, z );
			if ( Math.abs( d ) < eps * 0.1 ) break;
			const gx = sdf( x + eps, y, z ) - sdf( x - eps, y, z );
			const gy = sdf( x, y + eps, z ) - sdf( x, y - eps, z );
			const gz = sdf( x, y, z + eps ) - sdf( x, y, z - eps );
			const g2 = gx * gx + gy * gy + gz * gz;
			if ( g2 < 1e-12 ) break;
			// Newton step; clamp so a bad gradient cannot fling the vertex away.
			const t = Math.max( - 0.5, Math.min( 0.5, ( d / g2 ) ) );
			out[ i ] = x - gx * t;
			out[ i + 1 ] = y - gy * t;
			out[ i + 2 ] = z - gz * t;

		}

	}

	return out;

}

/**
 * Re-orients every triangle so its winding faces along the SDF gradient at the
 * triangle centroid. Smoothing and reprojection can flip patches relative to
 * the normals baking used, which then vanish under back-face culling as dark
 * slivers.
 */
export function reorientBySDF( positions: Float32Array, indices: Uint32Array, sdf: ( x: number, y: number, z: number ) => number, eps: number ): void {
	for ( let t = 0; t < indices.length; t += 3 ) {

		const a = indices[ t ] * 3, b = indices[ t + 1 ] * 3, c = indices[ t + 2 ] * 3;
		const ux = positions[ b ] - positions[ a ];
		const uy = positions[ b + 1 ] - positions[ a + 1 ];
		const uz = positions[ b + 2 ] - positions[ a + 2 ];
		const vx = positions[ c ] - positions[ a ];
		const vy = positions[ c + 1 ] - positions[ a + 1 ];
		const vz = positions[ c + 2 ] - positions[ a + 2 ];
		const nx = uy * vz - uz * vy;
		const ny = uz * vx - ux * vz;
		const nz = ux * vy - uy * vx;
		if ( nx * nx + ny * ny + nz * nz < 1e-16 ) continue;

		const cx = ( positions[ a ] + positions[ b ] + positions[ c ] ) / 3;
		const cy = ( positions[ a + 1 ] + positions[ b + 1 ] + positions[ c + 1 ] ) / 3;
		const cz = ( positions[ a + 2 ] + positions[ b + 2 ] + positions[ c + 2 ] ) / 3;
		const gx = sdf( cx + eps, cy, cz ) - sdf( cx - eps, cy, cz );
		const gy = sdf( cx, cy + eps, cz ) - sdf( cx, cy - eps, cz );
		const gz = sdf( cx, cy, cz + eps ) - sdf( cx, cy, cz - eps );

		if ( nx * gx + ny * gy + nz * gz < 0 ) {

			const tmp = indices[ t + 1 ];
			indices[ t + 1 ] = indices[ t + 2 ];
			indices[ t + 2 ] = tmp;

		}

	}

}

/** Removes zero-area triangles, which render as dark pixels. */
export function dropDegenerate( positions: Float32Array, indices: Uint32Array ): Uint32Array {
	const keep: number[] = [];
	for ( let t = 0; t < indices.length; t += 3 ) {

		const a = indices[ t ] * 3, b = indices[ t + 1 ] * 3, c = indices[ t + 2 ] * 3;
		const ux = positions[ b ] - positions[ a ];
		const uy = positions[ b + 1 ] - positions[ a + 1 ];
		const uz = positions[ b + 2 ] - positions[ a + 2 ];
		const vx = positions[ c ] - positions[ a ];
		const vy = positions[ c + 1 ] - positions[ a + 1 ];
		const vz = positions[ c + 2 ] - positions[ a + 2 ];
		const nx = uy * vz - uz * vy;
		const ny = uz * vx - ux * vz;
		const nz = ux * vy - uy * vx;
		// Also drop triangles whose indices repeat.
		if ( indices[ t ] === indices[ t + 1 ] || indices[ t + 1 ] === indices[ t + 2 ] || indices[ t ] === indices[ t + 2 ] ) continue;
		if ( nx * nx + ny * ny + nz * nz < 1e-14 ) continue;
		keep.push( indices[ t ], indices[ t + 1 ], indices[ t + 2 ] );

	}

	return new Uint32Array( keep );

}
