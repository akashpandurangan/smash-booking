import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, X, AlertTriangle, CheckCircle2, Info, TriangleAlert } from 'lucide-react'
import { STATUS } from '../lib/status.js'
import { friendlyError } from '../lib/errors.js'

const cx = (...a) => a.filter(Boolean).join(' ')

/* ---------- Button ---------- */
const BTN = {
  primary: 'bg-volt-400 text-forest-950 hover:bg-volt-300 active:bg-volt-500 shadow-[0_1px_0_rgb(0_0_0/0.08)]',
  dark: 'bg-forest-900 text-white hover:bg-forest-800 active:bg-forest-950',
  outline: 'border border-line bg-white text-ink hover:border-forest-600/40 hover:bg-paper',
  ghost: 'text-ink hover:bg-forest-900/5',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  dangerOutline: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
}
const SIZES = { sm: 'px-3 py-2 text-sm gap-1.5', md: 'px-4 py-3 text-[15px] gap-2', lg: 'px-5 py-3.5 text-base gap-2' }

export function Button({ variant = 'primary', size = 'md', loading, disabled, as, to, className, children, ...rest }) {
  const cls = cx(
    'inline-flex min-h-11 items-center justify-center rounded-xl font-semibold transition-all select-none',
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
    BTN[variant], SIZES[size], className,
  )
  if (to) return <Link to={to} className={cls} {...rest}>{children}</Link>
  const Tag = as || 'button'
  return (
    <Tag className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...(Tag === 'button' ? { type: rest.type || 'button' } : {})} {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </Tag>
  )
}

/* ---------- Badges ---------- */
const TONE = {
  amber: 'bg-amber-100 text-amber-900 ring-amber-200',
  blue: 'bg-sky-100 text-sky-900 ring-sky-200',
  green: 'bg-emerald-100 text-emerald-900 ring-emerald-200',
  red: 'bg-red-100 text-red-900 ring-red-200',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  lime: 'bg-volt-300/60 text-forest-900 ring-volt-400/50',
}
export function Badge({ tone = 'slate', children, className }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', TONE[tone], className)}>
      {children}
    </span>
  )
}
export function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, tone: 'slate' }
  return <Badge tone={s.tone}>{s.label}</Badge>
}

/* ---------- Feedback ---------- */
export function Spinner({ label = 'Loading…', className }) {
  return (
    <div className={cx('flex items-center justify-center gap-2 py-10 text-sm text-muted', className)} role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </div>
  )
}
export const Skeleton = ({ className }) => <div className={cx('skeleton', className)} aria-hidden />

const ALERT = {
  error: { cls: 'border-red-200 bg-red-50 text-red-900', Icon: AlertTriangle },
  success: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-900', Icon: CheckCircle2 },
  info: { cls: 'border-sky-200 bg-sky-50 text-sky-900', Icon: Info },
  warn: { cls: 'border-amber-200 bg-amber-50 text-amber-900', Icon: TriangleAlert },
}
export function Alert({ tone = 'info', title, children, className }) {
  const { cls, Icon } = ALERT[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-xl border p-3.5 text-sm', cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>
      </div>
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
      {Icon && (
        <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-forest-900 text-volt-400">
          <Icon className="size-6" aria-hidden />
        </span>
      )}
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/* ---------- Form field ---------- */
export function Field({ label, hint, error, children, className }) {
  const id = useId()
  const child = isValidElement(children)
    ? cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-e` : hint ? `${id}-h` : undefined })
    : children
  return (
    <div className={className}>
      <label htmlFor={id} className="label">{label}</label>
      {child}
      {error ? <p id={`${id}-e`} className="mt-1.5 text-sm text-red-700">{error}</p> : hint ? <p id={`${id}-h`} className="mt-1.5 text-sm text-muted">{hint}</p> : null}
    </div>
  )
}

/* ---------- Modal / bottom sheet ---------- */
export function Modal({ open, onClose, title, children, footer, wide }) {
  const ref = useRef(null)
  const titleId = useId()
  useEffect(() => {
    if (!open) return undefined
    const prev = document.activeElement
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.querySelector('[data-autofocus],input,textarea,select')?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      prev?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-forest-950/60" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={cx('sheet relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-white shadow-lift sm:rounded-3xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="-m-2 grid size-10 place-items-center rounded-full text-muted hover:bg-paper" aria-label="Close dialog">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  )
}

/** Confirmation dialog for sensitive actions; optionally requires a written reason. */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', tone = 'dark', requireReason, reasonLabel = 'Reason', onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (open) { setReason(''); setErr(''); setBusy(false) }
  }, [open])

  const submit = async () => {
    if (requireReason && reason.trim().length < 3) { setErr('Please enter a short reason (at least 3 characters).'); return }
    setBusy(true)
    setErr('')
    try {
      await onConfirm(reason.trim())
    } catch (e) {
      setErr(friendlyError(e))
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={title}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={busy}>Go back</Button>
        <Button variant={tone} onClick={submit} loading={busy}>{confirmLabel}</Button>
      </>}>
      <div className="space-y-4 text-[15px] text-muted">
        <div>{message}</div>
        {requireReason && (
          <Field label={reasonLabel} error={err}>
            <textarea className="input min-h-24" value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus maxLength={300} />
          </Field>
        )}
        {!requireReason && err && <Alert tone="error">{err}</Alert>}
      </div>
    </Modal>
  )
}

/* ---------- Small pieces ---------- */
export function Stat({ icon: Icon, label, value, hint, tone }) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center gap-2 text-sm text-muted">
        {Icon && <Icon className={cx('size-4', tone)} aria-hidden />} {label}
      </div>
      <p className="mt-2 font-display text-3xl font-extrabold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

export function DetailRow({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{children}</dd>
    </div>
  )
}
