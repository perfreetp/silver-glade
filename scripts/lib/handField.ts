/**
 * The hand's signed distance field and finger chains. Shared by the asset
 * builder and the diagnostic tools so they always agree.
 */
import {
	add,
	cross,
	norm,
	rotZ,
	sdEllipsoid,
	sdRoundBox,
	sdRoundCone,
	sdSphere,
	smax,
	smin,
	type Vec3
} from './sdf.ts';

// ---------------------------------------------------------------------------
// Finger chains: tapered capsules with progressive curl toward the palm (-Z).
// ---------------------------------------------------------------------------

interface Phalanx {
	a: Vec3;
	b: Vec3;
	ra: number;
	rb: number;
}

interface FingerSpec {
	name: string;
	baseX: number;
	baseY: number;
	baseZ: number;
	fan: number;
	phalanx: Array<{ len: number; r0: number; r1: number; bend: number }>;
}

const FINGERS: FingerSpec[] = [
	{
		name: 'index',
		baseX: - 1.03,
		baseY: 1.24,
		baseZ: - 0.03,
		fan: 0.07,
		phalanx: [
			{ len: 0.83, r0: 0.264, r1: 0.246, bend: 0.09 },
			{ len: 0.52, r0: 0.246, r1: 0.224, bend: 0.18 },
			{ len: 0.36, r0: 0.224, r1: 0.176, bend: 0.2 }
		]
	},
	{
		name: 'middle',
		baseX: - 0.35,
		baseY: 1.3,
		baseZ: 0.02,
		fan: 0.01,
		phalanx: [
			{ len: 0.91, r0: 0.277, r1: 0.260, bend: 0.1 },
			{ len: 0.57, r0: 0.260, r1: 0.238, bend: 0.19 },
			{ len: 0.39, r0: 0.238, r1: 0.185, bend: 0.21 }
		]
	},
	{
		name: 'ring',
		baseX: 0.33,
		baseY: 1.28,
		baseZ: - 0.005,
		fan: - 0.035,
		phalanx: [
			{ len: 0.86, r0: 0.264, r1: 0.246, bend: 0.03 },
			{ len: 0.55, r0: 0.246, r1: 0.224, bend: 0.17 },
			{ len: 0.37, r0: 0.224, r1: 0.176, bend: 0.19 }
		]
	},
	{
		name: 'little',
		baseX: 0.97,
		baseY: 1.21,
		baseZ: - 0.04,
		fan: - 0.11,
		phalanx: [
			{ len: 0.67, r0: 0.224, r1: 0.207, bend: 0.12 },
			{ len: 0.44, r0: 0.207, r1: 0.185, bend: 0.2 },
			{ len: 0.3, r0: 0.185, r1: 0.150, bend: 0.22 }
		]
	}
];

const KNUCKLE_Y = 1.22;

function buildChains() {
	const result = new Map<string, { phalanx: Phalanx[]; joints: Vec3[] }>();
	for ( const f of FINGERS ) {

		const phalanx: Phalanx[] = [];
		const joints: Vec3[] = [];
		let cursor: Vec3 = [ f.baseX, f.baseY, f.baseZ ];
		let angle = 0;
		joints.push( cursor );
		for ( const seg of f.phalanx ) {

			angle += seg.bend;
			const dir: Vec3 = [
				Math.sin( f.fan ) * Math.cos( angle ),
				Math.cos( angle ) * Math.cos( Math.abs( f.fan ) * 0.6 ),
				- Math.sin( angle )
			];
			const next: Vec3 = add( cursor, [ dir[ 0 ] * seg.len, dir[ 1 ] * seg.len, dir[ 2 ] * seg.len ] );
			phalanx.push( { a: cursor, b: next, ra: seg.r0, rb: seg.r1 } );
			joints.push( next );
			cursor = next;

		}

		result.set( f.name, { phalanx, joints } );

	}

	return result;
}

const chains = buildChains();

// ---------------------------------------------------------------------------
// Thumb chain, rooted at the -X side of the palm.
// ---------------------------------------------------------------------------

const THUMB: Phalanx[] = [
	{ a: [ - 1.0, - 0.38, 0.2 ], b: [ - 1.6, 0.1, 0.24 ], ra: 0.33, rb: 0.28 },
	{ a: [ - 1.6, 0.1, 0.24 ], b: [ - 1.74, 0.62, - 0.2 ], ra: 0.28, rb: 0.225 }
];

// ---------------------------------------------------------------------------
// Signed distance field.
// ---------------------------------------------------------------------------

