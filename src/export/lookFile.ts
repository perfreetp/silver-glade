/**
 * Export / import of the material recipe as a portable JSON document.
 *
 * The file is intentionally human-readable and versioned, so a look can be
 * version-controlled or handed to a colleague and re-imported unchanged.
 */
import type { MaterialLook, Preset, SceneLook } from '../state/presets';
import { ExportError } from './download';

export interface LookFile {
	format: 'jewelry-tryon/materials';
	version: 1;
	exportedAt: string;
	generator: string;
	look: MaterialLook;
	scene: SceneLook;
	presets: Array<{ name: string; look: MaterialLook; createdAt: number }>;
}

export function exportMaterialJson( look: MaterialLook, scene: SceneLook, presets: Array<{ name: string; look: MaterialLook; createdAt: number }> ): string {
	const doc: LookFile = {
		format: 'jewelry-tryon/materials',
		version: 1,
		exportedAt: new Date().toISOString(),
		generator: 'Jewel Studio',
		look,
		scene,
		presets
	};
	return JSON.stringify( doc, null, 2 );
}

export async function importMaterialFile( file: File ): Promise<{ look: Partial<MaterialLook>; scene?: Partial<SceneLook> }> {
	if ( file.size > 512 * 1024 ) throw new ExportError( '文件过大，请选择本工具导出的材质参数文件' );
	let text: string;
	try {

		text = await file.text();

	} catch {

		throw new ExportError( '无法读取文件' );

	}

	let raw: unknown;
	try {

		raw = JSON.parse( text );

	} catch {

		throw new ExportError( '文件不是有效的 JSON' );

	}

	if ( ! raw || typeof raw !== 'object' ) throw new ExportError( '文件内容格式不正确' );
	const obj = raw as Record<string, unknown>;
	if ( obj.format !== 'jewelry-tryon/materials' ) throw new ExportError( '这不是本工具导出的材质参数文件' );

	const look = obj.look as Partial<MaterialLook> | undefined;
	if ( ! look || typeof look !== 'object' ) throw new ExportError( '文件缺少材质参数 (look)' );

	return { look, scene: obj.scene as Partial<SceneLook> | undefined };
}

export type { Preset };
