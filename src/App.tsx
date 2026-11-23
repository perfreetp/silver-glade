import { useEffect, useMemo, useRef, useState } from 'react';
import { SceneController, type InitProgress, type SceneStats } from './scene/SceneController';
import { Slider, Segmented, Button, Section } from './components/Controls';
import {
	CUTS,
	METALS,
	SKINS,
	cutById,
	defaultLook,
	defaultSceneLook,
	normalizeLook,
	normalizeSceneLook,
	type CutId,
	type MaterialLook,
	type MetalId,
	type Preset,
	type SceneLook,
	type SkinId
} from './state/presets';
import { MAX_PRESETS, loadPresets, loadSceneSnapshot, saveSceneSnapshot, savePresets } from './state/storage';
import { exportMaterialJson, importMaterialFile } from './export/lookFile';
import { downloadDataUrl, downloadText, ExportError } from './export/download';

type PanelId = 'metal' | 'gem' | 'light' | 'place';

interface BootState {
	stage: string;
	detail?: string;
	done: boolean;
	error?: string;
}

export default function App() {
	const canvasHost = useRef<HTMLDivElement | null>( null );
	const controllerRef = useRef<SceneController | null>( null );
	const [ boot, setBoot ] = useState<BootState>( { stage: '准备中', done: false } );
	const [ stats, setStats ] = useState<SceneStats | null>( null );

	const restored = useMemo( () => loadSceneSnapshot(), [] );
	const [ look, setLook ] = useState<MaterialLook>( () => normalizeLook( restored?.look as Partial<MaterialLook> | undefined ) );
	const [ sceneLook, setSceneLook ] = useState<SceneLook>( () => normalizeSceneLook( restored?.scene as Partial<SceneLook> | undefined ) );
	const [ presets, setPresets ] = useState<Preset[]>( () => loadPresets() );
	const [ compareMode, setCompareMode ] = useState( false );
	const [ busy, setBusy ] = useState<string | null>( null );
	const [ toast, setToast ] = useState<{ kind: 'ok' | 'warn' | 'bad'; text: string } | null>( null );
	const [ activePanel, setActivePanel ] = useState<PanelId>( 'metal' );

	// Latest values for async callbacks.
	const lookRef = useRef( look );
	const sceneRef = useRef( sceneLook );
	lookRef.current = look;
	sceneRef.current = sceneLook;

	useEffect( () => {

		let cancelled = false;
		const host = canvasHost.current;
		if ( ! host ) return;

		const controller = new SceneController( host );
		controllerRef.current = controller;

		controller.init( ( p: InitProgress ) => {

			if ( cancelled ) return;
			setBoot( ( prev ) => ( { ...prev, stage: p.stage, detail: p.detail } ) );

		} )
			.then( ( s ) => {

				if ( cancelled ) return;
				controller.applyLook( lookRef.current, true );
				controller.applySceneLook( sceneRef.current );
				setStats( s );
				setBoot( ( prev ) => ( { ...prev, done: true } ) );
				// Re-apply the persisted look, then take a snapshot for the saved state.
				void persist( lookRef.current, sceneRef.current );

			} )
			.catch( ( e ) => {

				setBoot( ( prev ) => ( { ...prev, done: true, error: String( e?.message ?? e ) } ) );

			} );

		const onResize = () => controller.resize();
		window.addEventListener( 'resize', onResize );
		const ro = new ResizeObserver( onResize );
		ro.observe( host );

		return () => {

			cancelled = true;
			window.removeEventListener( 'resize', onResize );
			ro.disconnect();
			controller.dispose();
			controllerRef.current = null;

		};

	}, [] );

	useEffect( () => {

		controllerRef.current?.applyLook( look );

	}, [ look ] );

	useEffect( () => {

		controllerRef.current?.applySceneLook( sceneLook );

	}, [ sceneLook ] );

	useEffect( () => {

		savePresets( presets );

	}, [ presets ] );

	const persist = ( nextLook: MaterialLook, nextScene: SceneLook ) => {

		saveSceneSnapshot( { look: nextLook, scene: nextScene } );

	};

	const flash = ( kind: 'ok' | 'warn' | 'bad', text: string ) => {

		setToast( { kind, text } );
		window.setTimeout( () => setToast( ( t ) => ( t && t.text === text ? null : t ) ), 2600 );

	};

	const updateLook = ( patch: Partial<MaterialLook> ) => {

		setLook( ( prev ) => {

			const next = { ...prev, ...patch };
			persist( next, sceneRef.current );
			return next;

		} );

	};

	const updateScene = ( patch: Partial<SceneLook> ) => {

		setSceneLook( ( prev ) => {

			const next = { ...prev, ...patch };
			persist( lookRef.current, next );
			return next;

		} );

	};

	const applyPresetById = ( id: MetalId ) => {

		const m = METALS.find( ( x ) => x.id === id )!;
		updateLook( { metal: id, roughness: m.roughness, metalness: 1 } );

	};

	const applyCutById = ( id: CutId ) => {

		const c = cutById( id );
		updateLook( { cut: id, ior: c.ior, dispersion: c.dispersion, transmission: 1, gemScale: 1 } );

	};

	const savePreset = async () => {

		if ( presets.length >= MAX_PRESETS && ! presets.some( ( p ) => p.look.metal === look.metal && p.look.cut === look.cut ) ) {

			flash( 'warn', `最多保存 ${ MAX_PRESETS } 套组合，请先删除一组` );
			return;

		}

		const controller = controllerRef.current;
		if ( ! controller ) return;

		setBusy( '渲染缩略图' );
		try {

			const thumbnail = await controller.captureThumbnail( 288 );
			const name = `${ METALS.find( ( m ) => m.id === look.metal )?.label } · ${ CUTS.find( ( c ) => c.id === look.cut )?.label }`;
			setPresets( ( prev ) => {

				const without = prev.filter( ( p ) => p.name !== name );
				// Replace same-name entry, keep newest first, cap at 4.
				const next = [ { id: `p_${ Date.now().toString( 36 ) }`, name, look: { ...look }, scene: { ...sceneLook }, createdAt: Date.now(), thumbnail }, ...without ] as Preset[];
				return next.slice( 0, MAX_PRESETS );

			} );
			flash( 'ok', '已保存组合' );

		} catch ( e ) {

			flash( 'bad', `缩略图失败：${ String( e ) }` );

		} finally {

			setBusy( null );

		}

	};

	const loadPreset = ( p: Preset ) => {

		const next = normalizeLook( p.look as Partial<MaterialLook> );
		const sceneFromPreset = normalizeSceneLook( ( p as unknown as { scene?: Partial<SceneLook> } ).scene );
		setLook( next );
		setSceneLook( sceneFromPreset );
		flash( 'ok', `已载入 ${ p.name }` );

	};

	const deletePreset = ( id: string ) => {

		setPresets( ( prev ) => prev.filter( ( p ) => p.id !== id ) );

	};

	const captureExport = async () => {

		const controller = controllerRef.current;
		if ( ! controller ) return;
		setBusy( '渲染导出图' );
		try {

			const dataUrl = await controller.captureView( 1600 );
			downloadDataUrl( `jewelry-${ look.metal }-${ look.cut }-${ stamp() }.png`, dataUrl );
			flash( 'ok', '已导出当前视角' );

		} catch ( e ) {

			flash( 'bad', `导出失败：${ String( e ) }` );

		} finally {

			setBusy( null );

		}

	};

	const exportJson = () => {

		const json = exportMaterialJson( look, sceneLook, presets.map( ( p ) => ( { name: p.name, look: p.look, createdAt: p.createdAt } ) ) );
		downloadText( `jewelry-materials-${ stamp() }.json`, json );
		flash( 'ok', '已导出材质参数' );

	};

	const importJson = async ( file: File ) => {

		try {

			const parsed = await importMaterialFile( file );
			setLook( normalizeLook( parsed.look ) );
			if ( parsed.scene ) setSceneLook( normalizeSceneLook( parsed.scene ) );
			flash( 'ok', `已导入 ${ file.name }` );

		} catch ( e ) {

			flash( 'bad', e instanceof ExportError ? e.message : `导入失败：${ String( e ) }` );

		}

	};

	const comparePresets = useMemo( () => presets.slice( 0, MAX_PRESETS ), [ presets ] );

	return (
		<div className="app">
			<header className="topbar">
				<div className="brand">
					<span className="brand__mark" aria-hidden>◆</span>
					<div>
						<div className="brand__name">Jewel Studio</div>
						<div className="brand__sub">珠宝试戴渲染台 · WebGPU</div>
					</div>
				</div>
				<div className="topbar__status">
					{ stats && (
						<>
							<StatusChip tone={ stats.backend === 'webgpu' ? 'ok' : 'warn' } label={ stats.backend === 'webgpu' ? 'WebGPU' : 'WebGL2' } />
							<StatusChip tone="neutral" label={ `预编译 ${ ( stats.compileMs / 1000 ).toFixed( 2 ) }s` } />
							<StatusChip tone="neutral" label={ `宝石 ${ stats.gemTriangles[ look.cut ] } 面` } />
						</>
					) }
				</div>
				<div className="topbar__actions">
					<Button variant="ghost" onClick={ () => setCompareMode( ( v ) => ! v ) } title="并排对比已保存的组合">
						对比视图
					</Button>
					<Button variant="primary" onClick={ captureExport } disabled={ ! boot.done || !! busy } title="导出当前视角 PNG">
						{ busy === '渲染导出图' ? '渲染中…' : '导出视角' }
					</Button>
				</div>
			</header>

			<main className="stage">
				<div ref={ canvasHost } className="viewport" />

				{ ! boot.done && (
					<div className="boot">
						<div className="boot__inner">
							<div className="boot__ring" />
							<div className="boot__stage">{ boot.error ? '初始化失败' : boot.stage }</div>
							{ boot.detail && ! boot.error && <div className="boot__detail">{ boot.detail }</div> }
							{ boot.error && <pre className="boot__error">{ boot.error }</pre> }
						</div>
					</div>
				) }

				<div className="viewport__hint">
					<span>拖动旋转 · 滚轮缩放 · 右键平移</span>
				</div>

				{ compareMode && (
					<CompareOverlay
						presets={ comparePresets }
						onClose={ () => setCompareMode( false ) }
						onLoad={ ( p ) => {

							loadPreset( p );
							setCompareMode( false );

						} }
						onDelete={ deletePreset }
					/>
				) }

				{ toast && <div className={ `toast toast--${ toast.kind }` }>{ toast.text }</div> }
			</main>

			<aside className="panel">
				<nav className="tabs">
					<Tab id="metal" label="戒托" active={ activePanel === 'metal' } onClick={ () => setActivePanel( 'metal' ) } />
					<Tab id="gem" label="宝石" active={ activePanel === 'gem' } onClick={ () => setActivePanel( 'gem' ) } />
					<Tab id="light" label="光照" active={ activePanel === 'light' } onClick={ () => setActivePanel( 'light' ) } />
					<Tab id="place" label="佩戴" active={ activePanel === 'place' } onClick={ () => setActivePanel( 'place' ) } />
				</nav>

				<div className="panel__scroll">
					{ activePanel === 'metal' && (
						<>
							<Section title="金属预设">
								<Segmented
									variant="card"
									value={ look.metal }
									columns={ 3 }
									onChange={ ( v ) => applyPresetById( v as MetalId ) }
									options={ METALS.map( ( m ) => ( { id: m.id, label: m.label, sub: m.id } ) ) }
								/>
								<div className="metal-preview" aria-hidden>
									{ METALS.map( ( m ) => (
										<span
											key={ m.id }
											className={ `metal-preview__chip${ look.metal === m.id ? ' metal-preview__chip--on' : '' }` }
											style={ { background: `linear-gradient(135deg, ${ m.color }, ${ shade( m.color, -0.35 ) })` } }
										/>
									) ) }
								</div>
							</Section>
							<Section title="表面">
								<Slider
									label="粗糙度"
									value={ look.roughness }
									min={ 0.02 }
									max={ 0.7 }
									step={ 0.005 }
									onChange={ ( v ) => updateLook( { roughness: v } ) }
									hint="数值越低，反射越锐利、高光越细"
								/>
								<Slider label="金属度" value={ look.metalness } min={ 0 } max={ 1 } step={ 0.01 } onChange={ ( v ) => updateLook( { metalness: v } ) } />
							</Section>
						</>
					) }

					{ activePanel === 'gem' && (
						<>
							<Section title="切工">
								<Segmented
									variant="card"
									value={ look.cut }
									columns={ 3 }
									onChange={ ( v ) => applyCutById( v as CutId ) }
									options={ CUTS.map( ( c ) => ( { id: c.id, label: c.label, sub: c.approx } ) ) }
								/>
							</Section>
							<Section title="光学">
								<Slider
									label="折射率 IOR"
									value={ look.ior }
									min={ 1.3 }
									max={ 3.0 }
									step={ 0.001 }
									decimals={ 3 }
									onChange={ ( v ) => updateLook( { ior: v } ) }
									hint="钻石 2.417，红宝石 1.77，祖母绿 1.58"
								/>
								<Slider
									label="色散强度"
									value={ look.dispersion }
									min={ 0 }
									max={ 8 }
									step={ 0.05 }
									decimals={ 1 }
									onChange={ ( v ) => updateLook( { dispersion: v } ) }
									hint="RGB 折射率分离量，产生随视角变化的火彩"
								/>
								<Slider
									label="透射"
									value={ look.transmission }
									min={ 0 }
									max={ 1 }
									step={ 0.01 }
									format={ ( v ) => `${ Math.round( v * 100 ) }%` }
									onChange={ ( v ) => updateLook( { transmission: v } ) }
								/>
								<Slider
									label="宝石尺寸"
									value={ look.gemScale }
									min={ 0.6 }
									max={ 1.4 }
									step={ 0.005 }
									format={ ( v ) => `${ v.toFixed( 2 ) }×` }
									onChange={ ( v ) => updateLook( { gemScale: v } ) }
								/>
							</Section>
							<Section title="切工说明">
								<p className="note">{ cutById( look.cut ).approx }。火彩随视角变化，拖动旋转观察刻面边缘的色散。</p>
							</Section>
						</>
					) }

					{ activePanel === 'light' && (
						<>
							<Section title="肤色">
								<Segmented
									variant="card"
									value={ sceneLook.skin }
									columns={ 5 }
									onChange={ ( v ) => updateScene( { skin: v as SkinId } ) }
									options={ SKINS.map( ( s ) => ( { id: s.id, label: s.label } ) ) }
								/>
								<Slider
									label="皮肤粗糙度"
									value={ sceneLook.skinRoughness }
									min={ 0.25 }
									max={ 0.85 }
									step={ 0.01 }
									onChange={ ( v ) => updateScene( { skinRoughness: v } ) }
								/>
							</Section>
							<Section title="主光">
								<Slider label="强度" value={ sceneLook.keyIntensity } min={ 0 } max={ 10 } step={ 0.05 } onChange={ ( v ) => updateScene( { keyIntensity: v } ) } />
							</Section>
							<Section title="补光">
								<Slider label="强度" value={ sceneLook.fillIntensity } min={ 0 } max={ 10 } step={ 0.05 } onChange={ ( v ) => updateScene( { fillIntensity: v } ) } />
							</Section>
							<Section title="轮廓光">
								<Slider label="强度" value={ sceneLook.rimIntensity } min={ 0 } max={ 10 } step={ 0.05 } onChange={ ( v ) => updateScene( { rimIntensity: v } ) } />
							</Section>
							<Section title="整体">
								<Slider label="曝光" value={ sceneLook.exposure } min={ 0.3 } max={ 2.5 } step={ 0.01 } onChange={ ( v ) => updateScene( { exposure: v } ) } />
								<Slider label="环境反射" value={ sceneLook.envIntensity } min={ 0 } max={ 2.5 } step={ 0.01 } onChange={ ( v ) => updateScene( { envIntensity: v } ) } />
							</Section>
						</>
					) }

					{ activePanel === 'place' && (
						<>
							<Section title="位置与旋转">
								<Slider
									label="沿手指位置"
									value={ sceneLook.ringOffset }
									min={ - 0.4 }
									max={ 0.4 }
									step={ 0.005 }
									format={ ( v ) => `${ ( v * 100 ).toFixed( 0 ) }` }
									onChange={ ( v ) => updateScene( { ringOffset: v } ) }
									hint="沿指骨上下滑动戒指"
								/>
								<Slider
									label="绕手指旋转"
									value={ sceneLook.ringSpin }
									min={ - 180 }
									max={ 180 }
									step={ 1 }
									format={ ( v ) => `${ v.toFixed( 0 ) }°` }
									onChange={ ( v ) => updateScene( { ringSpin: v } ) }
								/>
								<Slider
									label="倾斜"
									value={ sceneLook.ringTilt }
									min={ - 35 }
									max={ 35 }
									step={ 0.5 }
									format={ ( v ) => `${ v.toFixed( 1 ) }°` }
									onChange={ ( v ) => updateScene( { ringTilt: v } ) }
								/>
								<Slider
									label="戒圈尺寸"
									value={ sceneLook.ringSize }
									min={ 0.85 }
									max={ 1.15 }
									step={ 0.005 }
									format={ ( v ) => `${ v.toFixed( 2 ) }×` }
									onChange={ ( v ) => updateScene( { ringSize: v } ) }
								/>
							</Section>
							<Section title="快捷操作">
								<div className="row">
									<Button onClick={ () => controllerRef.current?.focusRing() }>聚焦戒指</Button>
									<Button
										onClick={ () => {

											setLook( defaultLook() );
											setSceneLook( defaultSceneLook() );

										} }
									>
										重置外观
									</Button>
								</div>
							</Section>
						</>
					) }

					<Section title="材质组合" right={ <span className="section__count">{ presets.length }/{ MAX_PRESETS }</span> }>
						<div className="preset-list">
							{ presets.length === 0 && <p className="note">保存当前外观后，可并排对比最多 4 套组合。</p> }
							{ presets.map( ( p ) => (
								<div key={ p.id } className="preset">
									<button type="button" className="preset__main" onClick={ () => loadPreset( p ) } title={ `载入 ${ p.name }` }>
										{ p.thumbnail ? (
											<img className="preset__thumb" src={ p.thumbnail } alt={ p.name } />
										) : (
											<span className="preset__thumb preset__thumb--empty" />
										) }
										<span className="preset__meta">
											<span className="preset__name">{ p.name }</span>
											<span className="preset__sub">{ metalLabel( p.look.metal ) } · { cutLabel( p.look.cut ) }</span>
										</span>
									</button>
									<button type="button" className="preset__del" title="删除" onClick={ () => deletePreset( p.id ) }>
										×
									</button>
								</div>
							) ) }
						</div>
						<div className="row">
							<Button variant="primary" onClick={ savePreset } disabled={ ! boot.done || !! busy }>
								{ busy === '渲染缩略图' ? '保存中…' : '保存当前组合' }
							</Button>
							<Button onClick={ () => setCompareMode( true ) } disabled={ presets.length === 0 }>
								并排对比
							</Button>
						</div>
					</Section>

					<Section title="导出">
						<div className="row">
							<Button onClick={ captureExport } disabled={ ! boot.done || !! busy }>PNG 视角图</Button>
							<Button onClick={ exportJson }>材质参数 JSON</Button>
						</div>
						<label className="file-input">
							<input
								type="file"
								accept="application/json,.json"
								onChange={ ( e ) => {

									const f = e.target.files?.[ 0 ];
									if ( f ) void importJson( f );
									e.target.value = '';

								} }
							/>
							<span>导入材质参数…</span>
						</label>
					</Section>
				</div>
			</aside>
		</div>
	);
}