function handSDF( x: number, y: number, z: number ): number {
	const p: Vec3 = [ x, y, z ];

	// Palm core: boxy but tapered, narrower at the wrist.
	const palm = sdRoundBox( p, 0, 0.08, 0.0, 1.1, 0.96, 0.32, 0.3 );
	const palmUpper = sdEllipsoid( p, [ 0, 0.64, 0.0 ], [ 1.22, 0.78, 0.35 ] );
	const palmLower = sdRoundBox( p, 0, - 0.72, 0.02, 0.82, 0.5, 0.28, 0.29 );

	// Thenar / hypothenar pads give the palm volume instead of a slab look.
	const thenar = sdEllipsoid( p, [ - 0.5, - 0.34, 0.12 ], [ 0.66, 0.82, 0.24 ] );
	const hypothenar = sdEllipsoid( p, [ 0.56, - 0.5, 0.09 ], [ 0.5, 0.72, 0.22 ] );

	// Wrist tapering into a short forearm stub.
	const wrist = sdRoundCone( p, [ 0, - 1.3, 0.03 ], [ 0, - 1.66, 0.03 ], 0.72, 0.68 );
	const arm = sdRoundCone( p, [ 0, - 1.64, 0.03 ], [ 0, - 2.6, 0.05 ], 0.68, 0.82 );

	let d = smin( palm, palmUpper, 0.55 );
	d = smin( d, palmLower, 0.55 );
	d = smin( d, thenar, 0.55 );
	d = smin( d, hypothenar, 0.55 );
	d = smin( d, wrist, 0.42 );
	d = smin( d, arm, 0.5 );

	// Knuckle ridge across the back of the hand.
	for ( const f of FINGERS ) {

		const k = sdSphere( p, [ f.baseX, KNUCKLE_Y - 0.12, f.baseZ + 0.02 ], 0.235 );
		d = smin( d, k, 0.3 );

	}

	// Fingers: proximal joints weld into the palm, IP joints stay crisper.
	for ( const f of FINGERS ) {

		const chain = chains.get( f.name )!;
		for ( let i = 0; i < chain.phalanx.length; i ++ ) {

			const ph = chain.phalanx[ i ];
			d = smin( d, sdRoundCone( p, ph.a, ph.b, ph.ra, ph.rb ), i === 0 ? 0.26 : 0.13 );

		}

		// Rounded fingertip with a soft pad.
		const tip = chain.joints[ chain.joints.length - 1 ];
		const last = chain.phalanx[ chain.phalanx.length - 1 ];
		const tipDir = [ last.b[ 0 ] - last.a[ 0 ], last.b[ 1 ] - last.a[ 1 ], last.b[ 2 ] - last.a[ 2 ] ];
		const tipLen = Math.hypot( tipDir[ 0 ], tipDir[ 1 ], tipDir[ 2 ] ) || 1;
		const tdir = [ tipDir[ 0 ] / tipLen, tipDir[ 1 ] / tipLen, tipDir[ 2 ] / tipLen ];
		const capC: Vec3 = [ tip[ 0 ] + tdir[ 0 ] * 0.08, tip[ 1 ] + tdir[ 1 ] * 0.08, tip[ 2 ] + tdir[ 2 ] * 0.08 ];
		d = smin( d, sdEllipsoid( p, capC, [ last.rb * 0.99, last.rb * 1.12, last.rb * 0.97 ] ), 0.06 );

	}

	// Thumb.
	d = smin( d, sdRoundCone( p, THUMB[ 0 ].a, THUMB[ 0 ].b, THUMB[ 0 ].ra, THUMB[ 0 ].rb ), 0.34 );
	d = smin( d, sdRoundCone( p, THUMB[ 1 ].a, THUMB[ 1 ].b, THUMB[ 1 ].ra, THUMB[ 1 ].rb ), 0.1 );
	d = smin( d, sdEllipsoid( p, [ - 0.78, - 0.4, 0.14 ], [ 0.36, 0.42, 0.22 ] ), 0.34 );
	const thumbTip = THUMB[ 1 ].b;
	d = smin( d, sdEllipsoid( p, [ thumbTip[ 0 ], thumbTip[ 1 ] + 0.03, thumbTip[ 2 ] - 0.03 ], [ 0.235, 0.25, 0.225 ] ), 0.1 );

	// Palm creases: heart line, head line, life line (soft).
	const heart = sdRoundBox( [ x, y - 0.42, z - 0.3 ], 0, 0, 0, 0.78, 0.05, 0.05, 0.04 );
	d = smax( d, - heart, 0.16 );
	const head = sdRoundBox( [ x - 0.02, y + 0.86, z - 0.29 ], 0, 0, 0, 0.7, 0.045, 0.05, 0.04 );
	d = smax( d, - head, 0.16 );

	// Wrist crease.
	d = smax( d, - sdRoundBox( p, 0.0, - 1.28, - 0.24, 0.5, 0.06, 0.1, 0.05 ), 0.14 );

	// Trim the forearm stub.
	d = Math.max( d, - ( y + 2.45 ) );

	return d;
}


export { FINGERS, KNUCKLE_Y, THUMB, chains, handSDF };
export type { Phalanx, FingerSpec };
