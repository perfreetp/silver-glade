/**
 * Procedural ring model, exported as one GLB with two meshes so the app can
 * bind two independent material slots:
 *
 *   node "band" – shank, shoulders, gallery and bezel           (material 0)
 *   node "gem"  – faceted gem, table facing +Z                   (material 1)
 *
 * Frame: the finger axis is +Y, so the band lies in the XZ plane. The head
 * sits on the +Z side (the back of the finger), which the app rotates into
 * place so the stone faces away from the palm.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname( fileURLToPath( import.meta.url ) );
const root = resolve( here, '..' );

type Vec3 = [number, number, number];

const add3 = ( a: Vec3, b: Vec3 ): Vec3 => [ a[ 0 ] + b[ 0 ], a[ 1 ] + b[ 1 ], a[ 2 ] + b[ 2 ] ];
const sub3 = ( a: Vec3, b: Vec3 ): Vec3 => [ a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ], a[ 2 ] - b[ 2 ] ];
const mul3 = ( a: Vec3, s: number ): Vec3 => [ a[ 0 ] * s, a[ 1 ] * s, a[ 2 ] * s ];
const len3 = ( a: Vec3 ) => Math.hypot( a[ 0 ], a[ 1 ], a[ 2 ] );
const norm3 = ( a: Vec3 ): Vec3 => {

	const l = len3( a ) || 1;
	return [ a[ 0 ] / l, a[ 1 ] / l, a[ 2 ] / l ];

};

const smooth = ( t: number ) => t * t * ( 3 - 2 * t );

const cross3 = ( a: Vec3, b: Vec3 ): Vec3 => [
	a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ],
	a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ],
	a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ]
];

// ---------------------------------------------------------------------------
// Mesh accumulator.
// ---------------------------------------------------------------------------

interface Geo {
	positions: number[];
	indices: number[];
}

const newGeo = (): Geo => ( { positions: [], indices: [] } );

function addVertex( g: Geo, p: Vec3 ): number {

	const i = g.positions.length / 3;
	g.positions.push( p[ 0 ], p[ 1 ], p[ 2 ] );
	return i;

}

function addTri( g: Geo, a: number, b: number, c: number ) {

	g.indices.push( a, b, c );

}

function addQuad( g: Geo, a: number, b: number, c: number, d: number ) {

	addTri( g, a, b, c );
	addTri( g, a, c, d );

}

function computeNormals( positions: Float32Array, indices: Uint32Array ): Float32Array {

	const n = new Float32Array( positions.length );
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
		for ( const i of [ a, b, c ] ) {

			n[ i ] += nx;
			n[ i + 1 ] += ny;
			n[ i + 2 ] += nz;

		}

	}

	for ( let i = 0; i < n.length; i += 3 ) {

		const l = Math.hypot( n[ i ], n[ i + 1 ], n[ i + 2 ] ) || 1;
		n[ i ] /= l;
		n[ i + 1 ] /= l;
		n[ i + 2 ] /= l;

	}

	return n;

}

/** Flat shading: one unique vertex triple per triangle, with facet normals. */
function finalizeFlat( g: Geo ): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {

	const src = g.indices.length > 0 ? g : g;
	const positions: number[] = [];
	const indices: number[] = [];
	for ( let t = 0; t < src.indices.length; t += 3 ) {

		for ( let k = 0; k < 3; k ++ ) {

			const i = src.indices[ t + k ] * 3;
			positions.push( src.positions[ i ], src.positions[ i + 1 ], src.positions[ i + 2 ] );
			indices.push( positions.length / 3 - 1 );

		}

	}

	const pos = new Float32Array( positions );
	const idx = new Uint32Array( indices );
	// Area-weighted normals of each independent triangle give exact facet shading.
	const normals = new Float32Array( pos.length );
	for ( let t = 0; t < idx.length; t += 3 ) {

		const a = idx[ t ] * 3, b = idx[ t + 1 ] * 3, c = idx[ t + 2 ] * 3;
		const ux = pos[ b ] - pos[ a ], uy = pos[ b + 1 ] - pos[ a + 1 ], uz = pos[ b + 2 ] - pos[ a + 2 ];
		const vx = pos[ c ] - pos[ a ], vy = pos[ c + 1 ] - pos[ a + 1 ], vz = pos[ c + 2 ] - pos[ a + 2 ];
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		const l = Math.hypot( nx, ny, nz ) || 1;
		for ( let k = 0; k < 3; k ++ ) {

			const i = idx[ t + k ] * 3;
			normals[ i ] = nx / l;
			normals[ i + 1 ] = ny / l;
			normals[ i + 2 ] = nz / l;

		}

	}

	return { positions: pos, normals, indices: idx };

}

