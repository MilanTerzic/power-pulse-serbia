# Security setup

This dashboard currently uses a single shared app password for the browser login.

Required deployment configuration:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `ENTSOE_API_TOKEN` for server-side ENTSO-E requests

Supabase is still used by features that store user-owned data, such as manual CBC positions and settings. Enable Supabase Auth if those features should be available per user.

Logout clears the local app session. ENTSO-E and other private source credentials must remain server-side only.
