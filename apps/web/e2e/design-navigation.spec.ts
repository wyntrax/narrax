import {test,expect} from '@playwright/test';
test('mobile menu traps focus, closes with Escape and returns focus; links are real',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');const trigger=page.getByRole('button',{name:'Menu',exact:true});await trigger.click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.getByRole('link',{name:'Product',exact:true})).toHaveAttribute('href','/#preview');
 for(let i=0;i<9;i++){await page.keyboard.press('Tab');expect(await dialog.evaluate(node=>node.contains(document.activeElement))).toBe(true);}
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();
});
test('reduced motion keeps the research diagram and copy while stopping graph motion',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await expect(page.locator('.signal-graph')).toBeVisible();await expect(page.locator('.graph-description')).toHaveText('Illustrated process · not live data');await expect(page.getByRole('heading',{level:1})).toContainText('See the narrative');await expect(page.getByRole('heading',{level:1})).toContainText('before the crowd does.');
 expect(await page.locator('.wire-flow path').evaluateAll(paths=>paths.every(el=>getComputedStyle(el).animationName==='none'))).toBe(true);expect(await page.locator('.core-orbit').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');await expect(page.locator('.graph-source')).toHaveCount(3);
});
test('every workflow connector moves, pauses offscreen and respects reduced motion',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/');await expect(page.locator('.signal-graph')).toHaveAttribute('data-visible','true');
 const paths=page.locator('.wire-flow path');await expect(paths).toHaveCount(5);
 const before=await paths.evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).strokeDashoffset));
 await expect.poll(()=>paths.evaluateAll((nodes,offsets)=>nodes.every((node,i)=>getComputedStyle(node).strokeDashoffset!==offsets[i]),before)).toBe(true);
 await page.locator('#faq').scrollIntoViewIfNeeded();await expect(page.locator('.signal-graph')).toHaveAttribute('data-visible','false');
 expect(await paths.evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).animationPlayState==='paused'))).toBe(true);
 await page.emulateMedia({reducedMotion:'reduce'});expect(await paths.evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).animationName==='none'))).toBe(true);
});
test('the full proof text can be scrolled with the keyboard',async({page})=>{
 await page.route('http://localhost:4000/**',route=>route.fulfill({headers:{'access-control-allow-origin':'http://localhost:4010'},json:new URL(route.request().url()).pathname==='/v1/public-config'?{privyAppId:null}:{enabled:true,seatsLeft:12,inviteRequired:false}}));
 await page.goto('/early-access?__designState=challenge');const proof=page.locator('.challenge-message');await expect(proof).toHaveAttribute('tabindex','0');await proof.focus();await expect(proof).toBeFocused();await page.keyboard.press('End');await expect.poll(()=>proof.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
});