function finalizeSmooth( g: Geo ): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {

	const positions = new Float32Array( g.positions );
	const indices = new Uint32Array( g.indices );
	return { positions, normals: computeNormals( positions, indices ), indices };

}

// ---------------------------------------------------------------------------
// Sweeps.
// ---------------------------------------------------------------------------

/**
 * Sweep a closed 2D profile around the Y axis. `profile` entries are
 * [radialOffset, axialOffset] around ( radius, 0 ).
 */
function sweepAroundY( g: Geo, radius: number, profile: Array<[number, number]>, segments: number ) {

	const rings: number[][] = [];
	for ( let s = 0; s < segments; s ++ ) {

		const a = ( s / segments ) * Math.PI * 2;
		const ca = Math.cos( a ), sa = Math.sin( a );
		const ring: number[] = [];
		for ( const [ dr, dy ] of profile ) {

			const r = radius + dr;
			ring.push( addVertex( g, [ ca * r, dy, sa * r ] ) );

		}

		rings.push( ring );

	}

	const m = profile.length;
	for ( let s = 0; s < segments; s ++ ) {

		const A = rings[ s ];
		const B = rings[ ( s + 1 ) % segments ];
		for ( let i = 0; i < m; i ++ ) {

			const j = ( i + 1 ) % m;
			addQuad( g, A[ i ], B[ i ], B[ j ], A[ j ] );

		}

	}

}

/**
 * Tube swept along a polyline with per-point radius. Uses parallel transport
 * for a stable frame, so shoulders can curve without twisting.
 */
function sweepTube( g: Geo, points: Vec3[], radii: number[], sides = 14, upHint: Vec3 = [ 0, 0, 1 ] ) {

	const frames: Array<{ t: Vec3; n: Vec3; b: Vec3 }> = [];
	let normal = norm3( cross3( upHint, norm3( sub3( points[ 1 ], points[ 0 ] ) ) ) );
	if ( len3( normal ) < 1e-4 ) normal = [ 1, 0, 0 ];

	// Drop duplicated points: a zero-length segment makes the tangent NaN and
	// produces a fin of garbage triangles.
	const cleaned: Vec3[] = [];
	const cleanedRadii: number[] = [];
	for ( let i = 0; i < points.length; i ++ ) {

		if ( i > 0 && len3( sub3( points[ i ], points[ i - 1 ] ) ) < 1e-5 ) continue;
		cleaned.push( points[ i ] );
		cleanedRadii.push( radii[ i ] );

	}

	if ( cleaned.length < 2 ) return;
	points = cleaned;
	radii = cleanedRadii;

	for ( let i = 0; i < points.length; i ++ ) {

		const prev = points[ Math.max( 0, i - 1 ) ];
		const next = points[ Math.min( points.length - 1, i + 1 ) ];
		const t = norm3( sub3( next, prev ) );
		// Parallel transport: remove the tangent component, renormalize.
		const d = normal[ 0 ] * t[ 0 ] + normal[ 1 ] * t[ 1 ] + normal[ 2 ] * t[ 2 ];
		normal = norm3( [ normal[ 0 ] - t[ 0 ] * d, normal[ 1 ] - t[ 1 ] * d, normal[ 2 ] - t[ 2 ] * d ] );
		const b = cross3( t, normal );
		frames.push( { t, n: normal, b } );

	}

	const rings: number[][] = [];
	for ( let i = 0; i < points.length; i ++ ) {

		const { n, b } = frames[ i ];
		const ring: number[] = [];
		for ( let s = 0; s < sides; s ++ ) {

			const a = ( s / sides ) * Math.PI * 2;
			const ca = Math.cos( a ) * radii[ i ];
			const sa = Math.sin( a ) * radii[ i ];
			ring.push( addVertex( g, [
				points[ i ][ 0 ] + n[ 0 ] * ca + b[ 0 ] * sa,
				points[ i ][ 1 ] + n[ 1 ] * ca + b[ 1 ] * sa,
				points[ i ][ 2 ] + n[ 2 ] * ca + b[ 2 ] * sa
			] ) );

		}

		rings.push( ring );

	}

	for ( let i = 0; i < rings.length - 1; i ++ ) {

		for ( let s = 0; s < sides; s ++ ) {

			const s2 = ( s + 1 ) % sides;
			addQuad( g, rings[ i ][ s ], rings[ i ][ s2 ], rings[ i + 1 ][ s2 ], rings[ i + 1 ][ s ] );

		}

	}

	// Rounded end caps.
	for ( const end of [ 0, rings.length - 1 ] ) {

		const p = points[ end ];
		const dir = end === 0 ? - 1 : 1;
		const tip = addVertex( g, add3( p, mul3( frames[ end ].t, dir * radii[ end ] * 0.35 ) ) );
		for ( let s = 0; s < sides; s ++ ) {

			const s2 = ( s + 1 ) % sides;
			if ( end === 0 ) addTri( g, rings[ 0 ][ s2 ], rings[ 0 ][ s ], tip );
			else addTri( g, rings[ end ][ s ], rings[ end ][ s2 ], tip );

		}

	}

}

