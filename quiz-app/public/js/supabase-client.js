import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = localStorage.getItem('supabase_url') || '';
const SUPABASE_ANON_KEY = localStorage.getItem('supabase_anon_key') || '';

// If credentials aren't set in localStorage, wait for user to configure it, 
// or for deployment, these could be injected. 
// For this app we assume they are configured, but let's provide a fallback to window.env if available
const url = SUPABASE_URL || window.env?.SUPABASE_URL || 'https://cvixdvoneqaioshtvjva.supabase.co';
const key = SUPABASE_ANON_KEY || window.env?.SUPABASE_ANON_KEY || 'sb_publishable_odMSiyTsfrd0DbPgqkEbBQ_B6fzOEFs'; 
// Using the standard local dev key for ease, but typically this is built.

export const supabase = createClient(url, key);

export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function requireAuth() {
  const user = await getUser();
  if (!user) {
    window.location.href = '/index.html';
    return null;
  }
  return user;
}
