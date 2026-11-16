import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { Loading } from './ui.jsx';

import Login from './pages/Login.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import ChangePasswordRequired from './pages/ChangePasswordRequired.jsx';
import Dashboard from './pages/Dashboard.jsx';
import TenantProfile from './pages/TenantProfile.jsx';
import AssignTenant from './pages/AssignTenant.jsx';
import RecordPayment from './pages/RecordPayment.jsx';
import ReceiptPreview from './pages/ReceiptPreview.jsx';
import Reports from './pages/Reports.jsx';
import ArrearsReport from './pages/ArrearsReport.jsx';
import Settings from './pages/Settings.jsx';
import PastTenants from './pages/PastTenants.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import AdminProperties from './pages/AdminProperties.jsx';
import AdminPropertyDetail from './pages/AdminPropertyDetail.jsx';
import AuditLog from './pages/AuditLog.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Starting RentReceipt…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <ChangePasswordRequired />;
  return children;
}

/** Only admins get through; the server enforces the same rule on every request. */
function AdminOnly({ children }) {
  const { isAdmin } = useAuth();
  return isAdmin ? children : <Navigate to="/" replace />;
}

function Header() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { properties, property, selectProperty, isAdmin } = useAuth();
  const onDash = pathname === '/';
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
      <div className="min-w-0 flex-1">
        <div className="text-[17px] font-bold leading-tight tracking-tight">RentReceipt</div>
        {properties.length > 1 ? (
          <select
            aria-label="Property"
            value={property?.id || ''}
            onChange={(e) => selectProperty(e.target.value)}
            className="-ml-1 max-w-full truncate bg-transparent text-[12.5px] font-semibold text-muted"
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        ) : (
          <div className="truncate text-[11.5px] text-muted">
            {property?.name || (isAdmin ? 'No property yet — add one in Admin' : 'No property assigned')}
          </div>
        )}
      </div>
    </header>
  );
}

function BottomNav() {
  const { pathname } = useLocation();
  const { isAdmin } = useAuth();
  const items = [
    { to: '/', label: 'Rooms', icon: '🏠' },
    { to: '/pay', label: 'Payment', icon: '💵' },
    { to: '/reports', label: 'Reports', icon: '📊' },
    ...(isAdmin ? [{ to: '/admin', label: 'Admin', icon: '🛡️' }] : []),
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
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col bg-surface pb-[68px]">
      <Header />
      <main className="flex-1">{children}</main>
      <BottomNav />
    </div>
  );
}

function AdminHome() {
  const items = [
    { to: '/admin/users', icon: '👥', title: 'Users', text: 'Add landlords and admins, reset passwords, unlock accounts' },
    { to: '/admin/properties', icon: '🏢', title: 'Properties & rooms', text: 'Add, edit, archive properties and their rooms' },
    { to: '/arrears', icon: '⚠️', title: 'Arrears', text: 'Who owes what; waive or add charges' },
    { to: '/admin/audit', icon: '📜', title: 'Audit log', text: 'Every change, who made it and when' },
  ];
  return (
    <div className="flex flex-col gap-2.5 px-3.5 pb-6 pt-4">
      <div className="text-[22px] font-bold tracking-tight">Admin</div>
      {items.map((it) => (
        <Link key={it.to} to={it.to} className="card flex items-center gap-3 px-4 py-3.5">
          <span className="text-2xl">{it.icon}</span>
          <div className="flex-1">
            <div className="font-semibold text-ink">{it.title}</div>
            <div className="text-xs text-muted">{it.text}</div>
          </div>
          <span className="text-vacant-border">›</span>
        </Link>
      ))}
    </div>
  );
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/reset" element={<ResetPassword />} />
      <Route
        path="/*"
        element={
          <Protected>
            <Shell>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/tenancy/:id" element={<TenantProfile />} />
                <Route path="/assign/:roomId/:bed" element={<AssignTenant />} />
                <Route path="/pay" element={<RecordPayment />} />
                <Route path="/receipt/:id" element={<ReceiptPreview />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/arrears" element={<ArrearsReport />} />
                <Route path="/past" element={<PastTenants />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/admin" element={<AdminOnly><AdminHome /></AdminOnly>} />
                <Route path="/admin/users" element={<AdminOnly><AdminUsers /></AdminOnly>} />
                <Route path="/admin/properties" element={<AdminOnly><AdminProperties /></AdminOnly>} />
                <Route path="/admin/properties/:id" element={<AdminOnly><AdminPropertyDetail /></AdminOnly>} />
                <Route path="/admin/audit" element={<AdminOnly><AuditLog /></AdminOnly>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Shell>
          </Protected>
        }
      />
    </Routes>
  );
}
