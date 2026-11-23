import { useEffect, useRef, useState } from 'react';
import type { Preset } from './presets';

const PRESETS_KEY = 'jewelry-tryon/presets/v1';
const SCENE_KEY = 'jewelry-tryon/scene/v1';
const LOOK_KEY = 'jewelry-tryon/look/v1';
const MAX_PRESETS = 4;

/** localStorage can throw in private windows; every access is guarded. */
function read<T>( key: string, fallback: T ): T {
	try {

		const raw = localStorage.getItem( key );
		if ( raw === null ) return fallback;
		return JSON.parse( raw ) as T;

	} catch {

		return fallback;

	}
}

function write( key: string, value: unknown ): void {
	try {

		localStorage.setItem( key, JSON.stringify( value ) );

	} catch {

		/* storage may be full or blocked; the app keeps working without it */

	}
}

export interface StoredLookSnapshot {
	look: unknown;
	scene: unknown;
}

export function loadPresets(): Preset[] {
	const raw = read<Preset[]>( PRESETS_KEY, [] );
	if ( ! Array.isArray( raw ) ) return [];
	return raw
		.filter( ( p ) => p && typeof p.id === 'string' && p.look )
		.slice( 0, MAX_PRESETS )
		.map( ( p ) => ( {
			id: p.id,
			name: String( p.name ?? '未命名' ),
			look: p.look,
			scene: ( p as unknown as { scene?: unknown } ).scene,
			createdAt: Number( p.createdAt ) || Date.now(),
			thumbnail: typeof p.thumbnail === 'string' ? p.thumbnail : undefined
		} ) ) as unknown as Preset[];
}

export function savePresets( presets: Preset[] ): void {
	write( PRESETS_KEY, presets.slice( 0, MAX_PRESETS ) );
}

export function loadSceneSnapshot(): StoredLookSnapshot | null {
	const raw = read<StoredLookSnapshot | null>( SCENE_KEY, null );
	return raw && typeof raw === 'object' ? raw : null;
}

export function saveSceneSnapshot( snapshot: StoredLookSnapshot ): void {
	write( SCENE_KEY, snapshot );
}

export function clearStoredState(): void {
	try {

		localStorage.removeItem( PRESETS_KEY );
		localStorage.removeItem( SCENE_KEY );
		localStorage.removeItem( LOOK_KEY );

	} catch {

		/* ignore */

	}
}

/**
 * A tiny persisted state hook: writes debounced so slider drags do not hit
 * localStorage on every frame.
 */
export function usePersisted<T>( key: string, initial: T ): [ T, ( next: T | ( ( prev: T ) => T ) ) => void ] {
	const [ value, setValue ] = useState<T>( () => read<T>( key, initial ) );
	const timer = useRef<number | null>( null );

	useEffect( () => {

		if ( timer.current !== null ) window.clearTimeout( timer.current );
		timer.current = window.setTimeout( () => write( key, value ), 180 );
		return () => {

			if ( timer.current !== null ) window.clearTimeout( timer.current );

		};

	}, [ key, value ] );

	return [ value, setValue ];
}

export { MAX_PRESETS };
