# Moon-Post-Service

## Vercel Deployment

### Environment Variables

The following environment variables must be configured in the Vercel project settings (Settings → Environment Variables):

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL (e.g. `https://your-project.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous/public API key |

These are injected at build time by Vite via `import.meta.env`. Do not commit actual values — use `.env.example` as a reference for local development.