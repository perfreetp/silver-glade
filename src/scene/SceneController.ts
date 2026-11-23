/**
 * SceneController owns everything WebGPU: renderer, scene, camera, studio
 * environment, lights, hand, ring and the three pre-built gem meshes.
 *
 * Design rules that the UI relies on:
 *  - Slider changes write uniforms only. No material rebuild, no recompile.
 *  - Cut changes toggle visibility between three pre-built gem meshes.
 *  - Everything is pre-compiled during init (`compileAsync`), so the first
 *    interaction with any control is already warm.
 */
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { createStudioEnvironment } from './studio';
import { RingGizmo } from './RingGizmo';
import { buildGemGeometry } from './gemGeometry';
import {
	applyGemPreset,
	captureToDataUrl,
	createGemMaterial,
	createGemUniforms,
	createMetalMaterial,
	createMetalUniforms,
	createSkinMaterial,
	createSkinUniforms,
	type GemUniforms,
	type MetalUniforms,
	type SkinUniforms
} from './materials';
import {
	cutById,
	defaultLook,
	defaultSceneLook,
	metalById,
	skinById,
	type MaterialLook,
	type SceneLook,
	type CutId
} from '../state/presets';

export interface RingAssetInfo {
	girdleZ: number;
	gemRadius: number;
	fingerRadius: number;
	bandWidth: number;
	bandOuterRadius: number;
}

export interface InitProgress {
	stage: string;
	detail?: string;
}

export interface SceneStats {
	backend: 'webgpu' | 'webgl';
	compileMs: number;
	gemTriangles: Record<CutId, number>;
}

const GEM_CUTS: CutId[] = [ 'round', 'emerald', 'oval' ];

export class SceneController {
	readonly renderer: THREE.WebGPURenderer;
	readonly scene = new THREE.Scene();
	readonly camera: THREE.PerspectiveCamera;
	readonly controls: OrbitControls;

	private readonly gems = new Map<CutId, THREE.Mesh>();
	private readonly gemUniforms: GemUniforms;
	private readonly gemMaterial: THREE.MeshPhysicalNodeMaterial;
	private readonly metalUniforms: MetalUniforms;
	private readonly skinUniforms: SkinUniforms;
	private bandMesh!: THREE.Mesh;
	private handMesh!: THREE.Mesh;
	private gizmo!: RingGizmo;
	private seatCenter = new THREE.Vector3();
	private fingerAxis = new THREE.Vector3( 0, 1, 0 );
	private fingerRadius = 0.29;
	private ringInfo: RingAssetInfo = { girdleZ: 0.594, gemRadius: 0.2, fingerRadius: 0.34, bandWidth: 0.3, bandOuterRadius: 0.385 };

	private readonly keyLight: THREE.DirectionalLight;
	private readonly fillLight: THREE.DirectionalLight;
	private readonly rimLight: THREE.DirectionalLight;

	private readonly captureTarget: THREE.RenderTarget;
	private readonly thumbnailTarget: THREE.RenderTarget;

	private frameHandle = 0;
	private disposed = false;
	private ready = false;
	private statsValue: SceneStats = { backend: 'webgpu', compileMs: 0, gemTriangles: { round: 0, emerald: 0, oval: 0 } };

	private look: MaterialLook = defaultLook();
	private sceneLook: SceneLook = defaultSceneLook();

