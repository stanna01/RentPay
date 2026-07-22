// Shared small UI pieces: Toast provider, Loading, EmptyState, StatusBadge, Money.
import { createContext, useCallback, useContext, useState } from 'react';
import { formatK } from './api.js';

// --- Toasts -----------------------------------------------------------------
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  const toast = {
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error'),
    info: (m) => push(m, 'info'),
  };
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              'w-max max-w-[85%] rounded-xl px-4 py-3 text-center text-sm font-semibold text-white shadow-lg ' +
              (t.type === 'error' ? 'bg-due-text' : 'bg-ink')
            }
            style={{ animation: 'toastIn .25s ease' }}
          >
            {t.message}
          </div>
        ))}
      </div>
      <style>{`@keyframes toastIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// --- Loading ----------------------------------------------------------------
export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-line border-t-brand" />
      <p className="mt-3 text-sm">{label}</p>
    </div>
  );
}

// --- Empty state ------------------------------------------------------------
export function EmptyState({ icon = '📭', title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 text-5xl">{icon}</div>
      <h3 className="text-lg font-bold text-ink">{title}</h3>
      {message && <p className="mt-1 max-w-xs text-sm text-muted">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// --- Status badge -----------------------------------------------------------
const STATUS_STYLES = {
  PAID: 'bg-paid-bg text-paid-text',
  PARTIAL: 'bg-partial-bg text-partial-text',
  DUE: 'bg-due-bg text-due-text',
  VACANT: 'bg-vacant-bg text-vacant-text',
};
const STATUS_LABEL = { PAID: 'Paid', PARTIAL: 'Partial', DUE: 'Due', VACANT: 'Vacant' };

export function StatusBadge({ status }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLES[status] || STATUS_STYLES.VACANT}`}
    >
      {STATUS_LABEL[status] || status}
    </span>
  );
}

// --- Money ------------------------------------------------------------------
export function Money({ ngwee, className = '' }) {
  return <span className={className}>{formatK(ngwee)}</span>;
}
