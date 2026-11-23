/**
 * Transmissive material wrapper for the gem.
 *
 * Two things matter for believable jewellery:
 *
 * 1. Transmission + IOR give real refraction of whatever is behind the stone
 *    (finger, skin, band), sampled from the opaque viewport buffer. This is what
 *    makes the stone occlude and be occluded correctly.
 * 2. Dispersion refracts R/G/B at slightly different IORs, so the highlight at
 *    each facet edge splits into a rainbow. Because the split depends on view
 *    and light direction, the fire moves as the camera orbits.
 *
 * Values are driven by TSL uniforms so scrubbing never triggers a recompile.
 */
import * as THREE from 'three/webgpu';
import { color, float, fract, mix, normalView, positionViewDirection, uniform, vec3, vertexColor } from 'three/tsl';

import type { CutId } from '../state/presets';

export type FloatUniform = ReturnType<typeof uniform<'float'>>;
export type ColorUniform = ReturnType<typeof uniform<'color'>>;

export interface GemUniforms {
	color: ColorUniform;
	ior: FloatUniform;
	dispersion: FloatUniform;
	transmission: FloatUniform;
	thickness: FloatUniform;
	attenuationColor: ColorUniform;
	attenuationDistance: FloatUniform;
	roughness: FloatUniform;
	envIntensity: FloatUniform;
}

export function createGemUniforms(): GemUniforms {
	return {
		color: uniform( new THREE.Color( 0xffffff ) ),
		ior: uniform( 2.417 ),
		dispersion: uniform( 6 ),
		transmission: uniform( 1 ),
		thickness: uniform( 0.11 ),
		attenuationColor: uniform( new THREE.Color( 0xffffff ) ),
		attenuationDistance: uniform( 1e4 ),
		roughness: uniform( 0.02 ),
		envIntensity: uniform( 1.15 )
	};
}

/**
 * Build the gem material. The uniforms are re-used when the cut changes so a
 * preset switch is one uniform write, not a shader build.
 */
export function createGemMaterial( u: GemUniforms ): THREE.MeshPhysicalNodeMaterial {
	const mat = new THREE.MeshPhysicalNodeMaterial( {
		metalness: 0,
		// FrontSide: with DoubleSide the far facets would transmission-sample a
		// buffer that already contains the near facets, producing a kaleidoscope.
		side: THREE.FrontSide,
		transparent: true,
		envMapIntensity: 2.2
	} );

	mat.colorNode = u.color;

	mat.iorNode = u.ior;
	mat.dispersionNode = u.dispersion;
	mat.transmissionNode = u.transmission;
	mat.thicknessNode = u.thickness;
	mat.attenuationColorNode = u.attenuationColor;
	mat.attenuationDistanceNode = u.attenuationDistance;
	mat.roughnessNode = u.roughness;
	mat.metalnessNode = float( 0 );

	// Fire. The renderer's dispersion splits R/G/B by refraction inside the
	// transmission pass; at ring scale those fringes are sub-pixel, so this term
	// makes the same physics visible without painting over the stone.
	//
	//   hue   — one full spectral sweep per facet. The phase comes from the facet
	//           normal *and* the view vector, so the colour slides across each
	//           facet as the camera orbits (this is the "火彩随视角变化" cue).
	//   gate  — zero for head-on facets, rising only toward grazing incidence,
	//           which is where real diamond fire lives. Squared so the inside of
	//           the crown stays clear.
	//
	// The result is added as emission, so it reads as light, not paint.
	const viewDot = normalView.dot( positionViewDirection ).abs().clamp();
	const phase = normalView.x.mul( 0.62 ).add( normalView.y.mul( 0.48 ) ).add( viewDot.mul( 0.9 ) );
	const hue = fract( phase.add( 0.15 ).mul( u.dispersion.mul( 0.3 ).add( 0.85 ) ) );
	// Mostly white with a spectral tint: at this scale saturated colour reads as
	// paint, whereas a tinted sparkle reads as a prism highlight.
	const spectrum = spectral( hue as any );
	const tint = mix( vec3( 1, 1, 1 ), spectrum, 0.5 );
	const gate = float( 1 ).sub( viewDot ).clamp().pow( 3.2 );
	const sparkle = tint.mul( gate ).mul( u.dispersion.mul( 0.055 ) );
	mat.emissiveNode = sparkle;
	return mat;
}

/**
 * Cheap visible-spectrum ramp: a piecewise triangle wave per channel gives the
 * classic red→yellow→green→cyan→blue→magenta sweep for t in 0..1.
 */
function spectral( t: { mul: ( v: number ) => { sub: ( v: number ) => ReturnType<typeof float> } } | any ) {
	const k = t.mul( 6 ) as any;
	const r = k.sub( 3 ).abs().sub( 1 ).clamp( 0, 1 );
	const g = float( 2 ).sub( k.sub( 2 ).abs() ).clamp( 0, 1 );
	const b = float( 2 ).sub( k.sub( 4 ).abs() ).clamp( 0, 1 );
	return vec3( r, g, b );
}

