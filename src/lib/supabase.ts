import { createClient } from '@supabase/supabase-js'
import { createDemoClient } from '../demo/client'

// `npm run demo` swaps in seeded, in-memory data for screen recordings.
export const supabase = import.meta.env.MODE === 'demo'
  ? createDemoClient()
  : createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  )
