// Notices to tenants: general messages and rent increases (with at least 30
// days' notice), sent by email, plus the history of everything sent.
import { useEffect, useState } from 'react';
import { api, qs, formatK, toNgwee, fmtDay, perLabel, todayDay, addDaysTo } from '../api.js';
import { Loading, EmptyState, Modal, useToast, fmtDateTime } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

const NOTICE_DAYS = 30;
const KIND_LABEL = { MESSAGE: 'Message', RENT_INCREASE: 'Rent increase', RENT_INCREASE_CANCELLED: 'Rent increase cancelled' };
const STATUS_TEXT = { sent: 'Emailed', pending: 'Sending…', failed: 'Email failed', no_email: 'No email — tell them in person' };

/** "Whole property" or a set of ticked rooms. */
function RoomPicker({ rooms, value, onChange }) {
  const all = value.length === 0;
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div>
      <label className="field-label">Who</label>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onChange([])}
          className={'min-h-[44px] rounded-xl text-sm font-semibold ' + (all ? 'bg-brand text-white' : 'border border-line bg-white text-muted')}>Whole property</button>
        <button type="button" onClick={() => all && rooms[0] && onChange([rooms[0].id])}
          className={'min-h-[44px] rounded-xl text-sm font-semibold ' + (!all ? 'bg-brand text-white' : 'border border-line bg-white text-muted')}>Chosen rooms</button>
      </div>
      {!all && (
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {rooms.map((r) => (
            <button key={r.id} type="button" onClick={() => toggle(r.id)}
              className={'min-h-[40px] rounded-lg border text-[13px] font-semibold ' + (value.includes(r.id) ? 'border-brand bg-brand-light text-paid-text' : 'border-line bg-white text-muted')}>
              {r.number}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageForm({ propertyId, rooms, onSent }) {
  const toast = useToast();
  const [roomIds, setRoomIds] = useState([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!subject.trim() || !message.trim()) return toast.error('Please write a subject and a message.');
    if (!confirm('Send this message to the tenants now?')) return;
    setBusy(true);
    try {
      const r = await api.post('/notices', { propertyId, roomIds, subject, message });
      toast.success(`Sent to ${r.emailed} tenant${r.emailed === 1 ? '' : 's'} by email.`);
      if (r.noEmail.length) toast.info(`No email for: ${r.noEmail.join(', ')} — tell them in person.`);
      if (!r.emailConfigured) toast.error('Email is not set up on the platform yet, so nothing can be delivered until it is.');
      setSubject('');
      setMessage('');
      onSent();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card flex flex-col gap-3 p-4">
      <RoomPicker rooms={rooms} value={roomIds} onChange={setRoomIds} />
      <div><label className="field-label">Subject</label><input className="field-input" maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Water off on Friday" /></div>
      <div>
        <label className="field-label">Message</label>
        <textarea className="field-input min-h-[120px] py-3" maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. The water will be off from 9 to 12 for repairs." />
        <p className="mt-1 text-xs text-muted">Each tenant gets it by email, starting "Dear [their name]" and signed with the property's name.</p>
      </div>
      <button className="btn-primary w-full" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send message'}</button>
    </div>
  );
}

function RentIncreaseForm({ propertyId, rooms, cycle, onSent }) {
  const toast = useToast();
  const earliest = addDaysTo(todayDay(), NOTICE_DAYS);
  const [roomIds, setRoomIds] = useState([]);
  const [rent, setRent] = useState('');
  const [startsOn, setStartsOn] = useState(earliest);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const body = () => ({ propertyId, roomIds, newRent: toNgwee(rent) ?? 0, startsOn });

  const check = async () => {
    if (!(toNgwee(rent) > 0)) return toast.error('Please enter the new rent.');
    setBusy(true);
    try { setPreview(await api.post('/notices/rent-increases/preview', body())); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post('/notices/rent-increases', body());
      toast.success(`Rent increase announced to ${r.included.length} tenant${r.included.length === 1 ? '' : 's'}.`);
      if (r.notice.noEmail.length) toast.info(`No email for: ${r.notice.noEmail.join(', ')} — tell them in person.`);
      if (!r.emailConfigured) toast.error('Email is not set up on the platform yet, so the notices cannot be delivered until it is.');
      setPreview(null);
      setRent('');
      onSent();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const reset = (fn) => (v) => { setPreview(null); fn(v); };

  return (
    <div className="card flex flex-col gap-3 p-4">
      <RoomPicker rooms={rooms} value={roomIds} onChange={reset(setRoomIds)} />
      <div className="grid grid-cols-2 gap-3">
        <div><label className="field-label">New rent (K) {perLabel(cycle)}</label><input className="field-input" inputMode="decimal" value={rent} onChange={(e) => reset(setRent)(e.target.value)} /></div>
        <div><label className="field-label">Starts on</label><input className="field-input" type="date" min={earliest} value={startsOn} onChange={(e) => reset(setStartsOn)(e.target.value)} /></div>
      </div>
      <p className="text-xs text-muted">
        Tenants must get at least {NOTICE_DAYS} days' notice, so the earliest start is {fmtDay(earliest)}. Rent already billed never changes;
        {cycle === 'TERM' ? ' terms that start on or after this date' : ' months that start on or after this date'} use the new rent.
      </p>
      {!preview ? (
        <button className="btn-secondary w-full" onClick={check} disabled={busy}>{busy ? 'Checking…' : 'See who it affects'}</button>
      ) : (
        <>
          <div className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13.5px]">
            <div className="mb-1 font-bold">Will be told now ({preview.included.length})</div>
            {preview.included.length === 0 && <div className="text-muted">Nobody — see below.</div>}
            {preview.included.map((t) => (
              <div key={t.tenancyId} className="flex justify-between gap-2">
                <span className="truncate">{t.roomLabel} · {t.tenantName}{!t.email && <span className="text-due-text"> (no email)</span>}</span>
                <span className="flex-none">{formatK(t.oldRent)} → <strong>{formatK(t.newRent)}</strong></span>
              </div>
            ))}
            {preview.excluded.length > 0 && (
              <>
                <div className="mb-1 mt-2.5 font-bold text-muted">Left out ({preview.excluded.length})</div>
                {preview.excluded.map((t) => (
                  <div key={t.tenancyId} className="text-muted">{t.roomLabel} · {t.tenantName}: {t.reason}</div>
                ))}
              </>
            )}
            <div className="mt-2 text-xs text-muted">To leave someone out, choose rooms instead of the whole property.</div>
          </div>
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={() => setPreview(null)}>Change</button>
            <button className="btn-primary flex-1" onClick={send} disabled={busy || preview.included.length === 0}>{busy ? 'Sending…' : 'Send notice'}</button>
          </div>
        </>
      )}
    </div>
  );
}

function NoticeDetail({ id, onClose }) {
  const toast = useToast();
  const [n, setN] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => { api.get(`/notices/${id}`).then(setN).catch((e) => toast.error(e.message)); }, [id]);
  return (
    <Modal title={n ? n.subject : 'Notice'} onClose={onClose}>
      {!n ? <Loading /> : (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs text-muted">{KIND_LABEL[n.kind]} · {fmtDateTime(n.createdAt)}</div>
          {n.recipients.map((r) => (
            <div key={r.id} className="rounded-lg border border-line px-3 py-2 text-[13px]">
              <button className="flex w-full justify-between gap-2 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span className="font-semibold">{r.tenantName}</span>
                <span className={r.status === 'sent' ? 'text-paid-text' : r.status === 'pending' ? 'text-partial-text' : 'text-due-text'}>{STATUS_TEXT[r.status] || r.status}</span>
              </button>
              {r.status === 'failed' && r.lastError && <div className="text-[12px] text-due-text">{r.lastError}</div>}
              {open === r.id && <pre className="mt-2 whitespace-pre-wrap font-sans text-[12.5px] text-muted">{r.message}</pre>}
            </div>
          ))}
          <p className="mt-1 text-xs text-muted">Tap a name to see exactly what they were sent. Notices can't be edited after sending.</p>
        </div>
      )}
    </Modal>
  );
}

export default function Notices() {
  const toast = useToast();
  const { propertyId, property } = useAuth();
  const [tab, setTab] = useState('message');
  const [rooms, setRooms] = useState(null);
  const [history, setHistory] = useState(null);
  const [increases, setIncreases] = useState(null);
  const [showing, setShowing] = useState(null);

  const load = () => {
    if (!propertyId) return;
    api.get(`/notices${qs({ propertyId })}`).then(setHistory).catch((e) => toast.error(e.message));
    api.get(`/notices/rent-increases${qs({ propertyId })}`).then(setIncreases).catch((e) => toast.error(e.message));
  };
  useEffect(() => {
    if (!propertyId) return;
    api.get(`/properties/${propertyId}`).then((p) => setRooms(p.rooms.filter((r) => !r.archivedAt))).catch((e) => toast.error(e.message));
    load();
  }, [propertyId]);

  const cancel = async (inc) => {
    if (!confirm(`Cancel the rent increase to ${formatK(inc.newRent)} from ${fmtDay(inc.startsOn)}? The tenants will be emailed that it is off.`)) return;
    try {
      await api.post(`/notices/rent-increases/${inc.id}/cancel`, {});
      toast.success('Rent increase cancelled; tenants are being told.');
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (!propertyId) return <EmptyState icon="🏢" title="No property yet" message="Add a property first." />;
  if (!rooms || !history || !increases) return <Loading />;
  const cycle = property?.billingCycle || 'MONTHLY';

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-6 pt-4">
      <div className="text-[22px] font-bold tracking-tight">Notices</div>
      <div className="grid grid-cols-2 gap-2">
        {[['message', 'Send a message'], ['rent', 'Rent increase']].map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)}
            className={'rounded-xl px-4 py-2.5 text-sm font-semibold ' + (tab === v ? 'bg-brand text-white' : 'border border-line bg-white text-muted')}>{label}</button>
        ))}
      </div>

      {tab === 'message'
        ? <MessageForm propertyId={propertyId} rooms={rooms} onSent={load} />
        : <RentIncreaseForm propertyId={propertyId} rooms={rooms} cycle={cycle} onSent={load} />}

      {increases.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3 text-[15px] font-bold">Rent increases</div>
          {increases.map((inc) => (
            <div key={inc.id} className="flex items-center gap-2 border-b border-[#F0F2EE] px-4 py-2.5 text-[13px] last:border-0">
              <div className={'min-w-0 flex-1 ' + (inc.status === 'CANCELLED' ? 'text-muted line-through' : '')}>
                <div className="font-semibold">{formatK(inc.newRent)} {perLabel(cycle)} from {fmtDay(inc.startsOn)}</div>
                <div className="text-[12px] text-muted">{inc.tenants.length} tenant{inc.tenants.length === 1 ? '' : 's'} · {inc.roomIds ? `rooms ${inc.tenants.map((t) => t.roomLabel).join(', ')}` : 'whole property'}</div>
              </div>
              <span className="text-[12px] text-muted">{{ PLANNED: 'Planned', STARTED: 'In effect', CANCELLED: 'Cancelled' }[inc.status]}</span>
              {inc.status === 'PLANNED' && <button className="font-semibold text-due-text" onClick={() => cancel(inc)}>Cancel</button>}
            </div>
          ))}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3 text-[15px] font-bold">Sent</div>
        {history.length === 0 ? (
          <div className="px-4 py-3 text-sm text-muted">Nothing sent yet.</div>
        ) : history.map((n) => (
          <button key={n.id} onClick={() => setShowing(n.id)} className="flex w-full items-center gap-2 border-b border-[#F0F2EE] px-4 py-2.5 text-left text-[13px] last:border-0">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{n.subject}</div>
              <div className="text-[12px] text-muted">
                {KIND_LABEL[n.kind]} · {fmtDateTime(n.createdAt)} · {n.sent}/{n.recipients} emailed
                {n.pending > 0 && ` · ${n.pending} sending`}{n.failed > 0 && ` · ${n.failed} failed`}{n.noEmail > 0 && ` · ${n.noEmail} without email`}
              </div>
            </div>
            <span className="text-vacant-border">›</span>
          </button>
        ))}
      </div>
      {showing && <NoticeDetail id={showing} onClose={() => setShowing(null)} />}
    </div>
  );
}