	constructor( canvasHost: HTMLElement ) {
		this.renderer = new THREE.WebGPURenderer( { antialias: true, samples: 4 } );
		this.renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 0.8;
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;
		canvasHost.appendChild( this.renderer.domElement );

		this.camera = new THREE.PerspectiveCamera( 32, 1, 0.02, 200 );
		this.controls = new OrbitControls( this.camera, this.renderer.domElement );
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.075;
		this.controls.rotateSpeed = 0.7;
		this.controls.zoomSpeed = 0.8;
		this.controls.panSpeed = 0.6;
		this.controls.minDistance = 0.9;
		this.controls.maxDistance = 14;
		this.controls.minPolarAngle = 0.15;
		this.controls.maxPolarAngle = Math.PI - 0.15;

		this.scene.background = new THREE.Color( 0x0a0b0e );

		this.gemUniforms = createGemUniforms();
		this.gemMaterial = createGemMaterial( this.gemUniforms );
		this.metalUniforms = createMetalUniforms();
		this.skinUniforms = createSkinUniforms();

		this.keyLight = new THREE.DirectionalLight( 0xfff1df, 1.55 );
		this.keyLight.position.set( 4.2, 6.4, 6.2 );
		this.keyLight.castShadow = true;
		this.keyLight.shadow.mapSize.set( 1024, 1024 );
		const cam = this.keyLight.shadow.camera;
		cam.left = - 6.5;
		cam.right = 6.5;
		cam.top = 6.5;
		cam.bottom = - 6.5;
		cam.near = 0.5;
		cam.far = 40;
		this.keyLight.shadow.bias = - 0.0012;
		this.keyLight.shadow.normalBias = 0.06;
		this.keyLight.shadow.radius = 2;

		this.fillLight = new THREE.DirectionalLight( 0xd7e2ff, 0.5 );
		this.fillLight.position.set( - 6, 1.2, 4.2 );

		this.rimLight = new THREE.DirectionalLight( 0xffffff, 1.35 );
		this.rimLight.position.set( - 2.4, 3.2, - 6.6 );

		this.scene.add( this.keyLight, this.fillLight, this.rimLight );

		this.captureTarget = new THREE.RenderTarget( 1600, 1600, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true } );
		this.thumbnailTarget = new THREE.RenderTarget( 288, 288, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true } );
	}

	async init( onProgress: ( p: InitProgress ) => void ): Promise<SceneStats> {
		onProgress( { stage: '初始化 WebGPU', detail: '创建 GPU 设备与渲染管线' } );
		await this.renderer.init();
		const backend = isWebGPUBackend( this.renderer ) ? 'webgpu' : 'webgl';

		onProgress( { stage: '生成工作室环境', detail: '预过滤反射环境贴图 (PMREM)' } );
		const pmrem = new THREE.PMREMGenerator( this.renderer );
		const env = pmrem.fromScene( createStudioEnvironment(), 0, 0.1, 100, { size: 512 } ).texture;
		this.scene.environment = env;
		this.scene.environmentIntensity = 0.5;

		onProgress( { stage: '加载手部模型', detail: 'SDF 雕刻网格 + 烘焙 AO' } );
		const [ handGltf, ringInfo, handInfo ] = await Promise.all( [
			new GLTFLoader().loadAsync( '/models/hand.glb' ),
			fetch( '/models/ring.json' ).then( ( r ) => r.json() ),
			fetch( '/models/hand.json' ).then( ( r ) => r.json() )
		] );
		const ringGltf = await new GLTFLoader().loadAsync( '/models/ring.glb' );

		this.ringInfo = ringInfo as RingAssetInfo;

		// --- hand ---
		this.handMesh = handGltf.scene.children[ 0 ] as THREE.Mesh;
		this.handMesh.material = createSkinMaterial( this.skinUniforms );
		this.handMesh.castShadow = true;
		this.handMesh.receiveShadow = true;
		this.scene.add( handGltf.scene );

		// --- ring band ---
		const bandGltf = new THREE.Object3D();
		const bandNode = ringGltf.scene.getObjectByName( 'band' ) as THREE.Mesh;
		bandNode.removeFromParent();
		this.bandMesh = bandNode;
		this.bandMesh.material = createMetalMaterial( this.metalUniforms );
		this.bandMesh.castShadow = true;
		this.bandMesh.receiveShadow = true;
		bandGltf.add( this.bandMesh );

		const seat = handInfo.ringSeat as { center: number[]; axis: number[]; fingerRadius: number };
		this.seatCenter.set( seat.center[ 0 ], seat.center[ 1 ], seat.center[ 2 ] );
		this.fingerAxis.set( seat.axis[ 0 ], seat.axis[ 1 ], seat.axis[ 2 ] ).normalize();
		// Measure the real cross-section from the mesh: SDF radius hints drift
		// once smoothing and smooth unions reshape the silhouette.
		this.fingerRadius = Math.max( seat.fingerRadius, measureFingerRadius( this.handMesh, this.seatCenter, this.fingerAxis ) );

		// Stone faces out of the back of the hand: the hand's +Z in model space
		// (its palm faces -Z), expressed in world space through the mesh transform.
		const headOutward = new THREE.Vector3( 0, 0, 1 ).applyQuaternion( this.handMesh.getWorldQuaternion( new THREE.Quaternion() ) );
		this.gizmo = new RingGizmo( this.scene, this.seatCenter, this.fingerAxis, headOutward );
		this.gizmo.add( bandGltf );

		// --- three gem cuts, all built and pre-compiled up-front ---
		onProgress( { stage: '构建宝石切工', detail: '圆钻 / 祖母绿 / 椭圆' } );
		const gemTriangles = { round: 0, emerald: 0, oval: 0 } as Record<CutId, number>;
		for ( const cut of GEM_CUTS ) {

			const geometry = buildGemGeometry( cut, this.ringInfo.gemRadius );
			gemTriangles[ cut ] = geometry.getAttribute( 'position' ).count / 3;
			const mesh = new THREE.Mesh( geometry, this.gemMaterial );
			mesh.position.set( 0, 0, this.ringInfo.girdleZ );
			mesh.visible = false;
			mesh.castShadow = false;
			mesh.receiveShadow = false;
			mesh.frustumCulled = false;
			this.gems.set( cut, mesh );
			this.gizmo.add( mesh );

		}

		this.applyLook( this.look, true );
		this.applySceneLook( this.sceneLook );

		// Frame the ring.
		const center = this.gizmo.getWorldCenter( new THREE.Vector3() );
		this.controls.target.copy( center );
		this.camera.position.copy( center ).add( new THREE.Vector3( 1.55, 1.05, 3.45 ) );
		this.controls.update();

		onProgress( { stage: '预编译全部材质', detail: '三档切工 + 三种金属，避免切换时卡顿' } );
		// Compile every cut's variant so the first switch is instantaneous.
		const t0 = performance.now();
		for ( const cut of GEM_CUTS ) {

			this.gems.get( cut )!.visible = true;
			this.applyLook( { ...this.look, cut }, true );

		}

		this.applyLook( this.look, true );
		await this.renderer.compileAsync( this.scene, this.camera );
		await this.renderer.compileAsync( this.scene, this.camera );
		const compileMs = Math.round( performance.now() - t0 );

		this.ready = true;
		this.applyLook( this.look, true );
		this.applySceneLook( this.sceneLook );
		this.statsValue = { backend, compileMs, gemTriangles };
		onProgress( { stage: '就绪' } );

		this.resize();
		this.startLoop();
		return this.statsValue;
	}

	get stats(): SceneStats {
		return this.statsValue;
	}

	resize(): void {
		const canvas = this.renderer.domElement;
		const parent = canvas.parentElement;
		if ( ! parent ) return;
		const w = Math.max( 1, parent.clientWidth );
		const h = Math.max( 1, parent.clientHeight );
		this.renderer.setSize( w, h, false );
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
	}

	/** Material changes: uniforms only. */
	applyLook( look: MaterialLook, force = false ): void {
		// Before init finishes, just remember the requested look; init applies it.
		if ( ! this.ready && ! force ) {

			this.look = look;
			return;

		}

		const prev = this.look;
		this.look = look;

		if ( force || prev.metal !== look.metal ) {

			const m = metalById( look.metal );
			this.metalUniforms.color.value.set( m.color );
			this.metalUniforms.envIntensity.value = m.envMapIntensity;

		}

		this.metalUniforms.roughness.value = look.roughness;
		this.metalUniforms.metalness.value = look.metalness;

		const cut = cutById( look.cut );
		applyGemPreset( this.gemUniforms, cut, {
			ior: look.ior,
			dispersion: look.dispersion,
			transmission: look.transmission
		} );

		if ( force || prev.cut !== look.cut || prev.gemScale !== look.gemScale ) {

			for ( const [ id, mesh ] of this.gems ) {

				mesh.visible = id === look.cut;
				mesh.scale.setScalar( look.gemScale );

			}

		}
	}

	/** Lighting, skin, exposure and ring placement. */
	applySceneLook( sceneLook: SceneLook ): void {
		if ( ! this.ready ) {

			this.sceneLook = sceneLook;
			return;

		}

		this.sceneLook = sceneLook;

		this.keyLight.intensity = sceneLook.keyIntensity;
		this.fillLight.intensity = sceneLook.fillIntensity;
		this.rimLight.intensity = sceneLook.rimIntensity;

		this.renderer.toneMappingExposure = sceneLook.exposure;
		this.scene.environmentIntensity = sceneLook.envIntensity;

		const skin = skinById( sceneLook.skin );
		this.skinUniforms.base.value.set( skin.base );
		this.skinUniforms.shade.value.set( skin.shade );
		this.skinUniforms.thickness.value.set( skin.thickness );
		this.skinUniforms.roughness.value = sceneLook.skinRoughness;

		// The band's inner radius is authored for a 0.3 finger; scale to fit.
		const fit = ( this.fingerRadius * 1.006 ) / this.ringInfo.fingerRadius;
		this.gizmo.setPlacement( {
			offset: sceneLook.ringOffset,
			spin: ( sceneLook.ringSpin * Math.PI ) / 180,
			tilt: ( sceneLook.ringTilt * Math.PI ) / 180,
			size: fit * sceneLook.ringSize
		} );
	}

	/** Render the current view square and return a PNG data URL. */
	async captureView( size = 1600 ): Promise<string> {
		return captureToDataUrl( this.renderer, this.scene, this.camera, this.captureTarget, size );
	}

	/** Small square capture used for preset thumbnails and comparisons. */
	async captureThumbnail( size = 288 ): Promise<string> {
		return captureToDataUrl( this.renderer, this.scene, this.camera, this.thumbnailTarget, size );
	}

	focusRing(): void {
		const center = this.gizmo.getWorldCenter( new THREE.Vector3() );
		const dir = this.camera.position.clone().sub( this.controls.target ).normalize();
		this.controls.target.copy( center );
		this.camera.position.copy( center ).add( dir.multiplyScalar( 3.0 ) );
		this.controls.update();
	}

	get backendLabel(): string {
		return this.statsValue.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2 (fallback)';
	}

	private startLoop(): void {
		const tick = () => {

			if ( this.disposed ) return;
			this.controls.update();
			this.renderer.render( this.scene, this.camera );
			this.frameHandle = requestAnimationFrame( tick );

		};

		this.frameHandle = requestAnimationFrame( tick );
	}

	dispose(): void {
		this.disposed = true;
		cancelAnimationFrame( this.frameHandle );
		this.controls.dispose();
		this.gizmo?.ring.traverse( ( o ) => {

			const mesh = o as THREE.Mesh;
			if ( mesh.geometry ) mesh.geometry.dispose();

		} );
		const canvas = this.renderer.domElement;
		this.renderer.dispose();
		canvas.remove();
	}
}

