import { createClient } from '@supabase/supabase-js'
import { DEMO } from '../demo/demoMode'
import { createMockSupabase } from '../demo/mockSupabase'

export const supabase = DEMO ? createMockSupabase() : createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
