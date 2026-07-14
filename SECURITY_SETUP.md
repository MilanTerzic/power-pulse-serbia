# Security setup

This dashboard uses Supabase/Lovable Cloud authentication. Do not add shared passwords or API tokens to frontend source.

Required deployment configuration:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `ENTSOE_API_TOKEN` for server-side ENTSO-E requests

Supabase Auth must have at least one sign-in method enabled, such as email/password or the Lovable OAuth provider. Protected TanStack server functions validate the Supabase bearer token and reject unauthenticated requests.

Logout clears the Supabase session. ENTSO-E and other private source credentials must remain server-side only.
