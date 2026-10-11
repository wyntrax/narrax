import {defineConfig} from '@playwright/test';
import config from './playwright.config';
export default defineConfig({...config,testDir:'./production-e2e',outputDir:'test-results/production',reporter:[['list'],['html',{open:'never',outputFolder:'playwright-report/production'}]]});
