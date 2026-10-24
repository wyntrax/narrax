import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';
for(const width of [1440,390])test(`auth recovery is centered and contained at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const css=['src/app/globals.css','src/app/[locale]/(app)/app/workspace.css','src/app/[locale]/(app)/app/workspace-design.css','src/components/auth/feedback.css'].map(file=>readFileSync(path.resolve(file),'utf8')).join('\n');
 await page.setContent(`<style>${css}</style><main class="workspace-gate gate-page"><div class="gate-card"><div role="alert" class="gate-message auth-feedback"><span class="auth-feedback-icon" aria-hidden="true">!</span><h2>Ada gangguan pada sesi Anda.</h2><p>Silakan coba lagi. Wallet dan akses tetap dalam kendali Anda.</p><button type="button" class="button button-ghost">Coba lagi</button></div></div></main>`);
 const card=page.locator('.gate-card'),button=page.getByRole('button',{name:'Coba lagi'}),message=page.getByRole('alert');
 const c=await card.boundingBox(),b=await button.boundingBox();expect(c).not.toBeNull();expect(b).not.toBeNull();
 expect(Math.abs((b!.x+b!.width/2)-(c!.x+c!.width/2))).toBeLessThan(2);
 expect(await message.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(b!.y).toBeGreaterThan((await message.locator('p').boundingBox())!.y);
 await button.focus();await expect(button).toBeFocused();
});
