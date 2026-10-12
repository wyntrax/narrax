'use client';
import {useEffect,useRef} from 'react';
type Point=[number,number,number];
// Original latitude mesh; software perspective only. No images, models, external hosts or WebGL dependency.
export default function Constellation(){const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{const canvas=ref.current,ctx=canvas?.getContext('2d');if(!canvas||!ctx)return;
  const points:Point[]=[],edges:[number,number][]=[];
  for(let y=0;y<7;y++)for(let x=0;x<12;x++){const lat=(y+1)*Math.PI/8,lon=x*Math.PI/6;points.push([Math.sin(lat)*Math.cos(lon),Math.cos(lat),Math.sin(lat)*Math.sin(lon)]);edges.push([y*12+x,y*12+(x+1)%12]);if(y>0)edges.push([y*12+x,(y-1)*12+x]);}
  let frame=0,last=0,angle=0,visible=false,px=0,py=0,width=0,height=0,cyan='',lime='';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(pointer: fine)');
  function colors(){const style=getComputedStyle(canvas!);cyan=style.getPropertyValue('--ac2').trim();lime=style.getPropertyValue('--ac').trim();}
  function resize(){const ratio=Math.min(devicePixelRatio,1.5);width=canvas!.clientWidth;height=canvas!.clientHeight;canvas!.width=width*ratio;canvas!.height=height*ratio;ctx!.setTransform(ratio,0,0,ratio,0,0);}
  function project(p:Point):[number,number,number]{const x=p[0]*Math.cos(angle)+p[2]*Math.sin(angle),z=p[2]*Math.cos(angle)-p[0]*Math.sin(angle),scale=1/(1-z*.15),r=Math.min(width,height)*.29;return [width/2+x*r*scale+px,height*.48+p[1]*r*scale+py,z];}
  function draw(){ctx!.clearRect(0,0,width,height);const projected=points.map(project);ctx!.lineWidth=.8;ctx!.strokeStyle=cyan;for(const [a,b]of edges){const p=projected[a]!,q=projected[b]!;ctx!.globalAlpha=.24+(p[2]+1)*.22;ctx!.beginPath();ctx!.moveTo(p[0],p[1]);ctx!.lineTo(q[0],q[1]);ctx!.stroke();}ctx!.globalAlpha=1;
   for(let ring=0;ring<3;ring++){ctx!.save();ctx!.translate(width/2+px,height*.48+py);ctx!.rotate((ring*62-28)*Math.PI/180);ctx!.strokeStyle=ring===1?lime:cyan;ctx!.globalAlpha=.35;ctx!.beginPath();ctx!.ellipse(0,0,Math.min(width,height)*.44,Math.min(width,height)*.13,0,0,Math.PI*2);ctx!.stroke();ctx!.restore();}
   projected.forEach((p,i)=>{ctx!.fillStyle=i%7===0?lime:cyan;ctx!.globalAlpha=.4+(p[2]+1)*.3;ctx!.beginPath();ctx!.arc(p[0],p[1],i%7===0?2.6:1.1,0,Math.PI*2);ctx!.fill();});ctx!.globalAlpha=1;
   for(let i=0;i<3;i++){const a=angle*.6+i*2.1,x=width/2+Math.cos(a)*width*.35,y=height*.48+Math.sin(a)*height*.31,r=i===0?16:10;ctx!.strokeStyle=i===1?cyan:lime;ctx!.lineWidth=1.4;ctx!.shadowColor=ctx!.strokeStyle as string;ctx!.shadowBlur=12;ctx!.beginPath();ctx!.moveTo(x,y-r);ctx!.lineTo(x+r,y);ctx!.lineTo(x,y+r);ctx!.lineTo(x-r,y);ctx!.closePath();ctx!.moveTo(x,y-r);ctx!.lineTo(x,y+r);ctx!.stroke();ctx!.shadowBlur=0;}
  }
  function tick(now:number){if(!visible||document.hidden||reduced.matches)return;if(now-last>=33){angle+=.003;last=now;draw();}frame=requestAnimationFrame(tick);}
  function resume(){cancelAnimationFrame(frame);if(visible&&!document.hidden&&!reduced.matches)frame=requestAnimationFrame(tick);}
  const observer=new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);resume();});observer.observe(canvas);
  const size=new ResizeObserver(()=>{resize();draw();});size.observe(canvas);
  const theme=new MutationObserver(()=>{colors();draw();});theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  const move=(e:PointerEvent)=>{if(fine.matches&&!reduced.matches){const box=canvas.getBoundingClientRect();px=(e.clientX-box.left-box.width/2)*.025;py=(e.clientY-box.top-box.height/2)*.025;}};
  canvas.addEventListener('pointermove',move);document.addEventListener('visibilitychange',resume);reduced.addEventListener('change',resume);colors();resize();draw();
  return()=>{cancelAnimationFrame(frame);observer.disconnect();size.disconnect();theme.disconnect();canvas.removeEventListener('pointermove',move);document.removeEventListener('visibilitychange',resume);reduced.removeEventListener('change',resume);};
 },[]);return <canvas ref={ref} className="network-canvas" aria-hidden="true"/>;
}
