import {test,expect} from '@playwright/test';
test('mobile menu traps focus, closes with Escape and returns focus; links are real',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');const trigger=page.getByRole('button',{name:'[Menu]',exact:true});await trigger.click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.getByRole('link',{name:'[Product]',exact:true})).toHaveAttribute('href','/#preview');
 for(let i=0;i<9;i++){await page.keyboard.press('Tab');expect(await dialog.evaluate(node=>node.contains(document.activeElement))).toBe(true);}
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();
});
test('reduced motion keeps an original SVG poster and all hero copy without a canvas',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await expect(page.locator('.network-poster')).toBeVisible();await expect(page.locator('.network-canvas')).toHaveCount(0);await expect(page.getByRole('heading',{level:1})).toHaveText('See the narrative before the crowd does.');
});
test('the full proof text can be scrolled with the keyboard',async({page})=>{
 await page.route('http://localhost:4000/**',route=>route.fulfill({headers:{'access-control-allow-origin':'http://localhost:4010'},json:{enabled:true,seatsLeft:12,inviteRequired:false}}));
 await page.goto('/early-access?__designState=challenge');const proof=page.locator('.challenge-message');await expect(proof).toHaveAttribute('tabindex','0');await proof.focus();await expect(proof).toBeFocused();await page.keyboard.press('End');await expect.poll(()=>proof.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
});
