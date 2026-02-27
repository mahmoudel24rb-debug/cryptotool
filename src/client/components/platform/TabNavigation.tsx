import React from 'react';
import { TABS, type TabId } from '../../hooks/useActiveTab';

interface Props {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  unreadAlerts: Record<TabId, number>;
}

export default function TabNavigation({ activeTab, onTabChange, unreadAlerts }: Props) {
  return (
    <div
      style={{
        height: 36,
        background: '#0d0d0d',
        borderBottom: '1px solid #1a1a2e',
        display: 'flex',
        alignItems: 'stretch',
        padding: '0 16px',
        gap: 0,
        flexShrink: 0,
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        const hasUnread = (unreadAlerts[tab.id] ?? 0) > 0;

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 20px',
              background: 'transparent',
              border: 'none',
              borderBottom: isActive ? `2px solid ${tab.themeColor}` : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 200ms',
              position: 'relative',
            }}
          >
            {/* Notification dot */}
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: hasUnread ? tab.themeColor : isActive ? tab.themeColor : '#333',
                transition: 'background 200ms',
                flexShrink: 0,
                animation: hasUnread && !isActive ? 'notifPulse 1s ease-in-out 5' : undefined,
              }}
            />

            {/* Label */}
            <span
              style={{
                fontFamily: "'JetBrains Mono', 'Source Code Pro', monospace",
                fontSize: 12,
                fontWeight: isActive ? 700 : 500,
                letterSpacing: 1,
                textTransform: 'uppercase' as const,
                color: isActive ? '#ffffff' : '#666666',
                transition: 'color 200ms',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                if (!isActive) (e.target as HTMLElement).style.color = '#aaaaaa';
              }}
              onMouseLeave={(e) => {
                if (!isActive) (e.target as HTMLElement).style.color = '#666666';
              }}
            >
              {tab.label}
            </span>

            {/* Shortcut hint */}
            <span
              style={{
                fontSize: 9,
                color: '#444',
                fontFamily: 'monospace',
              }}
            >
              {tab.shortcut.replace('Ctrl+', '^')}
            </span>
          </button>
        );
      })}
    </div>
  );
}