/** Ring (torus) in a plane whose normal is `axis`, centered at c. */
function sweepRing( g: Geo, c: Vec3, axis: Vec3, majorR: number, minorR: number, majorSegs = 64, minorSegs = 12 ) {

	const n = norm3( axis );
	let u = cross3( n, [ 0, 0, 1 ] );
	if ( len3( u ) < 1e-3 ) u = cross3( n, [ 1, 0, 0 ] );
	u = norm3( u );
	const v = cross3( n, u );

	const rings: number[][] = [];
	for ( let i = 0; i < majorSegs; i ++ ) {

		const a = ( i / majorSegs ) * Math.PI * 2;
		const ca = Math.cos( a ), sa = Math.sin( a );
		const center = add3( c, add3( mul3( u, ca * majorR ), mul3( v, sa * majorR ) ) );
		const radial = norm3( add3( mul3( u, ca ), mul3( v, sa ) ) );
		const ring: number[] = [];
		for ( let j = 0; j < minorSegs; j ++ ) {

			const b = ( j / minorSegs ) * Math.PI * 2;
			const cb = Math.cos( b ), sb = Math.sin( b );
			ring.push( addVertex( g, add3( center, add3( mul3( radial, cb * minorR ), mul3( n, sb * minorR ) ) ) ) );

		}

		rings.push( ring );

	}

	for ( let i = 0; i < majorSegs; i ++ ) {

		const A = rings[ i ];
		const B = rings[ ( i + 1 ) % majorSegs ];
		for ( let j = 0; j < minorSegs; j ++ ) {

			const j2 = ( j + 1 ) % minorSegs;
			addQuad( g, A[ j ], B[ j ], B[ j2 ], A[ j2 ] );

		}

	}

}

// ---------------------------------------------------------------------------
// Gem cuts.
// ---------------------------------------------------------------------------

export type GemCut = 'round' | 'emerald' | 'oval';

interface GemProfile {
	tableRatio: number;
	crownHeight: number;
	pavillionDepth: number;
	facets: number;
	widthScale: number;
	stepCut: boolean;
	stepCount: number;
}

const CUTS: Record<GemCut, GemProfile> = {
	round: { tableRatio: 0.55, crownHeight: 0.26, pavillionDepth: 0.72, facets: 16, widthScale: 1.0, stepCut: false, stepCount: 1 },
	emerald: { tableRatio: 0.64, crownHeight: 0.17, pavillionDepth: 0.6, facets: 8, widthScale: 0.74, stepCut: true, stepCount: 3 },
	oval: { tableRatio: 0.57, crownHeight: 0.24, pavillionDepth: 0.68, facets: 16, widthScale: 0.7, stepCut: false, stepCount: 1 }
};

