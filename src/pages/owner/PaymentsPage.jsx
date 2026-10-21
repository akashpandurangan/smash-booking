import { useMemo, useState } from 'react'
import { CheckCircle2, Copy, CreditCard, Link2Off, ShieldCheck, Undo2 } from 'lucide-react'
import { useFacility, useToast } from '../../context/contexts.js'
import { api } from '../../lib/api/index.js'
import { isDemo, supabaseUrl } from '../../lib/config.js'
import { friendlyError } from '../../lib/errors.js'
import { PAYMENT_STATUS } from '../../lib/status.js'
import { fmtDate, fmtSegments, money } from '../../lib/time.js'
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Field, Skeleton, Stat } from '../../components/ui.jsx'
import { copyText } from '../../components/LinkActions.jsx'
import { useAdmin } from './OwnerLayout.jsx'
import BookingModal from './BookingModal.jsx'

/** Payment history + connecting THIS facility's own Razorpay account. */
export default function PaymentsPage() {
  const { bookings, reload, reloadFacility } = useAdmin()
  const { settings } = useFacility()
  const toast = useToast()
  const [open, setOpen] = useState(null)
  const [rz, setRz] = useState({ keyId: '', keySecret: '', webhookSecret: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [disconnect, setDisconnect] = useState(false)

  const rows = useMemo(() => (bookings || []).filter((b) => b.paymentStatus !== 'unpaid').sort((a, b) => (b.paidAt || b.createdAt).localeCompare(a.paidAt || a.createdAt)), [bookings])
  const sum = (pred) => rows.filter(pred).reduce((s, b) => s + b.totalAmount, 0)
  const live = bookings?.find((b) => b.id === open?.id)
  const connected = settings.paymentMode === 'razorpay'
  const webhookUrl = `${supabaseUrl || 'https://<your-project>.supabase.co'}/functions/v1/razorpay-webhook?facility=${settings.id}`

  const connect = async (e) => {
    e.preventDefault()
    setErr('')
    if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(rz.keyId.trim())) { setErr('Key ID looks like rzp_test_… or rzp_live_…'); return }
    if (rz.keySecret.trim().length < 10) { setErr('Enter your Razorpay key secret.'); return }
    setBusy(true)
    try {
      await api.owner.savePaymentConfig(settings.id, { keyId: rz.keyId.trim(), keySecret: rz.keySecret.trim(), webhookSecret: rz.webhookSecret.trim() })
      setRz({ keyId: '', keySecret: '', webhookSecret: '' }) // the secret never stays in the browser
      toast('Razorpay connected')
      reloadFacility()
    } catch (x) { setErr(friendlyError(x)) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-8">
      <div><h1 className="text-3xl font-extrabold">Payments</h1><p className="text-muted">Players pay online straight into your own Razorpay account.</p></div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat icon={ShieldCheck} label="Verified online" value={money(sum((b) => b.paymentStatus === 'paid' && !b.needsRefund))} hint="Razorpay, server-verified" />
        <Stat icon={CreditCard} label="Paid at venue" value={money(sum((b) => b.paymentStatus === 'offline'))} />
        <Stat icon={CheckCircle2} label="Test payments" value={money(sum((b) => b.paymentStatus === 'demo'))} hint="Not real money" />
        <Stat icon={Undo2} label="Refunds due" value={money(sum((b) => b.needsRefund))} tone={sum((b) => b.needsRefund) ? 'text-red-600' : ''} />
      </div>

      <section className="card p-5 sm:p-6" aria-labelledby="rz-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="rz-h" className="text-lg font-bold">Razorpay account</h2>
          {connected ? <Badge tone="green"><CheckCircle2 className="size-3" aria-hidden />Connected · {settings.razorpayKeyId?.startsWith('rzp_live_') ? 'live' : 'test'} mode</Badge> : <Badge tone="amber">Not connected</Badge>}
        </div>
        {connected ? (
          <div className="mt-3 space-y-4">
            <p className="text-sm text-muted">Key ID <code className="rounded bg-paper px-1.5 py-0.5 font-mono">{settings.razorpayKeyId}</code>. The key secret is stored on the server only and can’t be viewed again.</p>
            <div className="rounded-xl bg-paper p-4 text-sm">
              <p className="font-semibold">Recommended: add this webhook in your Razorpay dashboard</p>
              <p className="mt-1 text-muted">So bookings still confirm if a player closes the tab right after paying. Events: <code>payment.captured</code>, <code>order.paid</code>. Use the same webhook secret you saved here.</p>
              <div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded-lg bg-white p-2 font-mono text-xs ring-1 ring-line">{webhookUrl}</code><Button size="sm" variant="outline" onClick={() => copyText(webhookUrl, toast, 'Webhook URL copied')} aria-label="Copy webhook URL"><Copy className="size-4" aria-hidden /></Button></div>
            </div>
            <Button variant="dangerOutline" onClick={() => setDisconnect(true)}><Link2Off className="size-4" aria-hidden />Disconnect Razorpay</Button>
          </div>
        ) : (
          <form onSubmit={connect} noValidate className="mt-3 space-y-4">
            <p className="text-sm text-muted">Create API keys in your Razorpay dashboard (start with <strong>Test mode</strong>). We verify them with Razorpay, then store the secret server-side only.</p>
            {err && <Alert tone="error">{err}</Alert>}
            {isDemo && <Alert tone="info">Demo mode never contacts Razorpay and never stores secrets — this only simulates the connection.</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Key ID"><input className="input" value={rz.keyId} onChange={(e) => setRz({ ...rz, keyId: e.target.value })} placeholder="rzp_test_…" autoComplete="off" spellCheck={false} /></Field>
              <Field label="Key Secret"><input className="input" type="password" value={rz.keySecret} onChange={(e) => setRz({ ...rz, keySecret: e.target.value })} autoComplete="new-password" /></Field>
              <Field label="Webhook secret (optional)" className="sm:col-span-2" hint="Choose any long random string, enter it here AND in the Razorpay webhook."><input className="input" type="password" value={rz.webhookSecret} onChange={(e) => setRz({ ...rz, webhookSecret: e.target.value })} autoComplete="new-password" /></Field>
            </div>
            <Button type="submit" loading={busy}>Verify & connect</Button>
            {!settings.allowDemoPayments && <p className="text-sm text-muted">Until you connect, players can reserve a slot but can’t pay.</p>}
          </form>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold">Payment history</h2>
        {!bookings ? <Skeleton className="h-40" /> : !rows.length ? (
          <EmptyState icon={CreditCard} title="No payments yet">Confirmed and paid bookings will be listed here.</EmptyState>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-paper text-xs uppercase tracking-wider text-muted">
                <tr>{['Paid', 'Reference', 'Customer', 'Booking', 'Amount', 'Status'].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((b) => (
                  <tr key={b.id} className="cursor-pointer hover:bg-paper/70" onClick={() => setOpen(b)}>
                    <td className="whitespace-nowrap px-4 py-3">{fmtDate((b.paidAt || b.createdAt).slice(0, 10))}</td>
                    <td className="px-4 py-3 font-mono text-xs"><button className="font-semibold hover:underline" onClick={(e) => { e.stopPropagation(); setOpen(b) }}>{b.reference}</button></td>
                    <td className="px-4 py-3">{b.customerName}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{fmtDate(b.date)} · {fmtSegments(b)}</td>
                    <td className="px-4 py-3 font-semibold">{money(b.totalAmount)}</td>
                    <td className="px-4 py-3"><Badge tone={PAYMENT_STATUS[b.paymentStatus]?.tone}>{PAYMENT_STATUS[b.paymentStatus]?.label}</Badge>{b.needsRefund && <p className="mt-1 text-xs font-semibold text-red-700">Refund due</p>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <BookingModal booking={live} onClose={() => setOpen(null)} onChanged={reload} />
      <ConfirmDialog open={disconnect} onClose={() => setDisconnect(false)} title="Disconnect Razorpay?" tone="danger" confirmLabel="Disconnect"
        message="Players won’t be able to pay online until you connect again. Existing confirmed bookings are not affected."
        onConfirm={async () => { await api.owner.removePaymentConfig(settings.id); setDisconnect(false); toast('Razorpay disconnected'); reloadFacility() }} />
    </div>
  )
}
