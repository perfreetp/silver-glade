/**
 * Immutable-ish material presets and cut definitions shared by the UI,
 * the renderer and the export/import path.
 *
 * A "look" is the full ring appearance: one band preset, one gem cut, plus
 * numeric overrides that the user can scrub without leaving the preset.
 */

export type MetalId = 'gold' | 'whiteGold' | 'roseGold';
export type CutId = 'round' | 'emerald' | 'oval';
export type SkinId = 'fair' | 'medium' | 'deep' | 'olive' | 'porcelain';

export interface MetalPreset {
	id: MetalId;
	label: string;
	/** Linear-space base colour for the metal. */
	color: string;
	/** Base roughness; the slider scales around it. */
	roughness: number;
	/** Optional environment intensity for a brighter metal. */
	envMapIntensity: number;
}

export interface CutPreset {
	id: CutId;
	label: string;
	/** Base IOR of the gem; the slider offsets it. */
	ior: number;
	/** Internal thickness used by the transmission model, in model units. */
	thickness: number;
	/** Attenuation tint applied inside the stone. */
	attenuationColor: string;
	attenuationDistance: number;
	/** Base dispersion; slider scales it. */
	dispersion: number;
	approx: string;
}

export const METALS: MetalPreset[] = [
	{ id: 'gold', label: '黄金', color: '#ffcf6b', roughness: 0.16, envMapIntensity: 1.15 },
	{ id: 'whiteGold', label: '白金', color: '#eef1f6', roughness: 0.12, envMapIntensity: 1.25 },
	{ id: 'roseGold', label: '玫瑰金', color: '#f0a688', roughness: 0.17, envMapIntensity: 1.1 }
];

export const CUTS: CutPreset[] = [
	{
		id: 'round',
		label: '圆钻',
		ior: 2.417,
		thickness: 0.11,
		attenuationColor: '#ffffff',
		attenuationDistance: 1e4,
		dispersion: 1.0,
		approx: '明亮式 · 32 刻面'
	},
	{
		id: 'emerald',
		label: '祖母绿',
		ior: 1.576,
		thickness: 0.15,
		attenuationColor: '#e6f6ee',
		attenuationDistance: 0.9,
		dispersion: 0.6,
		approx: '阶梯式 · 长方形'
	},
	{
		id: 'oval',
		label: '椭圆',
		ior: 2.417,
		thickness: 0.12,
		attenuationColor: '#ffffff',
		attenuationDistance: 1e4,
		dispersion: 0.8,
		approx: '明亮式 · 椭圆轮廓'
	}
];

export interface SkinPreset {
	id: SkinId;
	label: string;
	base: string;
	shade: string;
	thickness: string;
}

export const SKINS: SkinPreset[] = [
	{ id: 'porcelain', label: '瓷白', base: '#f2d3c2', shade: '#c99a86', thickness: '#cf7a5f' },
	{ id: 'fair', label: '白皙', base: '#e7bda3', shade: '#b9836a', thickness: '#c25f42' },
	{ id: 'medium', label: '自然', base: '#d09d79', shade: '#966443', thickness: '#a9502f' },
	{ id: 'olive', label: '橄榄', base: '#c19870', shade: '#7f5836', thickness: '#8f4a2a' },
	{ id: 'deep', label: '深棕', base: '#8e5f41', shade: '#553120', thickness: '#5c2a18' }
];

export interface MaterialLook {
	metal: MetalId;
	/** Absolute roughness in 0..1. */
	roughness: number;
	/** Absolute metalness, 0..1. Usually 1. */
	metalness: number;
	cut: CutId;
	/** Absolute index of refraction. */
	ior: number;
	/** Absolute dispersion strength. */
	dispersion: number;
	/** Stone transmission 0..1, lets the user make a stone look opaque. */
	transmission: number;
	/** Global stone scale so the same cut can fit different bands. */
	gemScale: number;
}

export interface SceneLook {
	skin: SkinId;
	skinRoughness: number;
	keyIntensity: number;
	fillIntensity: number;
	rimIntensity: number;
	exposure: number;
	envIntensity: number;
	/** Ring placement on the finger, in millimetres along the finger axis. */
	ringOffset: number;
	/** Ring spin around the finger axis, degrees. */
	ringSpin: number;
	/** Ring tilt relative to the finger, degrees. */
	ringTilt: number;
	/** Ring size multiplier (0.85 – 1.15), changes band diameter. */
	ringSize: number;
}

