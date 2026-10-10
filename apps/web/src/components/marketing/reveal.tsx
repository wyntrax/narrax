'use client';
import {motion, useReducedMotion} from 'motion/react';
import type {ReactNode} from 'react';
export function Reveal({children}: {children:ReactNode}) {const reduced = useReducedMotion(); return <motion.div className="reveal" initial={false} whileInView={reduced ? undefined : {y:[14,0], opacity:[.7,1]}} viewport={{once:true, amount:.15}} transition={{duration:.5}}>{children}</motion.div>;}
