import React, { useState, useEffect, useCallback } from 'react';
import type { TabId } from '../../hooks/useActiveTab';

export interface ToastItem {
  id: string;
  message: string;
  type: string;
  color: string;
  targetTab?: TabId;
  timestamp: number;
}

interface Props {
  onTabSwitch?: (tab: TabId) => void;
}

const TOAST_DURATION = 5000;
const MAX_TOASTS = 3;

// Singleton push function — set from inside the component
let pushToastFn: ((toast: Omit<ToastItem, 'id' | 'timestamp'>) => void) | null = null;

export function pushToast(toast: Omit<ToastItem, 'id' | 'timestamp'>) {
  if (pushToastFn) pushToastFn(toast);
}

export default function GlobalAlertToast({ onTabSwitch }: Props) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((toast: Omit<ToastItem, 'id' | 'timestamp'>) => {
    const item: ToastItem = {
      ...toast,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };
    setToasts(prev => [...prev.slice(-(MAX_TOASTS - 1)), item]);
  }, []);

  // Register singleton
  useEffect(() => {
    pushToastFn = addToast;
    return () => { pushToastFn = null; };
  }, [addToast]);

  // Auto-remove expired toasts
  useEffect(() => {
    if (toasts.length === 0) return;
    const id = setInterval(() => {
      setToasts(prev => prev.filter(t => Date.now() - t.timestamp < TOAST_DURATION));
    }, 500);
    return () => clearInterval(id);
  }, [toasts.length]);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 80,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => {
        const age = Date.now() - toast.timestamp;
        const exiting = age > TOAST_DURATION - 500;

        return (
          <div
            key={toast.id}
            onClick={() => {
              if (toast.targetTab && onTabSwitch) onTabSwitch(toast.targetTab);
              setToasts(prev => prev.filter(t => t.id !== toast.id));
            }}
            style={{
              width: 360,
              padding: '10px 14px',
              background: '#1a1a2e',
              borderLeft: `4px solid ${toast.color}`,
              borderRadius: 4,
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: '#e5e7eb',
              cursor: toast.targetTab ? 'pointer' : 'default',
              pointerEvents: 'auto',
              animation: exiting ? 'fadeOut 500ms ease-out forwards' : 'slideInRight 300ms ease-out',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: toast.color, fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>
                {toast.type}
              </span>
              <span style={{ color: '#4b5563', fontSize: 9 }}>
                {new Date(toast.timestamp).toLocaleTimeString('en-GB', { hour12: false })}
              </span>
            </div>
            <div>{toast.message}</div>
          </div>
        );
      })}
    </div>
  );
}
