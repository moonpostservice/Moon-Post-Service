import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseAnonKey } from '../config.js';

export const sb = createClient(supabaseUrl, supabaseAnonKey);
