import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import en from '../messages/research/en.json';
import id from '../messages/research/id.json';

// Standalone CSS/layout fixtures: no API, provider, application DB or auth bypass.
for(const width of [1440,390])for(const theme of ['dark','light'])test(`agent layout ${width}px ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:1000});
 const m=width===390?id:en,a=m.agentUi;
 const css=['src/app/globals.css','src/app/[locale]/(app)/app/workspace.css','src/app/[locale]/(app)/app/workspace-design.css','src/features/research/chat.css'].map(file=>readFileSync(path.resolve(file),'utf8')).join('\n')+'\n:root{--font-body:Arial;--font-display:Arial;--font-workspace:Arial;--font-workspace-mono:monospace}';
 const welcome=`<section class="agent-welcome" aria-labelledby="welcome"><span class="agent-emblem" aria-hidden="true">✧</span><p class="agent-eyebrow">${a.eyebrow}</p><h2 id="welcome">${a.welcome}</h2><p class="agent-intro">${a.welcomeBody}</p><div class="agent-starters">${Object.values(a.prompts).map(p=>`<button class="agent-starter"><strong>${p.title}</strong><span>${p.description}</span><span class="agent-starter-action">${a.usePrompt} ↗</span></button>`).join('')}</div></section>`;
 const messages=`<div class="chat-log" role="log" aria-label="${a.conversation}"><article class="chat-turn chat-user"><div class="agent-turn-heading"><b>${m.chYou}</b></div><p class="chat-text">${a.prompts.narratives.question}</p></article><article class="chat-turn chat-assistant"><div class="agent-turn-heading"><span class="agent-avatar" aria-hidden="true">✧</span><b>${m.chAssistant}</b><button class="agent-copy">${a.copy}</button></div><p class="chat-text">${'Source-linked observations are incomplete. Review the available evidence before interpreting momentum.\n\n'.repeat(4)}${'LongTokenReference'.repeat(20)}</p><details class="agent-sources"><summary>Research tools used · 1</summary>getNarratives</details><div class="agent-suggestions"><b>${m.chSuggestions}</b><ul><li>Review liquidity and concentration.</li></ul><small>${m.chNotApplied}</small></div></article></div>`;
 for(const content of [welcome,messages]){
  await page.setContent(`<html lang="${width===390?'id':'en'}" data-theme="${theme}"><head><title>Agent layout fixture</title><style>${css}</style></head><body class="workspace-entry"><main style="padding:24px"><div class="agent-page"><header class="research-heading"><div><h1>${m.agent}</h1><p>${m.agentBody}</p></div><button class="research-control">${m.chNew}</button></header><div class="agent-safety"><span>${a.researchOnly}</span><span class="agent-safety-detail">${a.noActions}</span></div>${content}<div class="agent-composer-wrap"><form class="chat-form"><label for="chat-input">${m.chInput}</label><textarea id="chat-input" placeholder="${a.placeholder}" rows="3" aria-describedby="help"></textarea><div class="chat-actions"><small id="help">${a.shortcut}</small><div><small>0 / 2,000</small><button class="research-control" type="submit" disabled>${m.chSend}</button></div></div></form><p class="agent-disclaimer">${m.chNotice}</p></div></div></main></body></html>`);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator('.agent-page').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  const composer=page.locator('.agent-composer-wrap');
  expect(await composer.evaluate(el=>getComputedStyle(el).position)).toBe('static');
  const box=await composer.boundingBox();expect(box!.width).toBeLessThanOrEqual(720);
  expect((await page.locator('.chat-form').boundingBox())!.height).toBeLessThan(180);
  if(content===messages){
   const lastReply=await page.locator('.chat-turn').last().boundingBox();
   expect(box!.y).toBeGreaterThanOrEqual(lastReply!.y+lastReply!.height);
   await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
   const scrolled=await composer.boundingBox();
   expect(scrolled!.y).toBeLessThan(box!.y);
  }
  await expect(page.getByLabel(m.chInput)).toBeVisible();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:`test-results/agent-${width}-${theme}-${content===welcome?'welcome':'messages'}.png`,fullPage:true});
 }
});
