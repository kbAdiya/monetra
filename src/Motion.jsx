import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Check, X } from 'lucide-react';

const EXIT_MS = 160;
export const reducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
let activeTransition = null;
let transitionVersion = 0;

// Snapshot only named views; navigation and the rest of the layout stay still.
export function transitionView(update, afterUpdate) {
  const version = ++transitionVersion;
  activeTransition?.skipTransition();
  const commit = () => { if (version === transitionVersion) { flushSync(update); afterUpdate?.(); } };
  if (!document.startViewTransition || reducedMotion()) { commit(); return; }
  document.documentElement.dataset.pageTransition = 'true';
  const transition = document.startViewTransition(commit);
  activeTransition = transition;
  transition.finished.catch(() => {}).finally(() => {
    if (activeTransition === transition) {
      activeTransition = null;
      delete document.documentElement.dataset.pageTransition;
    }
  });
}

export function usePresence(show) {
  const [present, setPresent] = useState(show);
  useEffect(() => {
    if (show) { setPresent(true); return; }
    if (reducedMotion()) { setPresent(false); return; }
    const timer = setTimeout(() => setPresent(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [show]);
  return show || present;
}

export function PageView({ page, children }) {
  const ref = useRef(null), previous = useRef(page);
  useLayoutEffect(() => {
    if (previous.current !== page) {
      previous.current = page;
      ref.current?.focus({ preventScroll: true });
      window.scrollTo?.({ top: 0, behavior: 'instant' });
    }
  }, [page]);
  return <div key={page} ref={ref} className="page-view" data-page={page} data-fallback={!document.startViewTransition || undefined} tabIndex={-1}>{children}</div>;
}

export function Reveal({ open, children, className = '' }) {
  const present = usePresence(open), saved = useRef(children);
  if (open) saved.current = children;
  return <div className={`reveal ${open ? 'is-open' : ''} ${className}`} aria-hidden={!open} inert={!open ? '' : undefined}><div className="reveal-inner">{present && saved.current}</div></div>;
}

export function Modal({ open, onClose, busy = false, label, error, children }) {
  const present = usePresence(open), dialogRef = useRef(null), latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };
  useLayoutEffect(() => {
    if (!present) return;
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const native = typeof dialog.showModal === 'function';
    if (native) dialog.showModal(); else dialog.setAttribute('open', '');
    const background = !native ? document.querySelector('.app-shell') : null;
    const backgroundWasInert = background?.hasAttribute('inert');
    if (background) background.setAttribute('inert', '');
    const controls = () => [...dialog.querySelectorAll('button:enabled, input:enabled, select:enabled, textarea:enabled, a[href], [tabindex="0"]')].filter(el => !el.closest('[inert]'));
    (dialog.querySelector('[data-initial-focus]') || dialog.querySelector('input:enabled') || controls()[0] || dialog).focus({ preventScroll: true });
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); if (!latest.current.busy) latest.current.onClose(); }
      if (event.key === 'Tab') {
        const targets = controls(), first = targets[0], last = targets.at(-1);
        if (!first) { event.preventDefault(); dialog.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (native && dialog.open) dialog.close();
      if (background && !backgroundWasInert) background.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [present]);
  if (!present) return null;
  return createPortal(<dialog ref={dialogRef} className={`modal-dialog ${open ? 'is-open' : 'is-closing'}`} data-native={typeof window.HTMLDialogElement?.prototype.showModal === 'function'} aria-label={label} aria-modal="true" aria-busy={busy} role="dialog" tabIndex={-1} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className="modal" inert={!open ? '' : undefined}>{error && <p role="alert" className="modal-error">{error}</p>}{children}</div></dialog>, document.body);
}

export function Toast({ message, dismiss }) {
  const present = usePresence(Boolean(message)), saved = useRef(message);
  const dismissRef = useRef(dismiss);
  const [paused, setPaused] = useState(false);
  dismissRef.current = dismiss;
  if (message) saved.current = message;
  useEffect(() => {
    if (!message || paused) return;
    const timer = setTimeout(() => dismissRef.current(), 5500);
    return () => clearTimeout(timer);
  }, [message, paused]);
  if (!present) return null;
  return createPortal(<div className={`toast ${message ? 'is-open' : 'is-closing'}`} role={message ? 'status' : undefined} aria-hidden={!message} inert={!message ? '' : undefined} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}><span className="toast-icon"><Check size={16} /></span><span>{saved.current}</span><button className="icon-button" aria-label="Скрыть уведомление" onClick={dismiss}><X size={15} /></button></div>, document.body);
}