/**
 * Faceted gem with its table normal along +Y and the girdle in the XZ plane.
 * `radius` is the girdle half-width along X.
 */
function buildGem( cut: GemCut, radius: number ): Geo {

	const p = CUTS[ cut ];
	const g = newGeo();
	const N = p.facets;
	const sz = p.widthScale;
	const crownY = radius * p.crownHeight;
	const pavY = - radius * p.pavillionDepth;
	const tableR = radius * p.tableRatio;

	// Outline point at azimuth i (may be fractional) and radial scale s.
	const outline = ( i: number, s: number ): Vec3 => {

		const a = ( i / N ) * Math.PI * 2;
		let x = Math.cos( a ), z = Math.sin( a );
		if ( p.stepCut ) {

			// Round a square into a chamfered octagon.
			const m = Math.max( Math.abs( x ), Math.abs( z ) ) || 1;
			const k = 0.62;
			const cx = x * ( 1 - k ) + Math.sign( x ) * k * Math.abs( x ) / m;
			const cz = z * ( 1 - k ) + Math.sign( z ) * k * Math.abs( z ) / m;
			const l = Math.max( Math.abs( cx ), Math.abs( cz ) ) || 1;
			x = cx / l;
			z = cz / l;

		}

		// Slight oval squash is applied through widthScale; keep X as the long axis.
		return [ x * radius * s, 0, z * radius * s * sz ];

	};

	// Girdle: two rings so the girdle band has thickness and a crisp edge.
	const girdleTop: number[] = [];
	const girdleBot: number[] = [];
	for ( let i = 0; i < N; i ++ ) {

		const o = outline( i, 1.0 );
		girdleTop.push( addVertex( g, [ o[ 0 ], 0.004 * radius, o[ 2 ] ] ) );
		girdleBot.push( addVertex( g, [ o[ 0 ], - 0.004 * radius, o[ 2 ] ] ) );

	}

	for ( let i = 0; i < N; i ++ ) {

		const j = ( i + 1 ) % N;
		addQuad( g, girdleBot[ i ], girdleBot[ j ], girdleTop[ j ], girdleTop[ i ] );

	}

	// ---- crown ----
	const tableRing: number[] = [];
	if ( p.stepCut ) {

		// Step cut: concentric bevels from the girdle up to the table.
		let prev = girdleTop;
		const rings: number[][] = [];
		for ( let s = 1; s <= p.stepCount; s ++ ) {

			const t = s / p.stepCount;
			const rScale = 1.0 - ( 1.0 - p.tableRatio ) * t;
			const y = crownY * t;
			const ring: number[] = [];
			for ( let i = 0; i < N; i ++ ) {

				const o = outline( i, rScale );
				ring.push( addVertex( g, [ o[ 0 ], y, o[ 2 ] ] ) );

			}

			rings.push( ring );

		}

		for ( const ring of rings ) {

			for ( let i = 0; i < N; i ++ ) {

				const j = ( i + 1 ) % N;
				addQuad( g, prev[ i ], prev[ j ], ring[ j ], ring[ i ] );

			}

			prev = ring;

		}

		for ( let i = 0; i < N; i ++ ) tableRing.push( prev[ i ] );

	} else {

		// Brilliant crown: bezel facets alternate high/low around the girdle,
		// meeting a star ring, then the table.
		const starRing: number[] = [];
		for ( let i = 0; i < N; i ++ ) {

			const o = outline( i + 0.5, ( 1.0 + p.tableRatio ) * 0.5 );
			starRing.push( addVertex( g, [ o[ 0 ], crownY * 0.52, o[ 2 ] ] ) );

		}

		for ( let i = 0; i < N; i ++ ) {

			const o = outline( i, p.tableRatio );
			tableRing.push( addVertex( g, [ o[ 0 ], crownY, o[ 2 ] ] ) );

		}

		for ( let i = 0; i < N; i ++ ) {

			const j = ( i + 1 ) % N;
			// Bezel kite (girdle i -> girdle j -> table i).
			addTri( g, girdleTop[ i ], girdleTop[ j ], starRing[ i ] );
			addTri( g, girdleTop[ j ], starRing[ j ], starRing[ i ] );
			// Star facets up to the table.
			addTri( g, starRing[ i ], starRing[ j ], tableRing[ j ] );
			addTri( g, starRing[ i ], tableRing[ j ], tableRing[ i ] );

		}

	}

	// ---- table ----
	const tableCenter = addVertex( g, [ 0, crownY, 0 ] );
	for ( let i = 0; i < N; i ++ ) {

		const j = ( i + 1 ) % N;
		addTri( g, tableRing[ i ], tableRing[ j ], tableCenter );

	}

	// ---- pavilion ----
	const culet = addVertex( g, [ 0, pavY, 0 ] );
	if ( p.stepCut ) {

		let prev = girdleBot;
		const steps = p.stepCount;
		for ( let s = 1; s <= steps; s ++ ) {

			const t = s / steps;
			const rScale = Math.max( 0.12, 1.0 - t * 0.7 );
			const y = pavY * t * 0.85;
			const ring: number[] = [];
			for ( let i = 0; i < N; i ++ ) {

				const o = outline( i, rScale );
				ring.push( addVertex( g, [ o[ 0 ], y, o[ 2 ] ] ) );

			}

			for ( let i = 0; i < N; i ++ ) {

				const j = ( i + 1 ) % N;
				addQuad( g, prev[ i ], prev[ j ], ring[ j ], ring[ i ] );

			}

			prev = ring;

		}

		for ( let i = 0; i < N; i ++ ) {

			const j = ( i + 1 ) % N;
			addTri( g, prev[ i ], prev[ j ], culet );

		}

	} else {

		// Brilliant pavilion: mains to the culet plus a mid girdle ring.
		const midPav: number[] = [];
		for ( let i = 0; i < N; i ++ ) {

			const o = outline( i + 0.5, 0.46 );
			midPav.push( addVertex( g, [ o[ 0 ], pavY * 0.52, o[ 2 ] ] ) );

		}

		for ( let i = 0; i < N; i ++ ) {

			const j = ( i + 1 ) % N;
			addTri( g, girdleBot[ i ], girdleBot[ j ], midPav[ i ] );
			addTri( g, girdleBot[ j ], midPav[ j ], midPav[ i ] );
			addTri( g, midPav[ i ], midPav[ j ], culet );

		}

	}

	return g;

}

