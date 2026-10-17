import { useCallback, useEffect, useState } from 'react';
import { api, formatMoney } from './api';
import Avatar from './Avatar';

const POLL_MS = 30000;

// "Tom added "Dinner" · €72.00" (the actor is "You" on your own trip log)
export function describeActivity(a, actorName) {
  const what = a.description ? `"${a.description}"` : 'an expense';
  const verb = a.action === 'expense_deleted' ? 'deleted' : 'added';
  return `${actorName} ${verb} ${what} · ${formatMoney(a.amount_minor, a.currency)}`;
}

export function timeAgo(iso) {
  const minutes = Math.round((Date.now() - new Date(iso)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function NotificationBell({ onOpenTrip }) {
  const [data, setData] = useState({ unread: 0, notifications: [] });
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    api('/notifications').then(setData).catch(() => {});
  }, []);

  // Check for new ones every 30 seconds while the page is open.
  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const markAllRead = async () => {
    await api('/notifications/read', { method: 'POST' }).catch(() => {});
    load();
  };

  return (
    <div className="bell">
      <button
        className="secondary bell-button"
        aria-label={`Notifications${data.unread ? `, ${data.unread} unread` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        🔔{data.unread > 0 && <span className="badge">{data.unread}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <div className="bell-head">
            <strong>Notifications</strong>
            {data.unread > 0 && <button className="link" onClick={markAllRead}>Mark all read</button>}
          </div>
          {!data.notifications.length && <p className="muted small">Nothing yet.</p>}
          <ul>
            {data.notifications.map((n) => (
              <li key={n.id} className={n.read_at ? '' : 'unread'}>
                <button className="notification" onClick={() => onOpenTrip(n.group_id)}>
                  <Avatar username={n.actor_username} name={n.actor_name} size={32} />
                  <span className="notification-text">
                    <span>{describeActivity(n, n.actor_name)}</span>
                    {n.share_base_minor != null && (
                      <span className="muted small">
                        {n.action === 'expense_deleted' ? 'Your share was' : 'Your share'}{' '}
                        {formatMoney(n.share_base_minor, n.base_currency)}
                      </span>
                    )}
                    <span className="muted small">{n.trip_name} · {timeAgo(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
