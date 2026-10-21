import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { api } from '../lib/api/index.js'
import { friendlyError } from '../lib/errors.js'
import { rememberFacility } from '../lib/lastFacility.js'
import { AuthContext, FacilityContext, ToastContext } from './contexts.js'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // Facilities this account manages (from facility_members, via RLS). null = still loading; [] = a plain player.
  const [ownedFacilities, setOwnedFacilities] = useState(null)

  useEffect(() => {
    if (!user) { setOwnedFacilities(null); return undefined }
    let alive = true
    api.owner.myFacilities().then((l) => alive && setOwnedFacilities(l)).catch(() => alive && setOwnedFacilities([]))
    return () => { alive = false }
  }, [user])

  useEffect(() => {
    let alive = true
    api.auth.getUser().then((u) => {
      if (alive) {
        setUser(u)
        setLoading(false)
      }
    }).catch(() => alive && setLoading(false))
    const off = api.auth.onChange((u) => alive && setUser(u))
    return () => {
      alive = false
      off()
    }
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      // UI hint only. Platform-admin actions are re-checked server-side (platform_admins allow-list).
      isPlatformAdmin: !!user?.isPlatformAdmin,
      ownedFacilities: ownedFacilities || [],
      // "Owner" is never a flag on the user: it means a facility_members row exists (the database decides).
      isOwner: !!ownedFacilities?.length,
      rolesLoading: !!user && ownedFacilities === null,
      // call after creating a facility so the header switches to the owner navigation immediately
      refreshRoles: async () => setOwnedFacilities(await api.owner.myFacilities().catch(() => [])),
      signIn: async (email, password) => {
        await api.auth.signIn(email, password)
        setUser(await api.auth.getUser())
      },
      signUp: (payload) => api.auth.signUp(payload),
      signOut: async () => {
        await api.auth.signOut()
        setUser(null)
      },
      sendReset: (email) => api.auth.sendReset(email),
      updatePassword: (pw) => api.auth.updatePassword(pw),
      quickLogin: async (role) => setUser(await api.auth.quickLogin(role)),
    }),
    [user, loading, ownedFacilities],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Tenant site only: loads the facility for the current hostname (never trusts an id from the URL). */
export function FacilityProvider({ children }) {
  const [state, setState] = useState({ settings: null, courts: [], banners: [], tenantState: 'loading', loading: true, error: null })

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const r = await api.getFacility()
      setState({ settings: r.settings || null, courts: r.courts || [], banners: r.banners || [], tenantState: r.state, loading: false, error: null })
      if (r.state === 'live' && r.settings?.slug) rememberFacility(r.settings.slug)
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: friendlyError(e) }))
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const value = useMemo(() => ({ ...state, reload }), [state, reload])
  return <FacilityContext.Provider value={value}>{children}</FacilityContext.Provider>
}

const TONES = {
  success: { Icon: CheckCircle2, cls: 'bg-forest-900 text-white', icon: 'text-volt-400' },
  error: { Icon: AlertCircle, cls: 'bg-red-700 text-white', icon: 'text-red-200' },
  info: { Icon: Info, cls: 'bg-forest-900 text-white', icon: 'text-volt-400' },
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const toast = useCallback((message, tone = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setItems((l) => [...l, { id, message, tone }])
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 4200)
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6" role="status" aria-live="polite">
        {items.map((t) => {
          const { Icon, cls, icon } = TONES[t.tone] || TONES.info
          return (
            <div key={t.id} className={`rise pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl px-4 py-3 text-sm shadow-lift ${cls}`}>
              <Icon className={`mt-0.5 size-4 shrink-0 ${icon}`} aria-hidden />
              <span>{t.message}</span>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