// ---------------------------------------------------------------------------
// Ring assembly.
// ---------------------------------------------------------------------------

// Band proportions are authored against a nominal 0.34 finger radius; the app
// rescales the whole rig by (real radius / nominal) so it fits any finger.
const FINGER_RADIUS = 0.34;
const BAND_WIDTH = 0.115;
const BAND_THICKNESS = 0.05;
const GEM_RADIUS = 0.155;
const GEM_CUT: GemCut = 'round';

const bandR = FINGER_RADIUS + BAND_THICKNESS * 0.5;
const gemProfileP = CUTS[ GEM_CUT ];
const pavDepth = GEM_RADIUS * gemProfileP.pavillionDepth;

// The gem sits in a raised head on the band's crest. `HEAD_LIFT` is how far
// the girdle rises above the band's outer surface; the pavilion must clear it.
const HEAD_LIFT = GEM_RADIUS * 1.25;
const GIRDLE_Z = bandR + BAND_THICKNESS * 0.5 + HEAD_LIFT;
const GIRDLE_Y = 0;

const band = newGeo();

// Shank: square-ish cross-section, softly bevelled so highlights run cleanly.
const shankProfile: Array<[number, number]> = [];
const shankCorners = 32;
for ( let i = 0; i < shankCorners; i ++ ) {

	const t = ( i / shankCorners ) * Math.PI * 2;
	const c = Math.cos( t ), s = Math.sin( t );
	const e = 0.62;
	const rx = Math.sign( c ) * Math.pow( Math.abs( c ), e );
	const ry = Math.sign( s ) * Math.pow( Math.abs( s ), e );
	shankProfile.push( [ rx * BAND_THICKNESS * 0.5, ry * BAND_WIDTH * 0.5 ] );

}

