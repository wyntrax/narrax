'use client';
import {forwardRef, type ButtonHTMLAttributes} from 'react';
import {Slot} from '@radix-ui/react-slot';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '@/lib/utils';
const variants = cva('button', {variants: {variant: {primary: 'button-primary', ghost: 'button-ghost', danger: 'button-danger'}}, defaultVariants: {variant: 'primary'}});
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof variants> & {asChild?: boolean}>(function Button({className, variant, asChild, onPointerMove, onPointerLeave, ...props}, ref) {
  const Component = asChild ? Slot : 'button';
  return <Component ref={ref} className={cn(variants({variant}), className)} onPointerMove={e=>{if(e.currentTarget.closest('.marketing')&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const r=e.currentTarget.getBoundingClientRect();e.currentTarget.style.setProperty('--mag-x',`${(e.clientX-r.left-r.width/2)*.05}px`);e.currentTarget.style.setProperty('--mag-y',`${(e.clientY-r.top-r.height/2)*.1}px`);}onPointerMove?.(e);}} onPointerLeave={e=>{e.currentTarget.style.removeProperty('--mag-x');e.currentTarget.style.removeProperty('--mag-y');onPointerLeave?.(e);}} {...props}/>;
});
