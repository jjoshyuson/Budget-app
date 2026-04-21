# Pocket Budget Sync Hardening Notes

This file explains what changed in the Supabase integration, why it changed, and how to troubleshoot it later without reverse-engineering the whole app.

## What changed

### 1. Cloud sync no longer trusts fresh local defaults

The app now keeps local sync metadata in IndexedDB:

- active account id
- last local mutation timestamp
- last hydration timestamp

That metadata is used to decide whether to:

- load the remote snapshot
- keep the current local snapshot
- push the local snapshot to Supabase
- wipe stale local data on logout/account switch

This fixes the old bug where a fresh app startup could build a brand-new local payload with a fresh timestamp and accidentally overwrite valid cloud data.

### 2. Snapshot payload is versioned and structured

The synced snapshot now includes:

- `meta.schemaVersion`
- `meta.lastModifiedAt`
- `meta.lastCloudSyncAt`
- all current settings
- categories
- transactions
- bills
- `netPayHistory`

Older snapshots are normalized on import, including legacy `paychecks`.

### 3. Login / refresh / logout / account switch are safer

- On login, the app loads the correct snapshot for the signed-in `user_id`
- On refresh, the same account state is restored from Supabase Auth session persistence
- On logout, local synced budget data is cleared from the device so it does not leak to the next user
- On account switch, previous local data is not reused for the next account unless it was explicitly unsigned local data with no existing cloud snapshot

### 4. Net pay history is preserved

Net pay updates are now append-only history entries.

That means:

- the latest entry for the current cutoff is treated as the live net pay
- older entries are preserved
- deleting the latest one falls back to the next latest entry
- the history is included in the synced payload as `netPayHistory`

### 5. Delete account flow is truthful

The frontend only reports full delete success if:

1. the configured Edge Function exists
2. password re-auth succeeds
3. the Edge Function succeeds in deleting the auth user

If the function is missing or fails, the UI reports that honestly and does not pretend the account is gone.

## Files to know

- `src/main.ts`
  - auth/session flow
  - cloud hydration
  - mutation tracking
  - snapshot building
  - net pay history UI
- `src/cloud.ts`
  - Supabase auth/session helpers
  - snapshot load/save
  - delete-account Edge Function call
- `src/db.ts`
  - IndexedDB stores
  - local sync metadata store
  - reset/import helpers
- `src/types.ts`
  - synced snapshot structure
  - local sync metadata types
- `supabase/migrations/20260421_budget_sync_hardening.sql`
  - delete policies for app-side row deletes if needed

## Required env vars

These are needed for cloud sync:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

This one is needed if you want the in-app "Delete account and data" button to fully delete the auth account:

```env
VITE_SUPABASE_DELETE_ACCOUNT_FUNCTION=delete-account
```

## Supabase delete-account requirement

The frontend never uses the service role key.

If full account deletion is required, deploy an Edge Function that:

1. receives the user access token
2. validates the user from the token
3. uses the server-side service role key
4. calls `supabase.auth.admin.deleteUser(user.id)`

If this function is missing, the UI should show that account deletion is unavailable.

## How sync decisions now work

### On login

1. restore the session
2. fetch the user snapshot by authenticated `user_id`
3. compare remote snapshot timestamp vs local mutation timestamp
4. choose the newest valid source
5. mark the device as hydrated for that account

### On local mutation

Every budget mutation:

1. saves the local change
2. refreshes state
3. records a new local mutation timestamp
4. queues a cloud upsert

This applies to:

- transaction add/edit/delete
- bill add/delete
- category budget changes
- cycle/settings changes
- theme and accent changes
- net pay logging/deleting
- backup import

### On logout

1. stop pending cloud sync
2. clear local account-bound data
3. return to the auth gate

### On account switch

1. old user data is not reused blindly
2. the incoming account snapshot is loaded
3. if there is no cloud snapshot yet and the device only has unsigned local data, that data can be adopted once

## Troubleshooting checklist

### Problem: cloud data gets overwritten by empty/default local data

Check:

- `state.localMeta.activeUserId`
- `state.localMeta.lastMutationAt`
- `payload.meta.lastModifiedAt`
- whether the device is loading the wrong account before hydration completes

### Problem: a deleted item comes back

Check:

- whether the delete action called `recordLocalMutation()`
- whether the delete action called `queueCloudSync()`
- whether the user was online
- whether the remote snapshot newer than local got loaded later

### Problem: account switch shows another user’s old data

Check:

- logout path actually cleared local IndexedDB
- `localMeta.activeUserId`
- whether the next user has a remote snapshot

### Problem: delete account says unavailable

Check:

- `VITE_SUPABASE_DELETE_ACCOUNT_FUNCTION`
- Edge Function name matches exactly
- Edge Function is deployed
- function is using the service role key on the server side

### Problem: net pay looks wrong

Check:

- the latest `netPayHistory` entry for the current cycle
- `cycleStart` / `cycleEnd` of each net pay entry
- if an incorrect latest entry exists, delete it from history and the previous entry becomes active

## Recommended verification steps

### Sync across devices

1. Log in on device A
2. Add a bill and an expense
3. Confirm sync badge reaches synced state
4. Log in on device B with the same account
5. Confirm the same bill and expense appear

### Delete sync

1. Delete a bill on device A
2. Wait for sync
3. Refresh or log in on device B
4. Confirm the bill stays deleted

### Net pay history

1. Log net pay once for the active cutoff
2. Log net pay again with a different amount
3. Open Runway
4. Confirm both entries exist in history
5. Confirm the latest one is marked current
6. Delete the latest one
7. Confirm the previous one becomes current

### Logout / account switch

1. Log in as account A
2. Confirm data appears
3. Log out
4. Log in as account B
5. Confirm account A data does not appear unless it also exists in account B cloud snapshot
