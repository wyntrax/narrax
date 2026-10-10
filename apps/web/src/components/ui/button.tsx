'use client';
import {forwardRef, type ButtonHTMLAttributes} from 'react';
import {Slot} from '@radix-ui/react-slot';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '@/lib/utils';
const variants = cva('button', {variants: {variant: {primary: 'button-primary', ghost: 'button-ghost', danger: 'button-danger'}}, defaultVariants: {variant: 'primary'}});
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof variants> & {asChild?: boolean}>(function Button({className, variant, asChild, ...props}, ref) {
  const Component = asChild ? Slot : 'button';
  return <Component ref={ref} className={cn(variants({variant}), className)} {...props}/>;
});
