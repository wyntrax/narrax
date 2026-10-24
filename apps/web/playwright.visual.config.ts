import {defineConfig} from '@playwright/test';
import config from './playwright.config';
export default defineConfig({...config,testDir:'./design-e2e',testMatch:'visual.spec.ts',timeout:60000,outputDir:'test-results/visual',snapshotPathTemplate:'{testDir}/../e2e/__screenshots__/{arg}{ext}',reporter:[['list']]});