export function applyGemPreset( u: GemUniforms, cut: { ior: number; thickness: number; attenuationColor: string; attenuationDistance: number; dispersion: number }, overrides: { ior: number; dispersion: number; transmission: number } ): void {
	u.ior.value = overrides.ior > 0 ? overrides.ior : cut.ior;
	u.thickness.value = cut.thickness;
	u.attenuationColor.value.set( cut.attenuationColor );
	u.attenuationDistance.value = cut.attenuationDistance;
	u.dispersion.value = overrides.dispersion;
	u.transmission.value = overrides.transmission;
	u.color.value.set( 0xffffff );
	u.roughness.value = 0.02;
	u.envIntensity.value = 2.2;
}

/** Metal uniforms are plain numbers, but keep the same pattern for fast scrubs. */
export interface MetalUniforms {
	color: ColorUniform;
	roughness: FloatUniform;
	metalness: FloatUniform;
	envIntensity: FloatUniform;
}

export function createMetalUniforms(): MetalUniforms {
	return {
		color: uniform( new THREE.Color( '#ffcf6b' ) ),
		roughness: uniform( 0.16 ),
		metalness: uniform( 1 ),
		envIntensity: uniform( 1.15 )
	};
}

export function createMetalMaterial( u: MetalUniforms ): THREE.MeshPhysicalNodeMaterial {
	const mat = new THREE.MeshPhysicalNodeMaterial( {
		metalness: 1,
		roughness: 0.16
	} );
	mat.colorNode = u.color;
	mat.roughnessNode = u.roughness;
	mat.metalnessNode = u.metalness;
	return mat;
}

/** Skin uniforms: colour ramp plus SSS strength, swapped without recompiles. */
export interface SkinUniforms {
	base: ColorUniform;
	shade: ColorUniform;
	thickness: ColorUniform;
	roughness: FloatUniform;
	aoStrength: FloatUniform;
}

export function createSkinUniforms(): SkinUniforms {
	return {
		base: uniform( new THREE.Color( '#e8bfa6' ) ),
		shade: uniform( new THREE.Color( '#c99579' ) ),
		thickness: uniform( new THREE.Color( '#c25f42' ) ),
		roughness: uniform( 0.55 ),
		aoStrength: uniform( 0.55 )
	};
}

export function createSkinMaterial( u: SkinUniforms ): THREE.MeshSSSNodeMaterial {
	const mat = new THREE.MeshSSSNodeMaterial();
	// The hand GLB stores baked AO in the red channel of COLOR_0 (1 = open,
	// lower = crevice). Lerping between the shade and base colours by that value
	// keeps creases and finger gaps readable without flattening the form.
	// `aoStrength` scales how far toward the shade colour the darkest AO goes.
	const ao = vertexColor().r;
	const darkest = mix( u.base, u.shade, u.aoStrength );
	mat.colorNode = mix( darkest, u.base, ao );
	mat.roughnessNode = u.roughness;
	mat.thicknessColorNode = u.thickness;
	mat.thicknessDistortionNode = float( 0.4 );
	mat.thicknessAmbientNode = float( 0.02 );
	mat.thicknessPowerNode = float( 2.6 );
	mat.thicknessScaleNode = float( 0.7 );
	// A touch of sheen keeps skin from reading as plastic under the big softbox.
	mat.sheen = 0.22;
	mat.sheenRoughness = 0.65;
	mat.sheenColor = new THREE.Color( 0xffd9c8 );
	return mat;
}

/**
 * Thumbnail/export helper: render the current view into an offscreen target and
 * read it back, so the capture matches the canvas exactly (including tone
 * mapping and colour space, which the renderer applies for output targets).
 */
export async function captureToDataUrl(
	renderer: THREE.WebGPURenderer,
	scene: THREE.Scene,
	camera: THREE.PerspectiveCamera,
	target: THREE.RenderTarget,
	size: number
): Promise<string> {
	target.setSize( size, size );
	const prevAspect = camera.aspect;
	camera.aspect = 1;
	camera.updateProjectionMatrix();

	renderer.setOutputRenderTarget( target );
	renderer.render( scene, camera );
	const pixels = await renderer.readRenderTargetPixelsAsync( target, 0, 0, size, size );
	renderer.setOutputRenderTarget( null );

	camera.aspect = prevAspect;
	camera.updateProjectionMatrix();

	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' )!;
	const image = ctx.createImageData( size, size );
	const rowBytes = size * 4;
	// readPixels returns bottom-up rows; flip into canvas order.
	for ( let y = 0; y < size; y ++ ) {

		const src = ( size - 1 - y ) * rowBytes;
		image.data.set( pixels.subarray( src, src + rowBytes ), y * rowBytes );

	}

	ctx.putImageData( image, 0, 0 );
	const url = canvas.toDataURL( 'image/png' );
	return url;
}

export type { CutId };
