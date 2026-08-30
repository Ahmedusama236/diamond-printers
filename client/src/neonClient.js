import { PostgrestClient } from "@supabase/postgrest-js";

const neonDataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL;

export const neon = neonDataApiUrl
  ? new PostgrestClient(neonDataApiUrl, {
      schema: "public",
    })
  : null;

export function requireNeon() {
  if (!neon) {
    throw new Error("Missing Neon configuration. Set VITE_NEON_DATA_API_URL.");
  }
  return neon;
}
