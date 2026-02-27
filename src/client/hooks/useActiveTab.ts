import { useState, useEffect, useCallback } from 'react';

export type TabId = 'orderflow' | 'structure' | 'derivatives' | 'volume' | 'tools';

export interface TabDefinition {
  id: TabId;
  label: string;
  shortcut: string;
  themeColor: string;
}

export const TABS: TabDefinition[] = [
  { id: 'orderflow', label: 'ORDER FLOW', shortcut: 'Ctrl+1', themeColor: '#00d4ff' },
  { id: 'structure', label: 'STRUCTURE', shortcut: 'Ctrl+2', themeColor: '#ffd700' },
  { id: 'derivatives', label: 'DERIVATIVES', shortcut: 'Ctrl+3', themeColor: '#ff6b35' },
  { id: 'volume', label: 'VOLUME', shortcut: 'Ctrl+4', themeColor: '#a855f7' },
  { id: 'tools', label: 'TOOLS', shortcut: 'Ctrl+5', themeColor: '#22c55e' },
];

const TAB_ORDER: TabId[] = ['orderflow', 'structure', 'derivatives', 'volume', 'tools'];

export function useActiveTab() {
  const [activeTab, setActiveTab] = useState<TabId>('orderflow');

  // Ctrl+1..5 keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      const idx = parseInt(e.key) - 1;
      if (idx >= 0 && idx < TAB_ORDER.length) {
        e.preventDefault();
        setActiveTab(TAB_ORDER[idx]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const tabThemeColor = TABS.find(t => t.id === activeTab)?.themeColor ?? '#00d4ff';

  return { activeTab, setActiveTab, tabThemeColor };
}
