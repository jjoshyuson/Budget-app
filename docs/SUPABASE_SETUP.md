# Pocket Budget Cloud Setup

This app stays local-first on the device and can sync to the cloud when a user is signed in.

## 1. Create a Supabase project

Create a new project in Supabase, then copy:

- Project URL
- Public anon key

Put them in:

- local `.env`
- GitHub repository secrets named `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- optional local `.env` value `VITE_SUPABASE_DELETE_ACCOUNT_FUNCTION=delete-account`

Use `.env.example` as the template.

## 2. Disable email confirmation

In Supabase Auth settings, turn off email confirmation. That matches the app flow: family users can register with email + password and sign in immediately.

## 3. Run this SQL

```sql
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.user_profiles enable row level security;
alter table public.user_snapshots enable row level security;

create policy "Users can read their own profile"
on public.user_profiles
for select
using (auth.uid() = user_id);

create policy "Users can write their own profile"
on public.user_profiles
for insert
with check (auth.uid() = user_id);

create policy "Users can update their own profile"
on public.user_profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can read their own snapshot"
on public.user_snapshots
for select
using (auth.uid() = user_id);

create policy "Users can write their own snapshot"
on public.user_snapshots
for insert
with check (auth.uid() = user_id);

create policy "Users can update their own snapshot"
on public.user_snapshots
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

## 4. GitHub Pages

This repo already includes `.github/workflows/deploy.yml`.

To publish:

1. Push the project to a GitHub repository
2. In the repository, open `Settings -> Pages`
3. Set the source to `GitHub Actions`
4. Add the two Supabase secrets
5. Push to `main`

The workflow builds the app and deploys `dist` to GitHub Pages.

## 4.5 Delete-account function

If you want the in-app "Delete account and data" button to remove the auth user too, deploy a Supabase Edge Function named `delete-account`.

Example:

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '')

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token)

  if (userError || !user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { error } = await supabase.auth.admin.deleteUser(user.id)
  if (error) {
    return new Response(error.message, { status: 400 })
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

Set the function name in the app with:

```env
VITE_SUPABASE_DELETE_ACCOUNT_FUNCTION=delete-account
```

## 5. What the app does

- Works offline with IndexedDB on the device
- Keeps the last signed-in session when possible
- Syncs the full budgeting snapshot to the cloud after local changes
- Pulls the latest cloud snapshot after sign-in

This is intentionally simple and family-friendly. It is not multi-user real-time collaboration yet.
