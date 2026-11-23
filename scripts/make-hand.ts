/**
 * Procedural right-hand model, sculpted as a signed distance field and
 * polygonized with marching cubes. Produces:
 *   public/models/hand.glb   – indexed mesh (POSITION, NORMAL)
 *   public/models/hand.json  – ring-placement hints (finger axis, radius)
 *
 * Pose: relaxed right hand seen from the back, palm facing away (-Z), thumb on
 * the -X side, fingers gently curling toward the palm. The ring finger is
 * extra straight so a band sits naturally on its proximal phalanx.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cross, lerp, norm, type Vec3 } from './lib/sdf.ts';
import { FINGERS, THUMB, chains, handSDF, type Phalanx } from './lib/handField.ts';
import { bakeVertexAO, dropDegenerate, fillHoles, gradientNormals, orientTriangles, polygonize, projectToSurface, reorientBySDF, taubinSmooth } from './lib/marching.ts';
import { writeGlb } from './lib/glb.ts';

const here = dirname( fileURLToPath( import.meta.url ) );
const root = resolve( here, '..' );

// ---------------------------------------------------------------------------
// Build the mesh.
// ---------------------------------------------------------------------------

const CELL = 0.04;
const origin: [number, number, number] = [ - 2.3, - 2.6, - 0.9 ];
const size: [number, number, number] = [ 4.6, 6.4, 1.8 ];

console.time( 'sample+polygonize' );
const mesh = polygonize( { value: handSDF, origin, size, cell: CELL } );
console.timeEnd( 'sample+polygonize' );

orientTriangles( mesh.positions, mesh.normals, mesh.indices );
console.time( 'smooth' );
mesh.positions = taubinSmooth( mesh.positions, mesh.indices, 14, 0.55, - 0.58 );
mesh.positions = projectToSurface( mesh.positions, handSDF, CELL * 0.4 );
mesh.normals = gradientNormals( mesh.positions, handSDF, CELL * 0.3 );
console.timeEnd( 'smooth' );
const patched = fillHoles( mesh.positions, mesh.normals, mesh.indices );
if ( patched.positions.length !== mesh.positions.length ) {

	console.log( `hole fill: +${ ( patched.positions.length - mesh.positions.length ) / 3 } verts` );

}

mesh.positions = patched.positions;
mesh.normals = patched.normals;
mesh.indices = patched.indices;
mesh.indices = dropDegenerate( mesh.positions, mesh.indices );
reorientBySDF( mesh.positions, mesh.indices, handSDF, CELL * 0.3 );
mesh.normals = gradientNormals( mesh.positions, handSDF, CELL * 0.3 );

console.time( 'bake AO' );
const ao = bakeVertexAO( mesh.positions, mesh.normals, handSDF, 0.55 );
console.timeEnd( 'bake AO' );
const colors = new Float32Array( ao.length * 3 );
for ( let i = 0; i < ao.length; i ++ ) {

	// Store AO in all three channels; the shader uses it as an occlusion mask.
	// Keep a little warm bounce in the crevices instead of pure black.
	const v = 0.55 + Math.pow( ao[ i ], 0.9 ) * 0.45;
	colors[ i * 3 ] = v;
	colors[ i * 3 + 1 ] = v * 0.985;
	colors[ i * 3 + 2 ] = v * 0.97;

}

// Recenter: keep palms around the origin, fingers up.
const centroid = new Float32Array( 3 );
for ( let i = 0; i < mesh.positions.length; i += 3 ) {

	centroid[ 0 ] += mesh.positions[ i ];
	centroid[ 1 ] += mesh.positions[ i + 1 ];
	centroid[ 2 ] += mesh.positions[ i + 2 ];

}

const count = mesh.positions.length / 3;
centroid[ 0 ] /= count;
centroid[ 1 ] /= count;
centroid[ 2 ] /= count;

const SHIFT: [number, number, number] = [ - centroid[ 0 ], - centroid[ 1 ] * 0.55, - centroid[ 2 ] ];
for ( let i = 0; i < mesh.positions.length; i += 3 ) {

	mesh.positions[ i ] += SHIFT[ 0 ];
	mesh.positions[ i + 1 ] += SHIFT[ 1 ];
	mesh.positions[ i + 2 ] += SHIFT[ 2 ];

}

// ---------------------------------------------------------------------------
// Ring seat: a point on the ring finger's proximal phalanx.
// ---------------------------------------------------------------------------

const ringChain = chains.get( 'ring' )!;
const proximal = ringChain.phalanx[ 0 ];
const ringPoint = lerp( proximal.a, proximal.b, 0.42 );
const axis = [ proximal.b[ 0 ] - proximal.a[ 0 ], proximal.b[ 1 ] - proximal.a[ 1 ], proximal.b[ 2 ] - proximal.a[ 2 ] ];
const axisLen = Math.hypot( axis[ 0 ], axis[ 1 ], axis[ 2 ] );
const axisN = [ axis[ 0 ] / axisLen, axis[ 1 ] / axisLen, axis[ 2 ] / axisLen ];
// Measure the finger's cross-section from the SDF itself: march outward from
// the axis in many directions and record where the surface is. A percentile
// (rather than the max) keeps a knuckle bulge from inflating the band.
const seatPoint = lerp( proximal.a, proximal.b, 0.42 );
const dirA = norm( cross( axisN, [ 0, 1, 0 ] ) ) ?? [ 1, 0, 0 ];
const dirB = cross( axisN, dirA );
const sectionRadii: number[] = [];
for ( let k = 0; k < 24; k ++ ) {

	const ang = ( k / 24 ) * Math.PI * 2;
	const dx = dirA[ 0 ] * Math.cos( ang ) + dirB[ 0 ] * Math.sin( ang );
	const dy = dirA[ 1 ] * Math.cos( ang ) + dirB[ 1 ] * Math.sin( ang );
	const dz = dirA[ 2 ] * Math.cos( ang ) + dirB[ 2 ] * Math.sin( ang );
	let hit = 0;
	for ( let t = 0.05; t < 0.8; t += 0.005 ) {

		const v = handSDF( seatPoint[ 0 ] + dx * t, seatPoint[ 1 ] + dy * t, seatPoint[ 2 ] + dz * t );
		if ( v >= 0 ) {

			hit = t;
			break;

		}

	}

	if ( hit > 0 ) sectionRadii.push( hit );

}

// The band must clear the finger's widest direction (fingers are elliptical,
// wider across than deep), so use the maximum sane radius, not an average.
const sane = sectionRadii.filter( ( r ) => r < 0.5 );
const fingerRadius = sane.length > 0 ? Math.max( ...sane ) : proximal.ra;

const handJson = {
	model: 'hand.glb',
	name: 'relaxed-right-hand',
	generator: 'sdf-marching-cubes',
	ringSeat: {
		center: [ ringPoint[ 0 ] + SHIFT[ 0 ], ringPoint[ 1 ] + SHIFT[ 1 ], ringPoint[ 2 ] + SHIFT[ 2 ] ],
		axis: axisN,
		fingerRadius,
		finger: 'ring',
		proximalLength: axisLen
	},
	fingers: Object.fromEntries(
		[ ...chains.entries() ].map( ( [ name, c ] ) => [
			name,
			{
				joints: c.joints.map( ( j ) => [ j[ 0 ] + SHIFT[ 0 ], j[ 1 ] + SHIFT[ 1 ], j[ 2 ] + SHIFT[ 2 ] ] ),
				radius: c.phalanx[ 0 ].ra
			}
		] )
	)
};

mkdirSync( resolve( root, 'public/models' ), { recursive: true } );
const glb = writeGlb( { name: 'hand', positions: mesh.positions, normals: mesh.normals, indices: mesh.indices, colors } );
writeFileSync( resolve( root, 'public/models/hand.glb' ), glb );
writeFileSync( resolve( root, 'public/models/hand.json' ), JSON.stringify( handJson, null, 2 ) );

console.log( `hand.glb: ${ ( glb.byteLength / 1024 ).toFixed( 1 ) } KB, ${ count } verts, ${ mesh.indices.length / 3 } tris` );
console.log( `ring seat: ${ handJson.ringSeat.center.map( ( n ) => n.toFixed( 3 ) ).join( ', ' ) } r=${ fingerRadius.toFixed( 3 ) }` );
