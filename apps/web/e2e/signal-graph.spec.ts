import {test,expect} from '@playwright/test';

for(const theme of ['dark','light'])test(`landing connectors follow mobile and desktop nodes (${theme})`,async({page})=>{
 test.setTimeout(120000);
 await page.context().addCookies([{name:'NARRA_THEME',value:theme,url:'http://localhost:4010'}]);
 await page.setViewportSize({width:390,height:1000});
 await page.goto('/',{waitUntil:'domcontentloaded'});
 const graph=page.locator('.signal-graph'),flow=graph.locator('.wire-flow path').first();
 for(const width of [390,360,700,768,1440,390]){
  await page.setViewportSize({width,height:1000});
  await graph.scrollIntoViewIfNeeded();
  await expect(graph).toHaveAttribute('data-visible','true');
  await expect(graph.locator('.graph-wires')).toBeVisible();
  // Every path must connect its actual card edges, not fixed desktop coordinates.
  await expect.poll(()=>graph.evaluate((root)=>{
   const svg=root.querySelector<SVGSVGElement>('.graph-wires')!,box=svg.getBoundingClientRect();
   const core=root.querySelector<HTMLElement>('.graph-core')!,emblem=root.querySelector<HTMLElement>('.core-emblem')!;
   const sources=[...root.querySelectorAll<HTMLElement>('.graph-source')],results=[...root.querySelectorAll<HTMLElement>('.graph-result')];
   const vertical=matchMedia('(max-width:700px)').matches;
   const anchor=(node:HTMLElement,edge:string)=>{const r=node.getBoundingClientRect();return {x:(edge==='left'?r.left:edge==='right'?r.right:r.left+r.width/2)-box.left,y:(edge==='top'?r.top:edge==='bottom'?r.bottom:r.top+r.height/2)-box.top};};
   return [...root.querySelectorAll<SVGPathElement>('.wire-base path')].every((path,i)=>{
    const a=i<3?anchor(sources[i]!,vertical?'bottom':'right'):anchor(vertical?core:emblem,vertical?'bottom':'right');
    const b=i<3?anchor(emblem,vertical?'top':'left'):anchor(results[i-3]!,vertical?'top':'left');
    const start=path.getPointAtLength(0),end=path.getPointAtLength(path.getTotalLength());
    return Math.hypot(start.x-a.x,start.y-a.y)<2&&Math.hypot(end.x-b.x,end.y-b.y)<2;
   });
  })).toBe(true);
  await expect(flow).toHaveCSS('animation-play-state','running');
  const before=await flow.evaluate(node=>getComputedStyle(node).strokeDashoffset);
  await expect.poll(()=>flow.evaluate(node=>getComputedStyle(node).strokeDashoffset)).not.toBe(before);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await graph.screenshot({path:`test-results/signal-graph-mobile-${theme}.png`});
 await page.locator('.site-footer').scrollIntoViewIfNeeded();
 await expect(graph).toHaveAttribute('data-visible','false');
 await expect(flow).toHaveCSS('animation-play-state','paused');
});

test('landing connectors respect reduced motion',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/',{waitUntil:'domcontentloaded'});
 const graph=page.locator('.signal-graph');await graph.scrollIntoViewIfNeeded();
 await expect(graph.locator('.wire-flow path').first()).toHaveCSS('animation-name','none');
 await expect(graph.locator('.core-orbit')).toHaveCSS('animation-name','none');
});
