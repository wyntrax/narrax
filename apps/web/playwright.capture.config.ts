import {defineConfig} from '@playwright/test';
import config from './playwright.config';
export default defineConfig({...config,testDir:'./design-e2e',testMatch:'capture.spec.ts',timeout:60000,outputDir:'test-results/design-capture',reporter:[['list']]});
