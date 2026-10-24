// The supplied Narrax symbol is an SVG mask, so theme changes never fetch another image.
export function BrandMark({className=''}:{className?:string}) {
 return <span className={`brand-mark ${className}`} aria-hidden="true"/>;
}
