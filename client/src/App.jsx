import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { api } from './api.js';
import { Loading } from './ui.jsx';

import Login from './pages/Login.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import TenantProfile from './pages/TenantProfile.jsx';
import AssignTenant from './pages/AssignTenant.jsx';
import RecordPayment from './pages/RecordPayment.jsx';
import ReceiptPreview from './pages/ReceiptPreview.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import PastTenants from './pages/PastTenants.jsx';

function Protected({ children }) {
  const { landlord, loading } = useAuth();
  if (loading) return <Loading label="Starting RentReceipt…" />;
  if (!landlord) return <Navigate to="/login" replace />;
  return children;
}

function Header({ property }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const onDash = pathname === '/';
  const line = property?.propertyName
    ? `${property.propertyName} · 24 rooms · 48 beds`
    : '24 rooms · 48 beds';
  return (
    <header
      className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-line bg-white px-4 pb-2.5"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}
    >
      {!onDash && (
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-surface text-xl text-ink"
        >
          ←
        </button>
      )}
      <div className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-brand text-[17px] font-bold text-white">
        R
      </div>
      <div className="min-w-0">
        <div className="text-[17px] font-bold leading-tight tracking-tight">RentReceipt</div>
        <div className="truncate text-[11.5px] text-muted">{line}</div>
      </div>
    </header>
  );
}

function BottomNav() {
  const { pathname } = useLocation();
  const items = [
    { to: '/', label: 'Rooms', icon: '🏠' },
    { to: '/pay', label: 'Payment', icon: '💵' },
    { to: '/reports', label: 'Reports', icon: '📊' },
    { to: '/settings', label: 'Settings', icon: '⚙️' },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-2xl">
        {items.map((it) => {
          const active = it.to === '/' ? pathname === '/' : pathname.startsWith(it.to);
          return (
            <Link
              key={it.to}
              to={it.to}
              className={
                'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ' +
                (active ? 'text-brand' : 'text-vacant-text')
              }
            >
              <span className="text-xl">{it.icon}</span>
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function Shell({ children }) {
  const [property, setProperty] = useState(null);
  useEffect(() => {
    api.get('/settings').then(setProperty).catch(() => {});
  }, []);
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col bg-surface pb-[68px]">
      <Header property={property} />
      <main className="flex-1">{children}</main>
      <BottomNav />
    </div>
  );
}

export default function App() {
  const { landlord } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={landlord ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/reset" element={<ResetPassword />} />
      <Route
        path="/*"
        element={
          <Protected>
            <Shell>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/tenancy/:id" element={<TenantProfile />} />
                <Route path="/assign/:roomNumber/:bed" element={<AssignTenant />} />
                <Route path="/pay" element={<RecordPayment />} />
                <Route path="/receipt/:id" element={<ReceiptPreview />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/past" element={<PastTenants />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Shell>
          </Protected>
        }
      />
    </Routes>
  );
}
