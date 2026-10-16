import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, FlaskConical, KeyRound, MailCheck, ShieldCheck } from 'lucide-react'
import { useAuth, useFacility } from '../context/contexts.js'
import { friendlyError } from '../lib/errors.js'
import { isDemo } from '../lib/config.js'
import { Alert, Button, Field } from '../components/ui.jsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function AuthPage() {
  const { user, loading, signIn, signUp, sendReset, quickLogin } = useAuth()
  const { settings } = useFacility()
  const nav = useNavigate()
  const loc = useLocation()
  const [params] = useSearchParams()
  const next = loc.state?.from && loc.state.from !== '/auth' ? loc.state.from : params.get('next') || '/'
  const draftNote = next === '/checkout'

  const [mode, setMode] = useState(params.get('mode') === 'signup' ? 'signup' : 'login')
  const [f, setF] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null) // 'verify' | 'reset'

  if (!loading && user && !done) return <Navigate to={next} replace />

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const switchMode = (m) => { setMode(m); setErrors({}); setFormError('') }

  const validate = () => {
    const e = {}
    if (!EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid email address.'
    if (mode !== 'forgot') {
      if (!f.password) e.password = 'Enter your password.'
      else if (mode === 'signup' && f.password.length < 8) e.password = 'Use at least 8 characters.'
    }
    setErrors(e)
    return Object.keys(e).length === 0
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
      } else if (mode === 'signup') {
        const res = await signUp({ email: f.email, password: f.password })
        if (res.needsVerification) setDone('verify')
        else nav(next, { replace: true })
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

  const demoLogin = async (role) => {
    await quickLogin(role)
    nav(role === 'owner' ? '/admin' : next, { replace: true })
  }

  if (done) {
    return (
      <Shell>
        <div className="text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-forest-900 text-volt-400"><MailCheck className="size-7" aria-hidden /></span>
          <h1 className="mt-5 text-2xl font-extrabold">{done === 'verify' ? 'Verify your email' : 'Check your inbox'}</h1>
          <p className="mt-2 text-muted">
            {done === 'verify'
              ? <>We sent a confirmation link to <strong className="text-ink">{f.email}</strong>. Open it, then come back and log in.</>
              : <>If an account exists for <strong className="text-ink">{f.email}</strong>, a password reset link is on its way.</>}
          </p>
          {draftNote && <p className="mt-2 text-sm text-muted">Your court selection is saved for this browser tab.</p>}
          <Button className="mt-6 w-full" variant="dark" onClick={() => { setDone(null); switchMode('login') }}>Back to log in</Button>
        </div>
      </Shell>
    )
  }

  const title = { login: 'Welcome back', signup: 'Create your account', forgot: 'Reset your password' }[mode]
  return (
    <Shell>
      {mode === 'forgot' && (
        <button onClick={() => switchMode('login')} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden />Back</button>
      )}
      <h1 className="text-3xl font-extrabold">{title}</h1>
      <p className="mt-1.5 text-muted">
        {mode === 'forgot' ? 'Enter your email and we’ll send a reset link.' : draftNote ? 'Log in with your email to confirm your booking — your selection is saved. We’ll ask for your name and mobile number next.' : `Log in to book courts and track your bookings at ${settings?.name || 'the facility'}.`}
      </p>

      {isDemo && (
        <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-900"><FlaskConical className="size-4" aria-hidden />Demo mode — no real accounts</p>
          <p className="mt-1 text-sm text-amber-900/80">Skip the form and explore with a pretend account. Nothing is sent anywhere.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="dark" size="sm" onClick={() => demoLogin('customer')}>Demo customer</Button>
            <Button variant="outline" size="sm" onClick={() => demoLogin('owner')}>Demo owner</Button>
          </div>
        </div>
      )}

      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <Field label="Email" error={errors.email}><input className="input" type="email" autoComplete="email" inputMode="email" value={f.email} onChange={set('email')} /></Field>
        {mode !== 'forgot' && (
          <Field label="Password" error={errors.password} hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
            <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={f.password} onChange={set('password')} />
          </Field>
        )}
        {mode === 'login' && (
          <div className="-mt-1 text-right"><button type="button" onClick={() => switchMode('forgot')} className="text-sm font-medium text-forest-600 hover:underline">Forgot password?</button></div>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {mode === 'login' ? 'Log in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </Button>
      </form>

      {mode !== 'forgot' && (
        <p className="mt-6 text-center text-sm text-muted">
          {mode === 'login' ? <>New here? <button onClick={() => switchMode('signup')} className="font-semibold text-forest-600 hover:underline">Create an account</button></>
            : <>Already have an account? <button onClick={() => switchMode('login')} className="font-semibold text-forest-600 hover:underline">Log in</button></>}
        </p>
      )}
      <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted"><ShieldCheck className="size-3.5" aria-hidden /><span>You can browse courts without an account. <Link to="/" className="underline">Back to booking</Link></span></p>
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

export function ResetPasswordPage() {
  const { user, loading, updatePassword } = useAuth()
  const nav = useNavigate()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (pw.length < 8) { setErr('Use at least 8 characters.'); return }
    setBusy(true); setErr('')
    try { await updatePassword(pw); setOk(true) } catch (x) { setErr(friendlyError(x)) } finally { setBusy(false) }
  }

  return (
    <Shell>
      <span className="grid size-12 place-items-center rounded-2xl bg-forest-900 text-volt-400"><KeyRound className="size-6" aria-hidden /></span>
      <h1 className="mt-4 text-2xl font-extrabold">Choose a new password</h1>
      {loading ? null : !user ? (
        <div className="mt-4 space-y-4">
          <Alert tone="warn">This reset link is invalid or has expired. Request a new one from the login page.</Alert>
          <Button to="/auth" variant="dark" className="w-full">Go to log in</Button>
        </div>
      ) : ok ? (
        <div className="mt-4 space-y-4">
          <Alert tone="success">Your password has been updated.</Alert>
          <Button className="w-full" onClick={() => nav('/')}>Continue</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
          {err && <Alert tone="error">{err}</Alert>}
          <Field label="New password" hint="At least 8 characters."><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Button type="submit" size="lg" className="w-full" loading={busy}>Update password</Button>
        </form>
      )}
    </Shell>
  )
}
