/**
 * Builds every runtime asset the app loads:
 *   public/models/hand.glb   procedural hand mesh (SDF + marching cubes, baked AO)
 *   public/models/hand.json  ring-seat hint (point, axis, measured radius)
 *   public/models/ring.glb   band + baked gem, two meshes / two material slots
 *   public/models/ring.json  head measurements used to place the runtime gems
 *
 * Run with: npm run assets
 */
import { spawnSync } from 'node:child_process';

for ( const script of [ 'scripts/make-hand.ts', 'scripts/make-ring.ts' ] ) {

	console.log( `\n▶ ${ script }` );
	const result = spawnSync( process.execPath, [ script ], { stdio: 'inherit' } );
	if ( result.status !== 0 ) process.exit( result.status ?? 1 );

}

console.log( '\nAll assets written to public/models/' );