export interface Preset {
	id: string;
	name: string;
	look: MaterialLook;
	createdAt: number;
	/** Small PNG data URL captured when the preset was saved. */
	thumbnail?: string;
}

export function defaultLook(): MaterialLook {
	return {
		metal: 'gold',
		roughness: 0.16,
		metalness: 1,
		cut: 'round',
		ior: 2.417,
		dispersion: 1.0,
		transmission: 1,
		gemScale: 1
	};
}

export function defaultSceneLook(): SceneLook {
	return {
		skin: 'fair',
		skinRoughness: 0.55,
		keyIntensity: 1.55,
		fillIntensity: 0.5,
		rimIntensity: 1.35,
		exposure: 0.8,
		envIntensity: 0.5,
		ringOffset: 0,
		ringSpin: 0,
		ringTilt: 0,
		ringSize: 1
	};
}

export function metalById( id: MetalId ): MetalPreset {
	return METALS.find( ( m ) => m.id === id ) ?? METALS[ 0 ];
}

export function cutById( id: CutId ): CutPreset {
	return CUTS.find( ( c ) => c.id === id ) ?? CUTS[ 0 ];
}

export function skinById( id: SkinId ): SkinPreset {
	return SKINS.find( ( s ) => s.id === id ) ?? SKINS[ 1 ];
}

/** Clamp helper used by every numeric control. */
export function clamp( v: number, lo: number, hi: number ): number {
	return Math.min( hi, Math.max( lo, v ) );
}

/** Fill in missing keys on imported JSON so an older preset still loads. */
export function normalizeLook( raw: Partial<MaterialLook> | undefined ): MaterialLook {
	const d = defaultLook();
	if ( ! raw ) return d;
	return {
		metal: METALS.some( ( m ) => m.id === raw.metal ) ? ( raw.metal as MetalId ) : d.metal,
		roughness: clamp( num( raw.roughness, d.roughness ), 0, 1 ),
		metalness: clamp( num( raw.metalness, d.metalness ), 0, 1 ),
		cut: CUTS.some( ( c ) => c.id === raw.cut ) ? ( raw.cut as CutId ) : d.cut,
		ior: clamp( num( raw.ior, d.ior ), 1.3, 3.0 ),
		dispersion: clamp( num( raw.dispersion, d.dispersion ), 0, 8 ),
		transmission: clamp( num( raw.transmission, d.transmission ), 0, 1 ),
		gemScale: clamp( num( raw.gemScale, d.gemScale ), 0.6, 1.4 )
	};
}

export function normalizeSceneLook( raw: Partial<SceneLook> | undefined ): SceneLook {
	const d = defaultSceneLook();
	if ( ! raw ) return d;
	return {
		skin: SKINS.some( ( s ) => s.id === raw.skin ) ? ( raw.skin as SkinId ) : d.skin,
		skinRoughness: clamp( num( raw.skinRoughness, d.skinRoughness ), 0.2, 0.9 ),
		keyIntensity: clamp( num( raw.keyIntensity, d.keyIntensity ), 0, 10 ),
		fillIntensity: clamp( num( raw.fillIntensity, d.fillIntensity ), 0, 10 ),
		rimIntensity: clamp( num( raw.rimIntensity, d.rimIntensity ), 0, 10 ),
		exposure: clamp( num( raw.exposure, d.exposure ), 0.3, 2.5 ),
		envIntensity: clamp( num( raw.envIntensity, d.envIntensity ), 0, 2.5 ),
		ringOffset: clamp( num( raw.ringOffset, d.ringOffset ), - 0.4, 0.4 ),
		ringSpin: clamp( num( raw.ringSpin, d.ringSpin ), - 180, 180 ),
		ringTilt: clamp( num( raw.ringTilt, d.ringTilt ), - 35, 35 ),
		ringSize: clamp( num( raw.ringSize, d.ringSize ), 0.85, 1.15 )
	};
}

function num( v: unknown, fallback: number ): number {
	return typeof v === 'number' && Number.isFinite( v ) ? v : fallback;
}
