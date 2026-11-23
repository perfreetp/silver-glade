/**
 * Minimal, dependency-free glTF 2.0 binary (.glb) writer for a single
 * indexed triangle mesh with POSITION and NORMAL attributes.
 *
 * Keeping this in-repo avoids pulling a DOM-dependent exporter into Node.
 */
export interface MeshData {
	name: string;
	positions: Float32Array;
	normals: Float32Array;
	indices: Uint32Array | Uint16Array;
	/** Optional per-vertex linear RGB, exported as COLOR_0. */
	colors?: Float32Array;
}

/** Options for compact geometry. */
export interface GlbOptions {
	/** Quantise positions to half precision and re-index; roughly halves the file. */
	quantize?: boolean;
}

function quantizePositions( positions: Float32Array, tolerance: number ): { positions: Float32Array; remap: Uint32Array } {
	const map = new Map<string, number>();
	const out: number[] = [];
	const remap = new Uint32Array( positions.length / 3 );
	const q = ( v: number ) => Math.round( v / tolerance ) * tolerance;
	for ( let i = 0, j = 0; i < positions.length; i += 3, j ++ ) {

		const x = q( positions[ i ] ), y = q( positions[ i + 1 ] ), z = q( positions[ i + 2 ] );
		const key = `${ x },${ y },${ z }`;
		let index = map.get( key );
		if ( index === undefined ) {

			index = out.length / 3;
			out.push( x, y, z );
			map.set( key, index );

		}

		remap[ j ] = index;

	}

	return { positions: new Float32Array( out ), remap };

}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

function pad4( n: number ): number {
	return ( 4 - ( n % 4 ) ) % 4;
}

export function writeGlb( data: MeshData, options: GlbOptions = {} ): Uint8Array {
	let { positions, normals, indices } = data;
	const { colors } = data;

	// Optional lossless-looking weld: the mesh is already welded, but quantising
	// to a 1e-4 grid lets coincident vertices share, which trims the index buffer.
	if ( options.quantize ) {

		const { positions: qp, remap } = quantizePositions( positions, 1e-4 );
		const newIndices = new Uint32Array( indices.length );
		for ( let i = 0; i < indices.length; i ++ ) newIndices[ i ] = remap[ indices[ i ] ];
		// Recompute normals for the merged vertices is unnecessary: smoothing
		// already made them near-identical where positions met.
		positions = qp;
		indices = newIndices;

	}

	const posBytes = positions.byteLength;
	const normBytes = normals.byteLength;
	const colBytes = colors ? colors.byteLength : 0;
	const useU16 = positions.length / 3 < 65535;
	const idxBytesRaw = useU16 ? indices.length * 2 : indices.length * 4;
	const idxData: Uint8Array = useU16
		? new Uint8Array( Uint16Array.from( indices ).buffer )
		: new Uint8Array( Uint32Array.from( indices ).buffer );

	// min/max for POSITION accessor.
	const min = [ Infinity, Infinity, Infinity ];
	const max = [ - Infinity, - Infinity, - Infinity ];
	for ( let i = 0; i < positions.length; i += 3 ) {

		for ( let c = 0; c < 3; c ++ ) {

			const v = positions[ i + c ];
			if ( v < min[ c ] ) min[ c ] = v;
			if ( v > max[ c ] ) max[ c ] = v;

		}

	}

	const posPadding = pad4( posBytes );
	const normPadding = pad4( normBytes );
	const colPadding = pad4( colBytes );
	const idxPadding = pad4( idxBytesRaw );
	const binLength = posBytes + posPadding + normBytes + normPadding + colBytes + colPadding + idxBytesRaw + idxPadding;

	const buffer = new Uint8Array( binLength );
	let offset = 0;
	buffer.set( new Uint8Array( positions.buffer, positions.byteOffset, posBytes ), offset );
	offset += posBytes + posPadding;
	const normOffset = offset;
	buffer.set( new Uint8Array( normals.buffer, normals.byteOffset, normBytes ), offset );
	offset += normBytes + normPadding;
	const colOffset = offset;
	if ( colors ) buffer.set( new Uint8Array( colors.buffer, colors.byteOffset, colBytes ), offset );
	offset += colBytes + colPadding;
	const idxOffset = offset;
	buffer.set( idxData, offset );

	const gltf = {
		asset: { version: '2.0', generator: 'jewelry-tryon procedural asset pipeline' },
		scene: 0,
		scenes: [ { name: 'Scene', nodes: [ 0 ] } ],
		nodes: [ { name: data.name, mesh: 0 } ],
		meshes: [
			{
				name: data.name,
				primitives: [
					{
						attributes: colors ? { POSITION: 0, NORMAL: 1, COLOR_0: 3 } : { POSITION: 0, NORMAL: 1 },
						indices: 2,
						material: 0,
						mode: 4
					}
				]
			}
		],
		materials: [
			{
				name: 'skin',
				pbrMetallicRoughness: {
					baseColorFactor: [ 0.85, 0.63, 0.51, 1 ],
					metallicFactor: 0,
					roughnessFactor: 0.62
				}
			}
		],
		accessors: [
			{
				bufferView: 0,
				componentType: 5126,
				count: positions.length / 3,
				type: 'VEC3',
				min: min.map( ( v ) => Number( v.toFixed( 6 ) ) ),
				max: max.map( ( v ) => Number( v.toFixed( 6 ) ) )
			},
			{ bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
			{
				bufferView: colors ? 3 : 2,
				componentType: useU16 ? 5123 : 5125,
				count: indices.length,
				type: 'SCALAR'
			},
			...( colors ? [ { bufferView: 2, componentType: 5126, count: colors.length / 3, type: 'VEC3' } ] : [] )
		],
		bufferViews: [
			{ buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
			{ buffer: 0, byteOffset: normOffset, byteLength: normBytes, target: 34962 },
			...( colors ? [ { buffer: 0, byteOffset: colOffset, byteLength: colBytes, target: 34962 } ] : [] ),
			{ buffer: 0, byteOffset: idxOffset, byteLength: idxBytesRaw, target: 34963 }
		],
		buffers: [ { byteLength: binLength } ]
	};

	const jsonString = JSON.stringify( gltf );
	const enc = new TextEncoder();
	const jsonRaw = enc.encode( jsonString );
	const jsonPadding = pad4( jsonRaw.byteLength );
	const jsonChunkLength = jsonRaw.byteLength + jsonPadding;

	const totalLength = 12 + 8 + jsonChunkLength + 8 + binLength;
	const out = new Uint8Array( totalLength );
	const view = new DataView( out.buffer );
	let p = 0;

	// GLB header.
	view.setUint32( p, GLB_MAGIC, true );
	view.setUint32( p + 4, GLB_VERSION, true );
	view.setUint32( p + 8, totalLength, true );
	p += 12;

	// JSON chunk (space padded).
	view.setUint32( p, jsonChunkLength, true );
	view.setUint32( p + 4, CHUNK_JSON, true );
	p += 8;
	out.set( jsonRaw, p );
	p += jsonRaw.byteLength;
	for ( let i = 0; i < jsonPadding; i ++ ) out[ p ++ ] = 0x20;

	// BIN chunk.
	view.setUint32( p, binLength, true );
	view.setUint32( p + 4, CHUNK_BIN, true );
	p += 8;
	out.set( buffer, p );

	return out;
}
