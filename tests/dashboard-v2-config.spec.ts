import { test, expect } from '@playwright/test';
import { dashboardV2Enabled } from '../config/dashboardV2';

const isolated = {
  DASHBOARD_V2: 'true',
  VERCEL_ENV: 'preview',
  VITE_SUPABASE_URL: 'https://preview.supabase.co',
  SOMA_PREVIEW_SUPABASE_URL: 'https://preview.supabase.co',
  SOMA_PRODUCTION_SUPABASE_URL: 'https://production.supabase.co',
  SOMA_PREVIEW_ISOLATION_VERIFIED: 'true',
};

test('flag defaults off without affecting existing builds', () => {
  expect(dashboardV2Enabled({})).toBe(false);
  expect(dashboardV2Enabled({ ...isolated, DASHBOARD_V2: 'false' })).toBe(false);
});

test('only an explicitly verified preview can enable the flag', () => {
  expect(dashboardV2Enabled(isolated)).toBe(true);
  for (const VERCEL_ENV of ['production', 'development', undefined]) {
    expect(() => dashboardV2Enabled({ ...isolated, VERCEL_ENV })).toThrow();
  }
  expect(() => dashboardV2Enabled({ ...isolated, SOMA_PREVIEW_ISOLATION_VERIFIED: undefined })).toThrow();
});

test('missing, mismatched, and production database targets are rejected', () => {
  for (const VITE_SUPABASE_URL of [undefined, 'invalid', 'http://preview.supabase.co',
    'https://production.supabase.co', 'https://other.supabase.co',
    'https://preview.supabase.co/another-schema']) {
    expect(() => dashboardV2Enabled({ ...isolated, VITE_SUPABASE_URL })).toThrow();
  }
  expect(() => dashboardV2Enabled({ ...isolated, SOMA_PRODUCTION_SUPABASE_URL: undefined })).toThrow();
  expect(() => dashboardV2Enabled({ ...isolated,
    SOMA_PRODUCTION_SUPABASE_URL: 'https://preview.supabase.co/' })).toThrow();
});

test('mock preview needs no database credentials and rejects production', () => {
  expect(dashboardV2Enabled({ DASHBOARD_V2: 'true', DASHBOARD_V2_DATA_MODE: 'mock' })).toBe(true);
  expect(() => dashboardV2Enabled({ DASHBOARD_V2: 'true', DASHBOARD_V2_DATA_MODE: 'mock', VERCEL_ENV: 'production' })).toThrow();
});
