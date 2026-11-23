import { useCallback, useId, useRef, useState } from 'react';

interface SliderProps {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	/** Displayed unit; values are shown with `decimals`. */
	unit?: string;
	decimals?: number;
	/** Optional transform for the readout, e.g. show the value ×100 as %. */
	format?: ( v: number ) => string;
	onChange: ( v: number ) => void;
	onCommit?: () => void;
	hint?: string;
	disabled?: boolean;
}

export function Slider( { label, value, min, max, step = 0.01, unit, decimals = 2, format, onChange, onCommit, hint, disabled }: SliderProps ) {
	const id = useId();
	const [ dragging, setDragging ] = useState( false );
	const pct = max === min ? 0 : ( ( value - min ) / ( max - min ) ) * 100;
	const text = format ? format( value ) : `${ value.toFixed( decimals ) }${ unit ?? '' }`;

	return (
		<div className={ `slider${ disabled ? ' slider--disabled' : '' }` }>
			<div className="slider__head">
				<label htmlFor={ id } className="slider__label">
					{ label }
					{ hint && <span className="slider__hint" title={ hint }>?</span> }
				</label>
				<span className={ `slider__value${ dragging ? ' slider__value--active' : '' }` }>{ text }</span>
			</div>
			<input
				id={ id }
				type="range"
				min={ min }
				max={ max }
				step={ step }
				value={ value }
				disabled={ disabled }
				style={ { '--pct': `${ pct }%` } as React.CSSProperties }
				className="slider__input"
				onChange={ ( e ) => onChange( Number( e.target.value ) ) }
				onPointerDown={ () => setDragging( true ) }
				onPointerUp={ () => {

					setDragging( false );
					onCommit?.();

				} }
				onBlur={ () => {

					setDragging( false );
					onCommit?.();

				} }
			/>
		</div>
	);
}

interface SegmentedProps<T extends string> {
	value: T;
	options: Array<{ id: T; label: string; sub?: string }>;
	onChange: ( v: T ) => void;
	columns?: number;
	variant?: 'pill' | 'card';
}

export function Segmented<T extends string>( { value, options, onChange, columns, variant = 'pill' }: SegmentedProps<T> ) {
	return (
		<div
			className={ `seg seg--${ variant }` }
			style={ columns ? { gridTemplateColumns: `repeat(${ columns }, minmax(0, 1fr))` } : undefined }
			role="radiogroup"
		>
			{ options.map( ( o ) => (
				<button
					key={ o.id }
					type="button"
					role="radio"
					aria-checked={ value === o.id }
					className={ `seg__item${ value === o.id ? ' seg__item--on' : '' }` }
					onClick={ () => onChange( o.id ) }
				>
					<span className="seg__label">{ o.label }</span>
					{ o.sub && <span className="seg__sub">{ o.sub }</span> }
				</button>
			) ) }
		</div>
	);
}

interface ToggleProps {
	label: string;
	checked: boolean;
	onChange: ( v: boolean ) => void;
	hint?: string;
}

export function Toggle( { label, checked, onChange, hint }: ToggleProps ) {
	return (
		<button type="button" className="toggle" onClick={ () => onChange( ! checked ) } aria-pressed={ checked } title={ hint }>
			<span className={ `toggle__track${ checked ? ' toggle__track--on' : '' }` }>
				<span className="toggle__knob" />
			</span>
			<span className="toggle__label">{ label }</span>
		</button>
	);
}

interface ButtonProps {
	children: React.ReactNode;
	onClick?: () => void;
	variant?: 'primary' | 'ghost' | 'danger';
	icon?: React.ReactNode;
	disabled?: boolean;
	title?: string;
	className?: string;
}

export function Button( { children, onClick, variant = 'ghost', icon, disabled, title, className = '' }: ButtonProps ) {
	return (
		<button
			type="button"
			className={ `btn btn--${ variant } ${ className }` }
			onClick={ onClick }
			disabled={ disabled }
			title={ title }
		>
			{ icon && <span className="btn__icon">{ icon }</span> }
			{ children }
		</button>
	);
}

export function Section( { title, children, right, className = '' }: { title: string; children: React.ReactNode; right?: React.ReactNode; className?: string } ) {
	return (
		<section className={ `section ${ className }` }>
			<header className="section__head">
				<h2 className="section__title">{ title }</h2>
				{ right }
			</header>
			<div className="section__body">{ children }</div>
		</section>
	);
}

interface ColorSwatchProps {
	color: string;
	active?: boolean;
	onClick: () => void;
	label: string;
	hint?: string;
}

export function Swatch( { color, active, onClick, label, hint }: ColorSwatchProps ) {
	return (
		<button
			type="button"
			className={ `swatch${ active ? ' swatch--on' : '' }` }
			onClick={ onClick }
			title={ hint }
			aria-pressed={ active }
		>
			<span className="swatch__dot" style={ { background: color } } />
			<span className="swatch__label">{ label }</span>
		</button>
	);
}

/** A small numeric stepper shown next to a label. */
export function ValueNote( { children }: { children: React.ReactNode } ) {
	return <span className="value-note">{ children }</span>;
}

export function useDoubleClick( onClick: () => void ) {
	const last = useRef( 0 );
	return useCallback( () => {

		const now = performance.now();
		if ( now - last.current < 260 ) {

			onClick();
			last.current = 0;

		} else {

			last.current = now;

		}

	}, [ onClick ] );
}
