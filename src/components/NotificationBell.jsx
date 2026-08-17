import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import useAppTranslation from '../hooks/useAppTranslation';
import { dateOnlyToLocalDate, formatAppDate } from '../utils/localeFormat';
import './NotificationBell.css';

/** How often the badge re-checks. Slow on purpose: a debt falling due is a daily fact, not a
 *  live feed, and a bell that polls every few seconds costs the server far more than it tells
 *  anyone. The count also refreshes whenever the panel is opened, which is when it matters. */
const POLL_MS = 120000;

/**
 * Render one notice in the reader's language.
 *
 * The server sends both a finished sentence and the pieces it was built from. The pieces win
 * when this build knows the `kind`, so a reminder reads in the UI's language; the sentence is
 * the fallback for a kind added on the server before the frontend learned about it. That way a
 * new sort of notice shows up saying something useful rather than appearing blank, which is
 * what a strict key lookup would do.
 */
export function renderNotice(notice, t) {
  const key = `kinds.${notice.kind}`;
  const ctx = notice.context || {};
  const values = {
    ...ctx,
    dueDate: ctx.due_date ? formatAppDate(dateOnlyToLocalDate(ctx.due_date)) : '',
    saleId: ctx.sale_id ?? '',
  };
  const title = t(`${key}.title`, { ...values, defaultValue: '' });
  const body = t(`${key}.body`, { ...values, defaultValue: '' });
  return {
    title: title || notice.title,
    body: body || notice.body,
  };
}

export default function NotificationBell() {
  const { t } = useAppTranslation(['notifications', 'common']);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);

  const refreshCount = useCallback(async () => {
    try {
      const res = await api.get('/notifications/unread_count/');
      setUnread(res.data?.unread ?? 0);
    } catch (error) {
      // A bell that cannot reach the server is not worth an error banner across the app — it
      // simply has nothing to say. Left silent on purpose.
      setUnread(0);
    }
  }, []);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(refreshCount, POLL_MS);
    return () => clearInterval(timer);
  }, [refreshCount]);

  // Clicking anywhere else closes the panel, as a dropdown should.
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/notifications/');
      setRows(Array.isArray(res.data) ? res.data : res.data?.results || []);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const togglePanel = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      loadRows();
      refreshCount();
    }
  };

  const openNotice = async (notice) => {
    setOpen(false);
    if (!notice.is_read) {
      try {
        const res = await api.post(`/notifications/${notice.id}/mark_read/`);
        setUnread(res.data?.unread ?? 0);
      } catch (error) {
        console.error('Error marking notification read:', error);
      }
    }
    if (notice.link) navigate(notice.link);
  };

  const markAllRead = async () => {
    try {
      const res = await api.post('/notifications/mark_all_read/');
      setUnread(res.data?.unread ?? 0);
      // Marked locally rather than refetched: the rows on screen are the ones just cleared, and
      // a round trip would blank the panel for a moment to show the same list back.
      setRows((prev) => prev.map((r) => ({ ...r, is_read: true })));
    } catch (error) {
      console.error('Error marking all notifications read:', error);
    }
  };

  const rendered = useMemo(
    () => rows.map((notice) => ({ notice, ...renderNotice(notice, t) })),
    [rows, t],
  );

  return (
    <div className="notif" ref={panelRef}>
      <button
        type="button"
        className="notif-bell"
        onClick={togglePanel}
        aria-label={t('title')}
        aria-expanded={open}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label={t('title')}>
          <div className="notif-panel-head">
            <strong>{t('title')}</strong>
            {rows.length > 0 && (
              <button type="button" className="notif-link-btn" onClick={markAllRead}>
                {t('markAllRead')}
              </button>
            )}
          </div>
          <div className="notif-list">
            {loading ? (
              <p className="notif-empty">{t('actions.loading', { ns: 'common' })}</p>
            ) : rendered.length === 0 ? (
              <p className="notif-empty">{t('empty')}</p>
            ) : (
              rendered.map(({ notice, title, body }) => (
                <button
                  key={notice.id}
                  type="button"
                  className={`notif-item notif-item--${notice.level} ${
                    notice.is_read ? 'notif-item--read' : ''
                  }`}
                  onClick={() => openNotice(notice)}
                >
                  <span className="notif-item-title">{title}</span>
                  {body && <span className="notif-item-body">{body}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
