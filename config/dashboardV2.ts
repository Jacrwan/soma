/** Server/build configuration only. Never pass this environment to the browser. */
export function dashboardV2Enabled(env: Record<string, string | undefined>): boolean {
  if (env.DASHBOARD_V2 !== 'true') return false;
  if (env.DASHBOARD_V2_DATA_MODE === 'mock') {
    if (env.VERCEL_ENV === 'production') throw new Error('Dashboard V2 mock preview cannot ship to production.');
    return true;
  }
  if (env.VERCEL_ENV !== 'preview') {
    throw new Error('Dashboard V2 requires a Vercel preview environment.');
  }

  const preview = projectOrigin(env.VITE_SUPABASE_URL);
  const production = projectOrigin(env.SOMA_PRODUCTION_SUPABASE_URL);
  const approved = projectOrigin(env.SOMA_PREVIEW_SUPABASE_URL);
  if (!preview || !production || !approved || preview !== approved || preview === production) {
    throw new Error('Dashboard V2 requires a separate, explicitly identified preview Supabase project.');
  }
  if (env.SOMA_PREVIEW_ISOLATION_VERIFIED !== 'true') {
    throw new Error('Verify preview database keys, OAuth redirects, and webhook isolation before enabling Dashboard V2.');
  }
  return true;
}

function projectOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password ||
        url.search || url.hash || url.pathname !== '/') return null;
    return url.origin;
  } catch {
    return null;
  }
}