function Tab( { label, active, onClick }: { id: string; label: string; active: boolean; onClick: () => void } ) {
	return (
		<button type="button" className={ `tab${ active ? ' tab--on' : '' }` } onClick={ onClick }>
			{ label }
		</button>
	);
}

function StatusChip( { label, tone }: { label: string; tone: 'ok' | 'warn' | 'neutral' } ) {
	return <span className={ `chip chip--${ tone }` }>{ label }</span>;
}

interface CompareOverlayProps {
	presets: Preset[];
	onClose: () => void;
	onLoad: ( p: Preset ) => void;
	onDelete: ( id: string ) => void;
}

function CompareOverlay( { presets, onClose, onLoad, onDelete }: CompareOverlayProps ) {
	return (
		<div className="compare">
			<div className="compare__head">
				<h2>材质组合对比</h2>
				<button type="button" className="compare__close" onClick={ onClose } aria-label="关闭对比">
					×
				</button>
			</div>
			<div className={ `compare__grid compare__grid--${ Math.min( presets.length, 4 ) }` }>
				{ presets.map( ( p ) => (
					<figure key={ p.id } className="compare__card">
						<div className="compare__frame">
							{ p.thumbnail ? <img src={ p.thumbnail } alt={ p.name } /> : <span className="compare__empty">无缩略图</span> }
						</div>
						<figcaption>
							<span className="compare__name">{ p.name }</span>
							<span className="compare__sub">
								{ metalLabel( p.look.metal ) } · { cutLabel( p.look.cut ) }
							</span>
							<span className="compare__params">
								IOR {( p.look as Partial<MaterialLook> ).ior?.toFixed( 3 ) ?? '—' } · 色散 {( p.look as Partial<MaterialLook> ).dispersion?.toFixed( 1 ) ?? '—' } · 粗糙 {( p.look as Partial<MaterialLook> ).roughness?.toFixed( 2 ) ?? '—' }
							</span>
						</figcaption>
						<div className="compare__actions">
							<Button onClick={ () => onLoad( p ) }>载入</Button>
							<Button variant="danger" onClick={ () => onDelete( p.id ) }>删除</Button>
						</div>
					</figure>
				) ) }
			</div>
		</div>
	);
}

function metalLabel( id: MaterialLook[ 'metal' ] ): string {
	return METALS.find( ( m ) => m.id === id )?.label ?? id;
}

function cutLabel( id: MaterialLook[ 'cut' ] ): string {
	return CUTS.find( ( c ) => c.id === id )?.label ?? id;
}

/** Darken / lighten a hex colour by a ratio in -1..1. */
function shade( hex: string, ratio: number ): string {
	const n = parseInt( hex.slice( 1 ), 16 );
	const r = ( n >> 16 ) & 255, g = ( n >> 8 ) & 255, b = n & 255;
	const f = ( c: number ) => {
		const v = ratio < 0 ? c * ( 1 + ratio ) : c + ( 255 - c ) * ratio;
		return Math.round( Math.min( 255, Math.max( 0, v ) ) );
	};
	return `rgb(${ f( r ) }, ${ f( g ) }, ${ f( b ) })`;
}

function stamp(): string {
	const d = new Date();
	const p = ( n: number ) => String( n ).padStart( 2, '0' );
	return `${ d.getFullYear() }${ p( d.getMonth() + 1 ) }${ p( d.getDate() ) }-${ p( d.getHours() ) }${ p( d.getMinutes() ) }${ p( d.getSeconds() ) }`;
}
