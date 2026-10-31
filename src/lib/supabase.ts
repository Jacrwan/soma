import { createClient } from '@supabase/supabase-js'
import { createDemoClient } from '../demo/client'

// `npm run demo` (and the lighter `npm run promo`) swaps in seeded, in-memory
// data for screen recordings.
export const supabase = import.meta.env.MODE === 'demo' || import.meta.env.MODE === 'promo'
  ? createDemoClient()
  : createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  )
