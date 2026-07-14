import { supabase } from "@/integrations/supabase/client";

export async function hasSupabaseSession() {
  if (typeof window === "undefined") return false;
  const { data } = await supabase.auth.getSession();
  return !!data.session?.access_token;
}

export async function signOut() {
  await supabase.auth.signOut();
}
