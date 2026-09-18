import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:['ai-backend.spec.ts','ai-actions.spec.ts'],fullyParallel:false,workers:1,timeout:10000});
