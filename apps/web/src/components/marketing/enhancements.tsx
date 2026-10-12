'use client';
import {useEffect} from 'react';
export default function Enhancements(){useEffect(()=>{
 const root=document.querySelector<HTMLElement>('.marketing');if(!root)return;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(pointer: fine)');let frame=0;
 const seen=new WeakMap<Element,string>();
 function animateStates(){if(reduced.matches)return;root!.querySelectorAll<HTMLElement>('[data-access-state]').forEach(card=>{const state=card.dataset.accessState!;if(seen.get(card)===state)return;seen.set(card,state);card.animate([{opacity:.75,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'ease-out'});if(state==='active')card.querySelector('.status-icon')?.animate([{transform:'scale(.85)',opacity:.5},{transform:'scale(1)',opacity:1}],{duration:320,easing:'ease-out'});});}
 const observer=new MutationObserver(animateStates);observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-access-state']});animateStates();
 const move=(event:PointerEvent)=>{if(reduced.matches||!fine.matches)return;const target=event.target as Element,card=target.closest<HTMLElement>('.card'),button=target.closest<HTMLElement>('.button-primary');cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(card){const r=card.getBoundingClientRect();card.style.setProperty('--cursor-x',`${event.clientX-r.left}px`);card.style.setProperty('--cursor-y',`${event.clientY-r.top}px`);}if(button){const r=button.getBoundingClientRect();button.style.setProperty('--mag-x',`${(event.clientX-r.left-r.width/2)*.04}px`);button.style.setProperty('--mag-y',`${(event.clientY-r.top-r.height/2)*.06}px`);}});};
 const leave=(event:PointerEvent)=>{const button=(event.target as Element).closest<HTMLElement>('.button-primary');if(button){button.style.removeProperty('--mag-x');button.style.removeProperty('--mag-y');}};
 root.addEventListener('pointermove',move);root.addEventListener('pointerout',leave);return()=>{cancelAnimationFrame(frame);observer.disconnect();root.removeEventListener('pointermove',move);root.removeEventListener('pointerout',leave);};
 },[]);return null;}
