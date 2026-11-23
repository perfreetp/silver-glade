/**
 * Studio environment: a set of emissive panels inside a dark shell, prefiltered
 * with PMREM. Unlike a generic room, it gives metals long strip highlights and
 * lets a gem catch a few bright edges — which is what makes dispersion visible.
 */
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';

interface PanelSpec {
	w: number;
	h: number;
	intensity: number;
	pos: [number, number, number];
	tint: [number, number, number];
}

const PANELS: PanelSpec[] = [
	// Big top softbox.
	{ w: 9, h: 9, intensity: 5.0, pos: [ 0, 7, 1 ], tint: [ 1, 0.97, 0.92 ] },
	// Two tall strip lights, the classic jewellery highlight.
	{ w: 1.3, h: 9, intensity: 7.5, pos: [ - 6, 2, 2 ], tint: [ 0.92, 0.96, 1 ] },
	{ w: 1.0, h: 8, intensity: 5.5, pos: [ 6, 1, - 1 ], tint: [ 1, 0.96, 0.9 ] },
	// Low warm bounce so pavilion facets pick up skin-like warmth.
	{ w: 5, h: 2, intensity: 1.6, pos: [ 0, - 3, 5 ], tint: [ 1, 0.85, 0.7 ] },
	// Cool kicker behind the subject.
	{ w: 4, h: 4, intensity: 2.4, pos: [ 2, 2, - 7 ], tint: [ 0.72, 0.84, 1 ] },
	// Small hard source for pinpoint fire.
	{ w: 0.8, h: 0.8, intensity: 26, pos: [ 3.2, 4.2, 3.4 ], tint: [ 1, 1, 1 ] }
];

export function createStudioEnvironment(): THREE.Scene {
	const scene = new THREE.Scene();

	const shellMat = new THREE.MeshBasicNodeMaterial( { side: THREE.BackSide } );
	shellMat.colorNode = vec3( 0.010, 0.011, 0.014 );
	scene.add( new THREE.Mesh( new THREE.SphereGeometry( 30, 32, 16 ), shellMat ) );

	for ( const p of PANELS ) {

		const mat = new THREE.MeshBasicNodeMaterial();
		mat.colorNode = vec3( p.tint[ 0 ] * p.intensity, p.tint[ 1 ] * p.intensity, p.tint[ 2 ] * p.intensity );
		const mesh = new THREE.Mesh( new THREE.PlaneGeometry( p.w, p.h ), mat );
		mesh.position.set( ...p.pos );
		mesh.lookAt( 0, 0, 0 );
		scene.add( mesh );

	}

	return scene;
}
