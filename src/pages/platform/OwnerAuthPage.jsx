import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Building2, FlaskConical, MailCheck } from 'lucide-react'
import { useAuth } from '../../context/contexts.js'
import { friendlyError } from '../../lib/errors.js'
import { demoHint, isDemo } from '../../lib/config.js'
import { Alert, Button, Field } from '../../components/ui.jsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Facility-OWNER registration / login — separate from the player login on each facility's site. */
export default function OwnerAuthPage({ initialMode = 'login' }) {
  const { user, loading, signIn, signUp, sendReset, quickLogin } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const next = loc.state?.from && !loc.state.from.startsWith('/owner/login') && !loc.state.from.startsWith('/owner/register') ? loc.state.from : '/owner'

  const [mode, setMode] = useState(initialMode)
  const [f, setF] = useState({ name: '', phone: '', email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  if (!loading && user && !done) return <Navigate to={next} replace />

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const switchMode = (m) => { setMode(m); setErrors({}); setFormError('') }

  const validate = () => {
    const e = {}
    if (mode === 'register') {
      if (f.name.trim().length < 2) e.name = 'Enter your full name.'
      if (!/^\d{10,15}$/.test(f.phone.replace(/\D/g, ''))) e.phone = 'Enter a valid mobile number (10–15 digits).'
    }
    if (!EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid email address.'
    if (mode !== 'forgot') {
      if (!f.password) e.password = 'Enter your password.'
      else if (mode === 'register' && f.password.length < 8) e.password = 'Use at least 8 characters.'
    }
    setErrors(e)
    return !Object.keys(e).length
  }

  const submit = async (ev) => {
    ev.preventDefault()
    setFormError('')
    if (!validate()) return
    setBusy(true)
    try {
      if (mode === 'login') {
        await signIn(f.email, f.password)
        nav(next, { replace: true })
      } else if (mode === 'register') {
        // Registering never grants any privilege: you become a facility owner only by creating a facility.
        const res = await signUp({ email: f.email, password: f.password, name: f.name.trim(), phone: f.phone.replace(/\D/g, ''), accountType: 'owner' })
        if (res.needsVerification) setDone('verify')
        else nav('/owner/setup', { replace: true })
      } else {
        await sendReset(f.email)
        setDone('reset')
      }
    } catch (err) {
      setFormError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const demoLogin = async (role, to) => {
    await quickLogin(role)
    nav(to, { replace: true })
  }

  if (done) {
    return (
      <Shell>
        <div className="text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-forest-900 text-volt-400"><MailCheck className="size-7" aria-hidden /></span>
          <h1 className="mt-5 text-2xl font-extrabold">{done === 'verify' ? 'Verify your email' : 'Check your inbox'}</h1>
          <p className="mt-2 text-muted">
            {done === 'verify'
              ? <>We sent a confirmation link to <strong className="text-ink">{f.email}</strong>. Open it and you’ll land in the facility setup wizard.</>
              : <>If an account exists for <strong className="text-ink">{f.email}</strong>, a password reset link is on its way.</>}
          </p>
          <Button className="mt-6 w-full" variant="dark" onClick={() => { setDone(null); switchMode('login') }}>Back to log in</Button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      {mode === 'forgot' && <button onClick={() => switchMode('login')} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden />Back</button>}
      <span className="grid size-11 place-items-center rounded-xl bg-forest-900 text-volt-400"><Building2 className="size-5" aria-hidden /></span>
      <h1 className="mt-4 text-3xl font-extrabold">{{ login: 'Owner login', register: 'Create your owner account', forgot: 'Reset your password' }[mode]}</h1>
      <p className="mt-1.5 text-muted">
        {mode === 'register' ? 'Register, then set up your facility and get your own booking website.' : mode === 'forgot' ? 'Enter your email and we’ll send a reset link.' : 'Manage your courts, bookings and payments.'}
      </p>

      {isDemo && (
        <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-900"><FlaskConical className="size-4" aria-hidden />Demo mode — no real accounts</p>
          {demoHint && <p className="mt-1 text-xs text-amber-900" role="note">{demoHint}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="dark" size="sm" onClick={() => demoLogin('owner', '/owner')}>Demo owner</Button>
            <Button variant="outline" size="sm" onClick={() => demoLogin('admin', '/platform')}>Demo platform admin</Button>
          </div>
          <p className="mt-2 text-xs text-amber-900/80">Or register below to try the setup wizard with a brand-new owner.</p>
        </div>
      )}

      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        {mode === 'register' && (
          <>
            <Field label="Full name" error={errors.name}><input className="input" autoComplete="name" value={f.name} onChange={set('name')} /></Field>
            <Field label="Mobile number" error={errors.phone} hint="Used for account recovery and by the platform team."><input className="input" type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} /></Field>
          </>
        )}
        <Field label="Email" error={errors.email}><input className="input" type="email" autoComplete="email" inputMode="email" value={f.email} onChange={set('email')} /></Field>
        {mode !== 'forgot' && (
          <Field label="Password" error={errors.password} hint={mode === 'register' ? 'At least 8 characters.' : undefined}>
            <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={f.password} onChange={set('password')} />
          </Field>
        )}
        {mode === 'login' && <div className="-mt-1 text-right"><button type="button" onClick={() => switchMode('forgot')} className="text-sm font-medium text-forest-600 hover:underline">Forgot password?</button></div>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>{{ login: 'Log in', register: 'Create account', forgot: 'Send reset link' }[mode]}</Button>
      </form>

      {mode !== 'forgot' && (
        <p className="mt-6 text-center text-sm text-muted">
          {mode === 'login' ? <>New facility? <button onClick={() => switchMode('register')} className="font-semibold text-forest-600 hover:underline">Create an owner account</button></>
            : <>Already registered? <button onClick={() => switchMode('login')} className="font-semibold text-forest-600 hover:underline">Log in</button></>}
        </p>
      )}
      <p className="mt-4 text-center text-xs text-muted">Players don’t need an owner account — they book on a facility’s own page. <Link to="/" className="underline">Back to home</Link></p>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <div className="container-page grid min-h-[70dvh] place-items-center py-10">
      <div className="card rise w-full max-w-md p-6 sm:p-8">{children}</div>
    </div>
  )
}
