import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Paste your Supabase project values here (Project Settings -> API).
// The anon key is designed to be public; row-level security protects the data.
export const SUPABASE_URL = 'https://qaevwxjyumqwtznjqnyy.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhZXZ3eGp5dW1xd3R6bmpxbnl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3Mjg3OTQsImV4cCI6MjEwNzMwNDc5NH0.xdiM9JJ_FsKJQHG2KFDNjwHIS5d98eS9grZnj8Q-EXQ';

export const isConfigured = !SUPABASE_URL.startsWith('PASTE') && !SUPABASE_ANON_KEY.startsWith('PASTE');

export const supabase = createClient(
  isConfigured ? SUPABASE_URL : 'https://placeholder.supabase.co',
  isConfigured ? SUPABASE_ANON_KEY : 'placeholder',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
