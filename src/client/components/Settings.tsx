import React, { useState, useEffect } from 'react';

interface SettingsProps {
  visible: boolean;
  onClose: () => void;
}

export default function Settings({ visible, onClose }: SettingsProps) {
  const [config, setConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      fetch('/api/config')
        .then(r => r.json())
        .then(setConfig)
        .catch(console.error);
    }
  }, [visible]);

  // Escape key to close
  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [visible, onClose]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      onClose();
    } catch (err) {
      console.error('Failed to save config:', err);
    }
    setSaving(false);
  };

  if (!visible || !config) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="panel bg-bg-secondary w-[600px] max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-dark">
          <span className="text-cyan-400 font-bold text-sm tracking-wider">SETTINGS</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg">×</button>
        </div>

        <div className="p-4 space-y-6 text-xs">
          {/* Exchanges */}
          <Section title="EXCHANGES">
            {Object.entries(config.exchanges || {}).map(([name, ex]: [string, any]) => (
              <div key={name} className="flex items-center justify-between py-1">
                <span className="text-gray-300 uppercase font-semibold">{name}</span>
                <div className="flex items-center gap-3">
                  <Toggle
                    label="Enabled"
                    value={ex.enabled}
                    onChange={v => setConfig({ ...config, exchanges: { ...config.exchanges, [name]: { ...ex, enabled: v } } })}
                  />
                  <Toggle
                    label="Spot"
                    value={ex.spot}
                    onChange={v => setConfig({ ...config, exchanges: { ...config.exchanges, [name]: { ...ex, spot: v } } })}
                  />
                  <Toggle
                    label="Perp"
                    value={ex.perp}
                    onChange={v => setConfig({ ...config, exchanges: { ...config.exchanges, [name]: { ...ex, perp: v } } })}
                  />
                </div>
              </div>
            ))}
          </Section>

          {/* Detectors */}
          {Object.entries(config.detectors || {}).map(([name, det]: [string, any]) => (
            <Section key={name} title={name.toUpperCase()}>
              <div className="flex items-center justify-between py-1 mb-2">
                <span className="text-gray-400">Enabled</span>
                <Toggle
                  value={det.enabled}
                  onChange={v => setConfig({
                    ...config,
                    detectors: { ...config.detectors, [name]: { ...det, enabled: v } },
                  })}
                />
              </div>
              {Object.entries(det).filter(([k]) => k !== 'enabled' && k !== 'micro').map(([k, v]) => (
                <NumberInput
                  key={k}
                  label={k}
                  value={v as number}
                  onChange={newV => setConfig({
                    ...config,
                    detectors: { ...config.detectors, [name]: { ...det, [k]: newV } },
                  })}
                />
              ))}
            </Section>
          ))}

          {/* Save button */}
          <button
            onClick={saveConfig}
            disabled={saving}
            className="w-full py-2 bg-cyan-500/20 text-cyan-400 font-bold tracking-wider border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors disabled:opacity-50"
          >
            {saving ? 'SAVING...' : 'SAVE SETTINGS'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-gray-400 font-bold text-[0.65rem] tracking-widest mb-2 border-b border-border-dark pb-1">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer">
      {label && <span className="text-gray-500 text-[0.6rem]">{label}</span>}
      <div
        onClick={() => onChange(!value)}
        className={`w-7 h-3.5 rounded-full relative transition-colors cursor-pointer ${
          value ? 'bg-cyan-500/50' : 'bg-gray-700'
        }`}
      >
        <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full transition-all ${
          value ? 'right-0.5 bg-cyan-400' : 'left-0.5 bg-gray-500'
        }`} />
      </div>
    </label>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-gray-500 text-[0.6rem]">{label}</span>
      <input
        type="number"
        value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-24 bg-bg-primary border border-border-dark text-gray-300 text-[0.65rem] px-2 py-0.5 text-right tabular-nums focus:outline-none focus:border-cyan-500/50"
      />
    </div>
  );
}