sweepAroundY( band, bandR, shankProfile, 160 );

const crestZ = bandR + BAND_THICKNESS * 0.5;
// Open solitaire head: a girdle rail, four prongs and two shoulders. The
// pavilion hangs in air between them, which is what lets light into the stone
// — a closed cup makes the middle of the stone go black.
const railZ = GIRDLE_Z - GEM_RADIUS * 0.1;
const railR = GEM_RADIUS * 0.72;

// Girdle rail: a thin collar the pavilion drops through.
sweepRing( band, [ 0, 0, railZ ], [ 0, 0, 1 ], railR, BAND_THICKNESS * 0.2, 56, 10 );

// Shoulders: from the shank's crest to the rail, hugging the band so the ring
// reads as one piece of metal.
for ( const side of [ - 1, 1 ] ) {

	const p0: Vec3 = [ side * BAND_WIDTH * 0.62, 0, crestZ - BAND_THICKNESS * 0.55 ];
	const p1: Vec3 = [ side * BAND_WIDTH * 0.9, 0, crestZ + ( railZ - crestZ ) * 0.5 ];
	const p2: Vec3 = [ side * railR * 0.86, 0, railZ - BAND_THICKNESS * 0.2 ];
	const curve: Vec3[] = [];
	const radii: number[] = [];
	for ( let i = 0; i <= 10; i ++ ) {

		const t = i / 10;
		const a = ( 1 - t ) * ( 1 - t ), b = 2 * ( 1 - t ) * t, c = t * t;
		curve.push( [
			a * p0[ 0 ] + b * p1[ 0 ] + c * p2[ 0 ],
			a * p0[ 1 ] + b * p1[ 1 ] + c * p2[ 1 ],
			a * p0[ 2 ] + b * p1[ 2 ] + c * p2[ 2 ]
		] );
		radii.push( BAND_THICKNESS * ( 0.5 - 0.24 * t ) );

	}

	sweepTube( band, curve, radii, 14, [ 0, 1, 0 ] );

}

// Four prongs: rise from the rail, then lean in over the girdle.
for ( let k = 0; k < 4; k ++ ) {

	const a = ( k / 4 ) * Math.PI * 2 + Math.PI * 0.25;
	const ca = Math.cos( a ), sa = Math.sin( a );
	const r0 = railR;
	const r1 = GEM_RADIUS * 1.02;
	const p0: Vec3 = [ ca * r0, sa * r0, railZ - BAND_THICKNESS * 0.1 ];
	const p1: Vec3 = [ ca * r1, sa * r1, GIRDLE_Z + GEM_RADIUS * 0.02 ];
	const p2: Vec3 = [ ca * r1 * 0.93, sa * r1 * 0.93, GIRDLE_Z + GEM_RADIUS * 0.17 ];
	sweepTube( band, [ p0, p1, p2 ], [ BAND_THICKNESS * 0.3, BAND_THICKNESS * 0.2, BAND_THICKNESS * 0.1 ], 10, [ 0, 0, 1 ] );

}

// Culet strut: a slim V under the stone, joining the rail to the pavilion tip.
const culetZ = GIRDLE_Z - GEM_RADIUS * gemProfileP.pavillionDepth;
for ( const side of [ - 1, 1 ] ) {

	sweepTube(
		band,
		[ [ side * railR * 0.5, 0, railZ - BAND_THICKNESS * 0.18 ], [ side * GEM_RADIUS * 0.16, 0, culetZ + GEM_RADIUS * 0.06 ] ],
		[ BAND_THICKNESS * 0.15, BAND_THICKNESS * 0.1 ],
		8,
		[ 0, 1, 0 ]
	);

}

const gemGeo = buildGem( GEM_CUT, GEM_RADIUS );
// Rotate the gem's table normal from +Y to +Z.
const rotGem = ( v: Vec3 ): Vec3 => [ v[ 0 ], - v[ 2 ], v[ 1 ] ];
for ( let i = 0; i < gemGeo.positions.length; i += 3 ) {

	const q = rotGem( [ gemGeo.positions[ i ], gemGeo.positions[ i + 1 ], gemGeo.positions[ i + 2 ] ] );
	gemGeo.positions[ i ] = q[ 0 ];
	gemGeo.positions[ i + 1 ] = q[ 1 ];
	gemGeo.positions[ i + 2 ] = q[ 2 ] + GIRDLE_Z;

}

