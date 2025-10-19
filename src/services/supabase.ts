import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

let _supabase: SupabaseClient | null = null;

export const supabase = new Proxy({} as SupabaseClient, {
  get(target, prop) {
    if (!_supabase) {
      // Lazy initialization - only create client when first accessed
      dotenv.config();
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
      
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase configuration missing. Please set SUPABASE_URL and SUPABASE_SERVICE_KEY in your .env file.');
      }
      
      _supabase = createClient(supabaseUrl, supabaseKey);
    }
    return (_supabase as any)[prop];
  }
});