export { GEM_CUTS };

/**
 * The ring is circular but a finger cross-section is an ellipse, so the band
 * must clear the *widest* direction. Measure per-angle radial extents around
 * the seat and take a high percentile of them: that ignores a single knuckle
 * spike but still fits the broad side of the finger.
 */
function measureFingerRadius( mesh: THREE.Mesh, center: THREE.Vector3, axis: THREE.Vector3 ): number {
	const pos = mesh.geometry.getAttribute( 'position' ) as THREE.BufferAttribute;
	mesh.updateMatrixWorld( true );

	// Build a tangent frame around the finger axis.
	const helper = Math.abs( axis.y ) < 0.9 ? new THREE.Vector3( 0, 1, 0 ) : new THREE.Vector3( 1, 0, 0 );
	const u = new THREE.Vector3().crossVectors( helper, axis ).normalize();
	const v = new THREE.Vector3().crossVectors( axis, u ).normalize();

	const BINS = 32;
	const binMax = new Float32Array( BINS );
	const world = new THREE.Vector3();
	const delta = new THREE.Vector3();

	for ( let i = 0; i < pos.count; i ++ ) {

		world.fromBufferAttribute( pos, i );
		mesh.localToWorld( world );
		delta.copy( world ).sub( center );
		const along = delta.dot( axis );
		if ( Math.abs( along ) > 0.02 ) continue;
		const x = delta.dot( u );
		const y = delta.dot( v );
		const r = Math.hypot( x, y );
		if ( r < 0.05 || r > 0.6 ) continue;
		const angle = Math.atan2( y, x );
		const bin = ( ( Math.round( ( angle / ( Math.PI * 2 ) ) * BINS ) % BINS ) + BINS ) % BINS;
		if ( r > binMax[ bin ] ) binMax[ bin ] = r;

	}

	const radii = Array.from( binMax ).filter( ( r ) => r > 0 );
	if ( radii.length === 0 ) return 0;
	radii.sort( ( a, b ) => a - b );
	// Median: the finger is an ellipse with the long axis across it. The band
	// only needs to clear the short axis plus a little, and using the median
	// avoids both the knuckle spike and the wide side over-scaling the ring.
	return radii[ Math.min( radii.length - 1, Math.floor( radii.length * 0.5 ) ) ];
}

/** The backend exposes `isWebGPUBackend` at runtime but it is missing from the typings. */
export function isWebGPUBackend( renderer: THREE.Renderer ): boolean {
	return ( renderer.backend as unknown as { isWebGPUBackend?: boolean } ).isWebGPUBackend === true;
}