const bandFinal = finalizeSmooth( band );
const gemFinal = finalizeFlat( gemGeo );

mkdirSync( resolve( root, 'public/models' ), { recursive: true } );
const glb = writeMultiMeshGlb(
	[
		{ name: 'band', ...bandFinal, material: 0 },
		{ name: 'gem', ...gemFinal, material: 1 }
	],
	[
		{ name: 'band', pbrMetallicRoughness: { baseColorFactor: [ 1.0, 0.8, 0.44, 1 ], metallicFactor: 1, roughnessFactor: 0.16 } },
		{ name: 'gem', pbrMetallicRoughness: { baseColorFactor: [ 1, 1, 1, 1 ], metallicFactor: 0, roughnessFactor: 0.02 } }
	]
);

writeFileSync( resolve( root, 'public/models/ring.glb' ), glb );
writeFileSync(
	resolve( root, 'public/models/ring.json' ),
	JSON.stringify( {
		model: 'ring.glb',
		band: 'band',
		gem: 'gem',
		girdleZ: GIRDLE_Z,
		gemRadius: GEM_RADIUS,
		// Nominal finger the band was authored for; the app scales from this.
		fingerRadius: FINGER_RADIUS,
		bandWidth: BAND_WIDTH,
		// Where the ring's head points in model space (+Z) and how far the
		// band's outer surface is from the finger axis.
		bandOuterRadius: bandR + BAND_THICKNESS * 0.5
	}, null, 2 )
);

console.log( `ring.glb: ${ ( glb.byteLength / 1024 ).toFixed( 1 ) } KB, band ${ bandFinal.indices.length / 3 } tris, gem ${ gemFinal.indices.length / 3 } tris` );
console.log( `girdle at z=${ GIRDLE_Z.toFixed( 3 ) }, gem r=${ GEM_RADIUS }, band inner r=${ ( bandR - BAND_THICKNESS * 0.5 ).toFixed( 3 ) }` );

// ---------------------------------------------------------------------------
// Multi-mesh GLB writer.
// ---------------------------------------------------------------------------

interface MeshSpec {
	name: string;
	positions: Float32Array;
	normals: Float32Array;
	indices: Uint32Array;
	material: number;
}

