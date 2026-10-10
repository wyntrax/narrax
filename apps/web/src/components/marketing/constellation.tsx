'use client';
import {useEffect, useRef} from 'react';
export default function Constellation() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return; const ctx = canvas.getContext('2d'); if (!ctx) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)'); let frame = 0, time = 0; let px = 0, py = 0;
    const draw = () => {const dpr = Math.min(devicePixelRatio,2), w = canvas.clientWidth, h = canvas.clientHeight; if(canvas.width !== w*dpr || canvas.height !== h*dpr){canvas.width=w*dpr;canvas.height=h*dpr;} ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
      const colors = getComputedStyle(canvas); const points=Array.from({length:28},(_,i)=>({x:(.5+Math.cos(i*2.4)*(.12+(i%5)*.055))*w+Math.sin(time+i)*5+px,y:(.5+Math.sin(i*2.4)*(.12+(i%7)*.04))*h+Math.cos(time+i)*5+py}));
      ctx.strokeStyle=colors.getPropertyValue('--bd'); ctx.lineWidth=1;
      points.forEach((p,i)=>{points.slice(i+1).forEach(q=>{if(Math.hypot(q.x-p.x,q.y-p.y)<w*.2){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();}});ctx.fillStyle=colors.getPropertyValue(i%4===0?'--ac':'--ac2');ctx.globalAlpha=i%4===0?.8:.3;ctx.beginPath();ctx.arc(p.x,p.y,i%4===0?3:1.5,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;});
      if(!reduced.matches && !document.hidden){time+=.003;frame=requestAnimationFrame(draw);}
    };
    const move=(e:PointerEvent)=>{if(!reduced.matches){px=(e.clientX/innerWidth-.5)*12;py=(e.clientY/innerHeight-.5)*12;}};
    const restart=()=>{cancelAnimationFrame(frame); draw();}; const observer=new ResizeObserver(restart);observer.observe(canvas);document.addEventListener('pointermove',move);document.addEventListener('visibilitychange',restart);reduced.addEventListener('change',restart);draw();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('pointermove',move);document.removeEventListener('visibilitychange',restart);reduced.removeEventListener('change',restart);};
  },[]);
  return <canvas ref={ref} className="constellation" aria-hidden="true"/>;
}
