import React, { useRef, useEffect, useCallback } from 'react';

interface SignalContribution {
  name: string;
  weight: number;
  direction: 'LONG' | 'SHORT';
  timestamp: number;
  details?: string;
}

interface TradeScenario {
  id: string;
  templateName: string;
  templateId: number;
  direction: 'LONG' | 'SHORT';
  score: number;
  maxScore: number;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  status: 'PENDING' | 'ACTIVE' | 'TRIGGERED' | 'INVALIDATED' | 'EXPIRED';
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskReward: number;
  invalidationPrice: number;
  invalidationReason?: string;
  signals: SignalContribution[];
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
  timeframe: string;
  currentPrice: number;
}

interface Props {
  scenarios: TradeScenario[];
}

const PRIORITY_COLORS: Record<string, string> = {
  LOW: '#6b7280',
  MEDIUM: '#eab308',
  HIGH: '#f97316',
  EXTREME: '#ef4444',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#6b7280',
  ACTIVE: '#3b82f6',
  TRIGGERED: '#22c55e',
  INVALIDATED: '#ef4444',
  EXPIRED: '#4b5563',
};

const DIR_COLORS: Record<string, string> = {
  LONG: '#22c55e',
  SHORT: '#ef4444',
};

const HEADER_H = 22;

export default function ScenarioPanel({ scenarios }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollYRef = useRef(0);
  const contentHeightRef = useRef(0);

  // Measure a card's height (dry run, no drawing)
  const measureCard = useCallback((ctx: CanvasRenderingContext2D, sc: TradeScenario, W: number): number => {
    const pad = 8;
    let h = 4; // top padding
    h += 14; // line 1 (direction, score, priority)
    h += 12; // line 2 (template name)
    h += 11; // line 3 (entry, SL)
    h += 13; // line 4 (TPs, R:R)

    // Signals — need to measure wrapping
    ctx.font = '7px monospace';
    let sigX = pad + 6;
    for (const sig of sc.signals) {
      const tw = ctx.measureText(sig.name).width + 12;
      if (sigX + tw > W - pad) {
        sigX = pad + 6;
        h += 10;
      }
      sigX += tw + 3;
    }
    h += 12; // signals row

    h += 12; // status + expiration
    h += 14; // invalidation
    h += 4;  // separator
    return h;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = rect.width;
    const H = rect.height;
    const pad = 8;
    const scrollY = scrollYRef.current;

    // Background
    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, W, H);

    // Header (fixed)
    ctx.fillStyle = '#1a1f2e';
    ctx.fillRect(0, 0, W, 18);
    ctx.fillStyle = '#c084fc';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('SCENARIOS', pad, 13);
    ctx.fillStyle = '#6b7280';
    ctx.textAlign = 'right';
    ctx.font = '9px monospace';
    ctx.fillText(`${scenarios.length} active`, W - pad, 13);

    if (scenarios.length === 0) {
      ctx.fillStyle = '#4b5563';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No active scenarios', W / 2, 42);
      ctx.fillText('Waiting for confluence signals...', W / 2, 56);
      contentHeightRef.current = 0;
      return;
    }

    const sorted = [...scenarios].sort((a, b) => b.score - a.score);

    // Pass 1: Measure total content height
    let totalContentH = 0;
    const cardHeights: number[] = [];
    for (const sc of sorted) {
      const ch = measureCard(ctx, sc, W);
      cardHeights.push(ch);
      totalContentH += ch;
    }
    contentHeightRef.current = totalContentH;

    // Clip scrollable area
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HEADER_H, W, H - HEADER_H);
    ctx.clip();

    // Pass 2: Draw cards
    let y = HEADER_H - scrollY;

    for (let ci = 0; ci < sorted.length; ci++) {
      const sc = sorted[ci];
      const cardH = cardHeights[ci];
      const cardTop = y;

      // Skip if entirely above or below viewport
      if (y + cardH < HEADER_H) { y += cardH; continue; }
      if (y > H) break;

      // Card background
      ctx.fillStyle = '#111827';
      ctx.fillRect(pad - 2, y, W - pad * 2 + 4, cardH);

      // Direction sidebar
      const dirColor = DIR_COLORS[sc.direction] || '#6b7280';
      ctx.fillStyle = dirColor;
      ctx.fillRect(pad - 2, y, 3, cardH);

      y += 4;

      // Line 1: Direction | Score | Priority
      ctx.fillStyle = dirColor;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(sc.direction, pad + 6, y + 10);

      ctx.fillStyle = '#e5e7eb';
      ctx.font = '9px monospace';
      ctx.fillText(`Score: ${sc.score}`, pad + 48, y + 10);

      const prioColor = PRIORITY_COLORS[sc.priority] || '#6b7280';
      ctx.fillStyle = prioColor;
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(sc.priority, W - pad, y + 10);
      y += 14;

      // Line 2: Template name
      ctx.fillStyle = '#9ca3af';
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      const nameStr = sc.templateName.length > 35 ? sc.templateName.slice(0, 35) + '...' : sc.templateName;
      ctx.fillText(nameStr, pad + 6, y + 9);
      y += 12;

      // Line 3: Entry zone | SL
      ctx.fillStyle = '#d1d5db';
      ctx.font = '8px monospace';
      ctx.fillText(`Entry: $${sc.entryLow.toFixed(0)}-$${sc.entryHigh.toFixed(0)}`, pad + 6, y + 9);
      ctx.fillStyle = '#ef4444';
      ctx.textAlign = 'right';
      ctx.fillText(`SL: $${sc.stopLoss.toFixed(0)}`, W - pad, y + 9);
      y += 11;

      // Line 4: TPs + R:R
      ctx.textAlign = 'left';
      ctx.fillStyle = '#22c55e';
      ctx.fillText(`TP1: $${sc.tp1.toFixed(0)}`, pad + 6, y + 9);
      ctx.fillText(`TP2: $${sc.tp2.toFixed(0)}`, pad + 80, y + 9);
      ctx.fillStyle = '#a78bfa';
      ctx.textAlign = 'right';
      ctx.fillText(`R:R ${sc.riskReward}:1`, W - pad, y + 9);
      y += 13;

      // Signals (checkmarks)
      ctx.font = '7px monospace';
      ctx.textAlign = 'left';
      let sigX = pad + 6;
      for (const sig of sc.signals) {
        const label = sig.name;
        const tw = ctx.measureText(label).width + 12;
        if (sigX + tw > W - pad) {
          sigX = pad + 6;
          y += 10;
        }
        ctx.fillStyle = '#065f46';
        ctx.fillRect(sigX, y + 1, tw, 9);
        ctx.fillStyle = '#34d399';
        ctx.fillText(`\u2713 ${label}`, sigX + 2, y + 8);
        sigX += tw + 3;
      }
      y += 12;

      // Status + expiration
      const statusColor = STATUS_COLORS[sc.status] || '#6b7280';
      const remainMs = sc.expiresAt - Date.now();
      const remainMin = Math.max(0, Math.floor(remainMs / 60000));

      ctx.fillStyle = statusColor;
      ctx.font = 'bold 7px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(sc.status, pad + 6, y + 8);

      ctx.fillStyle = '#6b7280';
      ctx.font = '7px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`Expire: ${remainMin}m  |  ${sc.timeframe}`, W - pad, y + 8);
      y += 12;

      // Invalidation line
      if (sc.status !== 'INVALIDATED' && sc.status !== 'EXPIRED') {
        ctx.fillStyle = '#4b5563';
        ctx.font = '7px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`Invalidation: $${sc.invalidationPrice.toFixed(0)}`, pad + 6, y + 8);
      } else if (sc.invalidationReason) {
        ctx.fillStyle = '#ef4444';
        ctx.font = '7px monospace';
        ctx.fillText(sc.invalidationReason, pad + 6, y + 8);
      }
      y += 14;

      // Card bottom separator
      ctx.strokeStyle = '#1f2937';
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(W - pad, y);
      ctx.stroke();
      y += 4;
    }

    ctx.restore(); // end clip

    // Scrollbar indicator
    const viewportH = H - HEADER_H;
    if (totalContentH > viewportH) {
      const scrollbarH = Math.max(20, (viewportH / totalContentH) * viewportH);
      const maxScroll = totalContentH - viewportH;
      const scrollbarY = HEADER_H + (scrollY / maxScroll) * (viewportH - scrollbarH);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(W - 3, scrollbarY, 2, scrollbarH);
    }
  }, [scenarios, measureCard]);

  // Redraw on scenario/scroll changes
  useEffect(() => { draw(); }, [draw]);

  // Wheel scroll handler
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const viewportH = canvas.getBoundingClientRect().height - HEADER_H;
      const maxScroll = Math.max(0, contentHeightRef.current - viewportH);
      scrollYRef.current = Math.max(0, Math.min(maxScroll, scrollYRef.current + e.deltaY));
      draw();
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [draw]);

  // Resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => {
      const rect = parent.getBoundingClientRect();
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      draw();
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <div className="h-full w-full overflow-hidden" style={{ background: '#0a0e14' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}
