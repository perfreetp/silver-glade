/**
 * RingGizmo: positions the ring on a finger with a fully explicit frame.
 *
 * The ring model is authored with the finger along +Y and the head (stone) on
 * +Z. A quaternion built from "align +Y to the finger" leaves the head's
 * rotation around the finger undefined, so the stone can end up edge-on. Here
 * the frame is defined by two vectors instead:
 *
 *   +Y = finger axis             (the band wraps around this)
 *   +Z = back-of-hand direction  (the stone faces out of the back of the hand)
 *
 * Hierarchy:
 *   seat        – sits at the asset's ring-seat point, oriented by that frame
 *     tiltFrame – slides along the finger and tilts about the knuckle axis
 *       ring    – spins around the finger and scales to fit
 */
import * as THREE from 'three/webgpu';

export interface RingPlacement {
	/** Units along the finger from the seat point; negative slides toward the knuckle. */
	offset: number;
	/** Radians around the finger axis (moves the head around the finger). */
	spin: number;
	/** Radians tilting the ring plane relative to the finger axis. */
	tilt: number;
	/** Band scale multiplier. */
	size: number;
}

export class RingGizmo {
	readonly seat = new THREE.Group();
	readonly tiltFrame = new THREE.Group();
	readonly ring = new THREE.Group();

	private last: RingPlacement | null = null;

	/**
	 * @param parent       scene root
	 * @param seatCenter   world point on the finger
	 * @param fingerAxis   world-space unit vector along the finger (toward the tip)
	 * @param headOutward  world-space direction the stone should face
	 */
	constructor( parent: THREE.Object3D, seatCenter: THREE.Vector3, fingerAxis: THREE.Vector3, headOutward = new THREE.Vector3( 0, 0, 1 ) ) {
		this.seat.name = 'ring-seat';
		this.tiltFrame.name = 'ring-tilt';
		this.ring.name = 'ring-spin';

		const yAxis = fingerAxis.clone().normalize();
		// Remove any component of the outward hint along the finger, then
		// orthonormalize. If the hint is parallel to the finger, pick a fallback.
		const zAxis = headOutward.clone().addScaledVector( yAxis, - headOutward.dot( yAxis ) );
		if ( zAxis.lengthSq() < 1e-6 ) zAxis.set( 1, 0, 0 ).addScaledVector( yAxis, - yAxis.x );
		zAxis.normalize();
		const xAxis = new THREE.Vector3().crossVectors( yAxis, zAxis ).normalize();

		const basis = new THREE.Matrix4().makeBasis( xAxis, yAxis, zAxis );
		this.seat.quaternion.setFromRotationMatrix( basis );
		this.seat.position.copy( seatCenter );

		parent.add( this.seat );
		this.seat.add( this.tiltFrame );
		this.tiltFrame.add( this.ring );
	}

	add( object: THREE.Object3D ): void {
		this.ring.add( object );
	}

	setPlacement( p: RingPlacement ): void {
		const last = this.last;
		if ( last && last.offset === p.offset && last.spin === p.spin && last.tilt === p.tilt && last.size === p.size ) return;
		this.last = { ...p };

		this.tiltFrame.position.set( 0, p.offset, 0 );
		// Tilt about the ring's own X axis (the knuckle axis), so the band leans
		// forward/back along the finger rather than sideways.
		this.tiltFrame.rotation.set( p.tilt, 0, 0 );
		this.ring.rotation.set( 0, p.spin, 0 );
		this.ring.scale.setScalar( p.size );
	}

	getWorldCenter( target = new THREE.Vector3() ): THREE.Vector3 {
		this.tiltFrame.getWorldPosition( target );
		return target;
	}
}
