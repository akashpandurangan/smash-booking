import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { loadDraft } from './lib/draft.js'
import { REDIRECTING, TENANT, isTenantSite } from './lib/tenant.js'
import { AuthProvider, FacilityProvider, ToastProvider } from './context/providers.jsx'
import { Layout, PlatformLayout } from './components/Layout.jsx'
import { Button, EmptyState } from './components/ui.jsx'
// facility (tenant) site — the player experience
import BookPage from './pages/BookPage.jsx'
import AuthPage, { ResetPasswordPage } from './pages/AuthPage.jsx'
import CheckoutPage from './pages/CheckoutPage.jsx'
import PaymentPage from './pages/PaymentPage.jsx'
import { BookingDetailPage, MyBookingsPage } from './pages/MyBookingsPage.jsx'
// platform site (primary domain)
import LandingPage from './pages/platform/LandingPage.jsx'
import OwnerAuthPage from './pages/platform/OwnerAuthPage.jsx'
import SetupWizard from './pages/platform/SetupWizard.jsx'
import { AdminFacilities, AdminOverview, AdminOwners, AdminSettings, PlatformAdminLayout } from './pages/platform/PlatformAdmin.jsx'
import OwnerLayout from './pages/owner/OwnerLayout.jsx'
import OverviewPage from './pages/owner/OverviewPage.jsx'
import BookingsPage from './pages/owner/BookingsPage.jsx'
import CalendarPage from './pages/owner/CalendarPage.jsx'
import CourtsPage from './pages/owner/CourtsPage.jsx'
import PaymentsPage from './pages/owner/PaymentsPage.jsx'
import BookingPagePage from './pages/owner/BookingPagePage.jsx'
import SettingsPage from './pages/owner/SettingsPage.jsx'
import ActivityPage from './pages/owner/ActivityPage.jsx'

// Target of the email-verification link: resume a saved booking if there is one.
function Continue() {
  return <Navigate to={loadDraft() ? '/checkout' : '/bookings'} replace />
}

function NotFound() {
  return (
    <div className="container-page max-w-xl py-16">
      <EmptyState icon={Compass} title="Page not found" action={<Button to="/">Back to home</Button>}>That page doesn’t exist.</EmptyState>
    </div>
  )
}

/** One shared app, two faces: a facility's booking site (tenant) or the platform (primary domain). */
function TenantRoutes() {
  return (
    <FacilityProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<BookPage />} />
          <Route path="auth" element={<AuthPage />} />
          <Route path="auth/reset" element={<ResetPasswordPage />} />
          <Route path="continue" element={<Continue />} />
          <Route path="checkout" element={<CheckoutPage />} />
          <Route path="pay/:id" element={<PaymentPage />} />
          <Route path="bookings" element={<MyBookingsPage />} />
          <Route path="bookings/:id" element={<BookingDetailPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </FacilityProvider>
  )
}

function PlatformRoutes() {
  return (
    <Routes>
      <Route element={<PlatformLayout />}>
        <Route index element={<LandingPage />} />
        <Route path="owner/login" element={<OwnerAuthPage initialMode="login" />} />
        <Route path="owner/register" element={<OwnerAuthPage initialMode="register" />} />
        <Route path="auth/reset" element={<ResetPasswordPage />} />
        <Route path="owner/setup" element={<SetupWizard />} />
        <Route path="owner" element={<OwnerLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="bookings" element={<BookingsPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="courts" element={<CourtsPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="page" element={<BookingPagePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="activity" element={<ActivityPage />} />
        </Route>
        <Route path="platform" element={<PlatformAdminLayout />}>
          <Route index element={<AdminOverview />} />
          <Route path="facilities" element={<AdminFacilities />} />
          <Route path="owners" element={<AdminOwners />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
        <Route path="admin/*" element={<Navigate to="/owner" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  if (REDIRECTING) return null // ?facility=slug → /book/slug
  return (
    <BrowserRouter basename={TENANT.basename}>
      <ToastProvider>
        <AuthProvider>{isTenantSite ? <TenantRoutes /> : <PlatformRoutes />}</AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
