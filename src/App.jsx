import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { loadDraft } from './lib/draft.js'
import { AuthProvider, FacilityProvider, ToastProvider } from './context/providers.jsx'
import { Layout } from './components/Layout.jsx'
import BookPage from './pages/BookPage.jsx'
import AuthPage, { ResetPasswordPage } from './pages/AuthPage.jsx'
import CheckoutPage from './pages/CheckoutPage.jsx'
import PaymentPage from './pages/PaymentPage.jsx'
import { BookingDetailPage, MyBookingsPage } from './pages/MyBookingsPage.jsx'
import AdminLayout from './pages/admin/AdminLayout.jsx'
import OverviewPage from './pages/admin/OverviewPage.jsx'
import BookingsPage from './pages/admin/BookingsPage.jsx'
import CourtsPage from './pages/admin/CourtsPage.jsx'
import SettingsPage from './pages/admin/SettingsPage.jsx'
import ActivityPage from './pages/admin/ActivityPage.jsx'
import { Button, EmptyState } from './components/ui.jsx'
import { Compass } from 'lucide-react'

// Target of the email-verification link: resume a saved booking if there is one.
function Continue() {
  return <Navigate to={loadDraft() ? '/checkout' : '/bookings'} replace />
}

function NotFound() {
  return (
    <div className="container-page max-w-xl py-16">
      <EmptyState icon={Compass} title="Page not found" action={<Button to="/">Back to booking</Button>}>That page doesn’t exist.</EmptyState>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
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
                <Route path="admin" element={<AdminLayout />}>
                  <Route index element={<OverviewPage />} />
                  <Route path="bookings" element={<BookingsPage />} />
                  <Route path="courts" element={<CourtsPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="activity" element={<ActivityPage />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </FacilityProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