function writeMultiMeshGlb( meshes: MeshSpec[], materials: object[] ): Uint8Array {

	const chunks: Uint8Array[] = [];
	let offset = 0;
	const bufferViews: object[] = [];
	const accessors: object[] = [];
	const align = ( n: number ) => ( 4 - ( n % 4 ) ) % 4;

	for ( const m of meshes ) {

		const posBytes = new Uint8Array( m.positions.buffer, m.positions.byteOffset, m.positions.byteLength );
		const normBytes = new Uint8Array( m.normals.buffer, m.normals.byteOffset, m.normals.byteLength );
		const idxBytes = new Uint8Array( m.indices.buffer, m.indices.byteOffset, m.indices.byteLength );

		const min = [ Infinity, Infinity, Infinity ];
		const max = [ - Infinity, - Infinity, - Infinity ];
		for ( let i = 0; i < m.positions.length; i += 3 ) {

			for ( let c = 0; c < 3; c ++ ) {

				min[ c ] = Math.min( min[ c ], m.positions[ i + c ] );
				max[ c ] = Math.max( max[ c ], m.positions[ i + c ] );

			}

		}

		const base = accessors.length;

		bufferViews.push( { buffer: 0, byteOffset: offset, byteLength: posBytes.byteLength, target: 34962 } );
		accessors.push( {
			bufferView: bufferViews.length - 1,
			componentType: 5126,
			count: m.positions.length / 3,
			type: 'VEC3',
			min: min.map( ( v ) => Number( v.toFixed( 6 ) ) ),
			max: max.map( ( v ) => Number( v.toFixed( 6 ) ) )
		} );
		chunks.push( posBytes );
		offset += posBytes.byteLength;
		let pad = align( offset );
		if ( pad ) {

			chunks.push( new Uint8Array( pad ) );
			offset += pad;

		}

		bufferViews.push( { buffer: 0, byteOffset: offset, byteLength: normBytes.byteLength, target: 34962 } );
		accessors.push( { bufferView: bufferViews.length - 1, componentType: 5126, count: m.normals.length / 3, type: 'VEC3' } );
		chunks.push( normBytes );
		offset += normBytes.byteLength;
		pad = align( offset );
		if ( pad ) {

			chunks.push( new Uint8Array( pad ) );
			offset += pad;

		}

		bufferViews.push( { buffer: 0, byteOffset: offset, byteLength: idxBytes.byteLength, target: 34963 } );
		accessors.push( { bufferView: bufferViews.length - 1, componentType: 5125, count: m.indices.length, type: 'SCALAR' } );
		chunks.push( idxBytes );
		offset += idxBytes.byteLength;
		pad = align( offset );
		if ( pad ) {

			chunks.push( new Uint8Array( pad ) );
			offset += pad;

		}

		m.accessorBase = base;

	}

	const bin = new Uint8Array( offset );
	let p = 0;
	for ( const c of chunks ) {

		bin.set( c, p );
		p += c.byteLength;

	}

	const gltf = {
		asset: { version: '2.0', generator: 'jewelry-tryon ring pipeline' },
		scene: 0,
		scenes: [ { name: 'Ring', nodes: meshes.map( ( _m, i ) => i ) } ],
		nodes: meshes.map( ( m, i ) => ( { name: m.name, mesh: i } ) ),
		meshes: meshes.map( ( m, i ) => ( {
			name: m.name,
			primitives: [ { attributes: { POSITION: m.accessorBase, NORMAL: m.accessorBase + 1 }, indices: m.accessorBase + 2, material: m.material, mode: 4 } ]
		} ) ),
		materials,
		accessors,
		bufferViews,
		buffers: [ { byteLength: offset } ]
	};

	const jsonRaw = new TextEncoder().encode( JSON.stringify( gltf ) );
	const jsonPad = align( jsonRaw.byteLength );
	const jsonLen = jsonRaw.byteLength + jsonPad;
	const total = 12 + 8 + jsonLen + 8 + offset;
	const out = new Uint8Array( total );
	const dv = new DataView( out.buffer );
	dv.setUint32( 0, 0x46546c67, true );
	dv.setUint32( 4, 2, true );
	dv.setUint32( 8, total, true );
	dv.setUint32( 12, jsonLen, true );
	dv.setUint32( 16, 0x4e4f534a, true );
	out.set( jsonRaw, 20 );
	for ( let i = jsonRaw.byteLength; i < jsonLen; i ++ ) out[ 20 + i ] = 0x20;
	const q = 20 + jsonLen;
	dv.setUint32( q, offset, true );
	dv.setUint32( q + 4, 0x004e4942, true );
	out.set( bin, q + 8 );
	return out;

}

// `accessorBase` is attached dynamically to each mesh spec.
interface MeshSpec {
	accessorBase?: number;
}

/**
 * Revolves a closed 2D profile (r, z) around the Z axis to make a solid of
 * revolution. Used for the basket: a metal cup with a bottom and an open top
 * that the stone sits in.
 */
function revolveZ( g: Geo, profile: Array<[number, number]>, segments = 72 ) {

	const rings: number[][] = [];
	for ( let s = 0; s < segments; s ++ ) {

		const a = ( s / segments ) * Math.PI * 2;
		const ca = Math.cos( a ), sa = Math.sin( a );
		const ring: number[] = [];
		for ( const [ r, z ] of profile ) ring.push( addVertex( g, [ ca * r, sa * r, z ] ) );
		rings.push( ring );

	}

	const m = profile.length;
	for ( let s = 0; s < segments; s ++ ) {

		const A = rings[ s ];
		const B = rings[ ( s + 1 ) % segments ];
		for ( let i = 0; i < m; i ++ ) {

			const j = ( i + 1 ) % m;
			addQuad( g, A[ i ], B[ i ], B[ j ], A[ j ] );

		}

	}

}
