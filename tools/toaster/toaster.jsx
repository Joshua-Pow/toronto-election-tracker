// Mounts Sonner's <Toaster/> into #toaster-root and exposes window.notify(...) for the vanilla app.
// Bundled (React 18 + ReactDOM + sonner) into one self-hosted ESM file; Sonner's runtime <style> injection
// is stubbed out at build time and its stylesheet ships as /vendor/sonner/sonner.css, so the strict CSP holds.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, toast } from 'sonner';

const narrowQ = matchMedia('(max-width: 640px)');
function App() {
  const [narrow, setNarrow] = useState(narrowQ.matches);
  useEffect(() => { const on = () => setNarrow(narrowQ.matches); narrowQ.addEventListener('change', on); return () => narrowQ.removeEventListener('change', on); }, []);
  return React.createElement(Toaster, {
    position: narrow ? 'bottom-center' : 'bottom-right',
    duration: 4000, visibleToasts: 3, closeButton: true, gap: 10,
    offset: 16, mobileOffset: { bottom: 'max(16px, env(safe-area-inset-bottom))', left: 12, right: 12 },
    containerAriaLabel: 'Notifications',
    toastOptions: { classNames: { toast: 'rt-toast', title: 'rt-title', description: 'rt-desc', closeButton: 'rt-close' }, closeButtonAriaLabel: 'Dismiss notification' },
  });
}
// notify({ title, context, description, sample, tone, id, duration })
// Layout: a quiet eyebrow (SAMPLE DATA flag + place), one medium-weight title, a muted detail line.
const h = React.createElement;
function notify(o) {
  const opts = { description: o.description, id: o.id, duration: o.duration, className: [o.tone ? 'tone-' + o.tone : '', o.sample ? 'is-sample' : ''].join(' ').trim() || undefined };
  const eyebrow = (o.sample || o.context) ? h('span', { className: 'rt-eyebrow' },
    o.sample ? h('span', { className: 'rt-flag' }, 'Sample data') : null,
    o.context ? h('span', { className: 'rt-ctx' }, o.context) : null) : null;
  const title = h(React.Fragment, null, eyebrow, h('span', { className: 'rt-head' }, o.title));
  return toast(title, opts);
}
const el = document.getElementById('toaster-root');
if (el) {
  createRoot(el).render(React.createElement(App));
  window.notify = notify;
  window.notify.dismiss = (id) => toast.dismiss(id);
  (window.__notifyQ || []).splice(0).forEach(notify);
}
