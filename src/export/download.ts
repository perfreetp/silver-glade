/** Browser download helpers with a clear failure mode. */

export class ExportError extends Error {}

export function downloadDataUrl( filename: string, dataUrl: string ): void {
	const link = document.createElement( 'a' );
	link.href = dataUrl;
	link.download = filename;
	link.rel = 'noopener';
	document.body.appendChild( link );
	link.click();
	link.remove();
}

export function downloadText( filename: string, text: string, mime = 'application/json' ): void {
	const blob = new Blob( [ text ], { type: `${ mime };charset=utf-8` } );
	const url = URL.createObjectURL( blob );
	try {

		downloadDataUrl( filename, url );

	} finally {

		// Revoke after the click has been handled.
		window.setTimeout( () => URL.revokeObjectURL( url ), 4000 );

	}

}
