'use client';
import {useState, type HTMLAttributes, type ReactNode} from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import * as ToastPrimitive from '@radix-ui/react-toast';
import {useTranslations} from 'next-intl';
import {Button} from './button';
import {cn} from '@/lib/utils';
export function Card({className, ...props}: HTMLAttributes<HTMLDivElement>) { return <div className={cn('card', className)} onPointerMove={e => {if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty('--cursor-x', `${e.clientX - r.left}px`); e.currentTarget.style.setProperty('--cursor-y', `${e.clientY - r.top}px`);}} {...props}/>; }
export function Badge({children, className}: {children: ReactNode; className?: string}) {return <span className={cn('badge', className)}>{children}</span>;}
export const Pill = Badge;
export function Skeleton() {const t = useTranslations('common'); return <div role="status" className="skeleton-wrap"><span className="sr-only">{t('checking')}</span><div className="skeleton"/><div className="skeleton short"/></div>;}
export function Stepper({step}: {step: number}) {const t = useTranslations('access'); return <ol className="stepper" aria-label={t('steps')}>{['signIn', 'verifyWallet', 'join'].map((key, i) => <li key={key} aria-current={step === i + 1 ? 'step' : undefined} className={step > i + 1 ? 'complete' : ''}><span>{i + 1}</span>{t(key)}</li>)}</ol>;}
export function ConfirmDialog({trigger, title, description, onConfirm, disabled}: {trigger: string; title: string; description: string; onConfirm: () => void; disabled?: boolean}) {const [open, setOpen] = useState(false); const t = useTranslations('common'); return <DialogPrimitive.Root open={open} onOpenChange={setOpen}><DialogPrimitive.Trigger asChild><Button variant="ghost" disabled={disabled}>{trigger}</Button></DialogPrimitive.Trigger><DialogPrimitive.Portal><DialogPrimitive.Overlay className="dialog-overlay"/><DialogPrimitive.Content className="dialog-content"><DialogPrimitive.Title>{title}</DialogPrimitive.Title><DialogPrimitive.Description>{description}</DialogPrimitive.Description><div className="actions"><DialogPrimitive.Close asChild><Button variant="ghost">{t('cancel')}</Button></DialogPrimitive.Close><Button variant="danger" onClick={() => {setOpen(false); onConfirm();}}>{t('confirm')}</Button></div></DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;}
export const Dialog = DialogPrimitive;
export const Tabs = TabsPrimitive;
export function Accordion({items}: {items: {title: string; body: string}[]}) {return <AccordionPrimitive.Root type="single" collapsible className="accordion">{items.map((item, i) => <AccordionPrimitive.Item key={i} value={String(i)}><AccordionPrimitive.Header><AccordionPrimitive.Trigger>{item.title}<span aria-hidden>+</span></AccordionPrimitive.Trigger></AccordionPrimitive.Header><AccordionPrimitive.Content><p>{item.body}</p></AccordionPrimitive.Content></AccordionPrimitive.Item>)}</AccordionPrimitive.Root>;}
export function Toast({message, open, onOpenChange}: {message: string; open: boolean; onOpenChange: (open: boolean) => void}) {const t = useTranslations('common'); return <ToastPrimitive.Provider><ToastPrimitive.Root className="toast" open={open} onOpenChange={onOpenChange}><ToastPrimitive.Description>{message}</ToastPrimitive.Description><ToastPrimitive.Close aria-label={t('close')}>×</ToastPrimitive.Close></ToastPrimitive.Root><ToastPrimitive.Viewport className="toast-viewport"/></ToastPrimitive.Provider>;}
