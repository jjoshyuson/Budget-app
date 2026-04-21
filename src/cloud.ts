import {
  createClient,
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js'
import type { BackupData, CloudProfile } from './types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

let client: SupabaseClient | null = null

export function isCloudConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey)
}

function getClient() {
  if (!isCloudConfigured()) return null
  if (!client) {
    client = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return client
}

function mapProfile(session: Session | null, displayName?: string | null): CloudProfile | null {
  if (!session?.user?.email) return null
  return {
    id: session.user.id,
    email: session.user.email,
    displayName: displayName || session.user.user_metadata?.display_name || session.user.email.split('@')[0],
  }
}

export async function getCurrentCloudProfile() {
  const supabase = getClient()
  if (!supabase) return null

  const [{ data: authData }, { data: profileData }] = await Promise.all([
    supabase.auth.getSession(),
    supabase.from('user_profiles').select('display_name').maybeSingle<{ display_name: string }>(),
  ])

  return mapProfile(authData.session, profileData?.display_name)
}

export function listenToAuthChanges(callback: (profile: CloudProfile | null, event: AuthChangeEvent) => void) {
  const supabase = getClient()
  if (!supabase) {
    return () => {}
  }

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange(async (event, session) => {
    let displayName: string | null = null
    if (session?.user) {
      const { data } = await supabase.from('user_profiles').select('display_name').maybeSingle<{ display_name: string }>()
      displayName = data?.display_name ?? null
    }
    callback(mapProfile(session, displayName), event)
  })

  return () => subscription.unsubscribe()
}

export async function signUpWithEmail(email: string, password: string, displayName: string) {
  const supabase = getClient()
  if (!supabase) {
    throw new Error('Cloud sync is not configured yet.')
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
      },
    },
  })

  if (error) throw error
  if (!data.user) {
    throw new Error('Could not create the account.')
  }

  const profile = {
    user_id: data.user.id,
    email: data.user.email || email,
    display_name: displayName || email.split('@')[0],
  }

  const { error: profileError } = await supabase.from('user_profiles').upsert(profile)
  if (profileError) throw profileError

  return {
    id: data.user.id,
    email: data.user.email || email,
    displayName: profile.display_name,
  } satisfies CloudProfile
}

export async function signInWithEmail(email: string, password: string) {
  const supabase = getClient()
  if (!supabase) {
    throw new Error('Cloud sync is not configured yet.')
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error

  const { data: profileData } = await supabase.from('user_profiles').select('display_name').maybeSingle<{ display_name: string }>()
  return mapProfile(data.session, profileData?.display_name)
}

export async function signOutCloud() {
  const supabase = getClient()
  if (!supabase) return
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function updateCloudProfile(displayName: string) {
  const supabase = getClient()
  if (!supabase) {
    throw new Error('Cloud sync is not configured yet.')
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.user) {
    throw new Error('Sign in first to update the profile.')
  }

  const trimmed = displayName.trim()
  const nextName = trimmed || session.user.email?.split('@')[0] || 'Pocket Budget'

  const [{ error: profileError }, { error: authError }] = await Promise.all([
    supabase.from('user_profiles').upsert({
      user_id: session.user.id,
      email: session.user.email || '',
      display_name: nextName,
    }),
    supabase.auth.updateUser({
      data: {
        display_name: nextName,
      },
    }),
  ])

  if (profileError) throw profileError
  if (authError) throw authError

  return {
    id: session.user.id,
    email: session.user.email || '',
    displayName: nextName,
  } satisfies CloudProfile
}

export async function saveCloudSnapshot(payload: BackupData) {
  const supabase = getClient()
  if (!supabase) {
    throw new Error('Cloud sync is not configured yet.')
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.user) {
    throw new Error('Sign in first to sync data.')
  }

  const { error } = await supabase.from('user_snapshots').upsert({
    user_id: session.user.id,
    payload,
    updated_at: new Date().toISOString(),
  })

  if (error) throw error
}

export async function loadCloudSnapshot() {
  const supabase = getClient()
  if (!supabase) return null

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.user) return null

  const { data, error } = await supabase
    .from('user_snapshots')
    .select('payload, updated_at')
    .eq('user_id', session.user.id)
    .maybeSingle<{ payload: BackupData; updated_at: string }>()

  if (error) throw error
  return data?.payload ?? null
}
