import React, { useEffect, useRef } from 'react';

interface CvdPoint {
  time: number;
  value: number;
}

interface CvdChartProps {
  cvdData: CvdPoint[];
  title?: string;
}

const PADDING_RIGHT = 90;
const PADDING_BOTTOM = 30;
const PADDING_LEFT = 10;
const PADDING_TOP = 12;
const BG_COLOR = '#131722';
const GRID_COLOR = 'rgba(42, 46, 57, 0.5)';
const TEXT_COLOR = '#787b86';
const CROSSHAIR_COLOR = 'rgba(152, 157, 169, 0.25)';
const CVD_UP = '#26a69a';
const CVD_DOWN = '#ef5350';
const FONT = '"JetBrains Mono", monospace';

export default function CvdChart({ cvdData, title }: CvdChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number>(0);
  const dataRef = useRef(cvdData);

  const scrollOffsetRef = useRef(0);
  const autoScrollRef = useRef(true);
  const zoomLevelRef = useRef(1); // 1 = default, >1 = zoomed in, <1 = zoomed out
  const dragRef = useRef<{ active: boolean; startX: number; startOffset: number }>({
    active: false, startX: 0, startOffset: 0,
  });

  dataRef.current = cvdData;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let candleSpacing = 10;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;

      const targetW = Math.round(w * dpr);
      const targetH = Math.round(h * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, w, h);

      const data = dataRef.current;
      const chartW = w - PADDING_LEFT - PADDING_RIGHT;
      const chartH = h - PADDING_TOP - PADDING_BOTTOM;
      if (chartW <= 0 || chartH <= 0) return;

      if (data.length === 0) {
        ctx.fillStyle = TEXT_COLOR;
        ctx.font = `12px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for CVD data...', w / 2, h / 2);
        return;
      }

      const baseSpacing = Math.max(6, Math.min(14, Math.floor(chartW / 80)));
      candleSpacing = baseSpacing * zoomLevelRef.current;
      const maxVisible = Math.max(10, Math.floor(chartW / candleSpacing));

      if (autoScrollRef.current) scrollOffsetRef.current = 0;
      const maxOffset = Math.max(0, data.length - maxVisible);
      scrollOffsetRef.current = Math.max(0, Math.min(scrollOffsetRef.current, maxOffset));

      const endIdx = data.length - scrollOffsetRef.current;
      const startIdx = Math.max(0, endIdx - maxVisible);
      const visible = data.slice(startIdx, endIdx);
      if (visible.length === 0) return;

      // Value range
      let minVal = Infinity;
      let maxVal = -Infinity;
      for (const p of visible) {
        if (p.value < minVal) minVal = p.value;
        if (p.value > maxVal) maxVal = p.value;
      }
      const valRange = maxVal - minVal || 1;
      const margin = valRange * 0.08;
      minVal -= margin;
      maxVal += margin;
      const totalRange = maxVal - minVal;

      const valToY = (v: number) => PADDING_TOP + chartH * (1 - (v - minVal) / totalRange);
      const indexToX = (i: number) => PADDING_LEFT + candleSpacing / 2 + i * candleSpacing;

      // Zero line
      const zeroY = valToY(0);
      if (zeroY >= PADDING_TOP && zeroY <= PADDING_TOP + chartH) {
        ctx.strokeStyle = 'rgba(107, 114, 128, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(PADDING_LEFT, Math.round(zeroY) + 0.5);
        ctx.lineTo(PADDING_LEFT + chartW, Math.round(zeroY) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = TEXT_COLOR;
        ctx.font = `9px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText('0', PADDING_LEFT + chartW + 8, zeroY + 3);
      }

      // Grid
      ctx.font = `10px ${FONT}`;
      const targetHLines = Math.max(3, Math.floor(chartH / 50));
      const step = niceStep(totalRange, targetHLines);
      const firstVal = Math.ceil(minVal / step) * step;

      for (let v = firstVal; v <= maxVal; v += step) {
        const y = Math.round(valToY(v)) + 0.5;
        if (y < PADDING_TOP || y > PADDING_TOP + chartH) continue;

        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PADDING_LEFT, y);
        ctx.lineTo(PADDING_LEFT + chartW, y);
        ctx.stroke();

        ctx.fillStyle = TEXT_COLOR;
        ctx.textAlign = 'left';
        ctx.fillText(formatCvd(v), PADDING_LEFT + chartW + 8, y + 4);
      }

      // Time labels — ensure minimum pixel spacing so labels don't overlap
      const minLabelPx = 80;
      const labelEvery = Math.max(1, Math.ceil(minLabelPx / candleSpacing));
      // Align to round time intervals (every 5min, 15min, 1h etc.)
      const dataSpanSec = visible.length > 1 ? visible[visible.length - 1].time - visible[0].time : 0;
      const roundIntervals = [60, 300, 900, 1800, 3600, 7200, 14400, 86400];
      let timeRound = 300; // default 5min rounding
      for (const ri of roundIntervals) {
        const pointsPerInterval = ri / 60; // assuming ~1 point per minute
        if (pointsPerInterval >= labelEvery) { timeRound = ri; break; }
      }

      let lastLabelX = -Infinity;
      for (let i = 0; i < visible.length; i++) {
        // Only draw at round time boundaries
        if (visible[i].time % timeRound !== 0) continue;
        const x = Math.round(indexToX(i)) + 0.5;
        if (x - lastLabelX < minLabelPx) continue; // skip if too close

        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, PADDING_TOP);
        ctx.lineTo(x, PADDING_TOP + chartH);
        ctx.stroke();

        const d = new Date(visible[i].time * 1000);
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        // Show date if zoomed out enough to span multiple days
        let label = `${hh}:${mm}`;
        if (dataSpanSec > 86400) {
          const dd = String(d.getUTCDate()).padStart(2, '0');
          const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
          label = `${dd}/${mo} ${hh}:${mm}`;
        }
        ctx.fillStyle = TEXT_COLOR;
        ctx.font = `10px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(label, x, h - 6);
        lastLabelX = x;
      }

      // CVD area fill + line
      ctx.save();
      ctx.beginPath();
      ctx.rect(PADDING_LEFT, PADDING_TOP, chartW, chartH);
      ctx.clip();

      // Filled area from zero line
      for (let i = 0; i < visible.length; i++) {
        const x = indexToX(i);
        const y = valToY(visible[i].value);
        if (i === 0) {
          ctx.beginPath();
          ctx.moveTo(x, zeroY);
          ctx.lineTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      // Close back to zero line
      ctx.lineTo(indexToX(visible.length - 1), zeroY);
      ctx.closePath();

      const lastVal = visible[visible.length - 1].value;
      const fillGrad = ctx.createLinearGradient(0, PADDING_TOP, 0, PADDING_TOP + chartH);
      if (lastVal >= 0) {
        fillGrad.addColorStop(0, 'rgba(38, 166, 154, 0.25)');
        fillGrad.addColorStop(1, 'rgba(38, 166, 154, 0.02)');
      } else {
        fillGrad.addColorStop(0, 'rgba(239, 83, 80, 0.02)');
        fillGrad.addColorStop(1, 'rgba(239, 83, 80, 0.25)');
      }
      ctx.fillStyle = fillGrad;
      ctx.fill();

      // CVD line
      ctx.beginPath();
      for (let i = 0; i < visible.length; i++) {
        const x = indexToX(i);
        const y = valToY(visible[i].value);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = lastVal >= 0 ? CVD_UP : CVD_DOWN;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.restore();

      // Current CVD value label
      const lastPoint = visible[visible.length - 1];
      const lastPY = valToY(lastPoint.value);
      const isPositive = lastPoint.value >= 0;
      const labelColor = isPositive ? CVD_UP : CVD_DOWN;
      const cvdLabel = formatCvd(lastPoint.value);
      ctx.font = `11px ${FONT}`;
      const lblW = ctx.measureText(cvdLabel).width + 12;
      ctx.fillStyle = labelColor;
      roundRect(ctx, PADDING_LEFT + chartW + 1, lastPY - 10, lblW, 20, 3);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(cvdLabel, PADDING_LEFT + chartW + 7, lastPY + 4);

      // Crosshair
      const mouse = mouseRef.current;
      if (mouse && mouse.x >= PADDING_LEFT && mouse.x <= PADDING_LEFT + chartW
          && mouse.y >= PADDING_TOP && mouse.y <= PADDING_TOP + chartH) {
        ctx.strokeStyle = CROSSHAIR_COLOR;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        ctx.beginPath();
        ctx.moveTo(Math.round(mouse.x) + 0.5, PADDING_TOP);
        ctx.lineTo(Math.round(mouse.x) + 0.5, PADDING_TOP + chartH);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(PADDING_LEFT, Math.round(mouse.y) + 0.5);
        ctx.lineTo(PADDING_LEFT + chartW, Math.round(mouse.y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Axis borders
      ctx.strokeStyle = '#2a2e39';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PADDING_LEFT + chartW + 0.5, PADDING_TOP);
      ctx.lineTo(PADDING_LEFT + chartW + 0.5, PADDING_TOP + chartH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(PADDING_LEFT, PADDING_TOP + chartH + 0.5);
      ctx.lineTo(PADDING_LEFT + chartW, PADDING_TOP + chartH + 0.5);
      ctx.stroke();

      // "Go to latest" button
      if (!autoScrollRef.current) {
        const btnW = 24; const btnH = 20;
        const btnX = PADDING_LEFT + chartW - btnW - 8;
        const btnY = PADDING_TOP + 8;
        ctx.fillStyle = 'rgba(54, 58, 69, 0.85)';
        roundRect(ctx, btnX, btnY, btnW, btnH, 4);
        ctx.fill();
        ctx.fillStyle = '#d1d4dc';
        ctx.font = `14px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('\u00BB', btnX + btnW / 2, btnY + 15);
      }
    };

    const tick = () => { draw(); rafRef.current = requestAnimationFrame(tick); };
    rafRef.current = requestAnimationFrame(tick);

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (dragRef.current.active) {
        const dx = e.clientX - dragRef.current.startX;
        const candlesMoved = Math.round(dx / candleSpacing);
        scrollOffsetRef.current = Math.max(0, dragRef.current.startOffset + candlesMoved);
        autoScrollRef.current = scrollOffsetRef.current === 0;
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      dragRef.current = { active: true, startX: e.clientX, startOffset: scrollOffsetRef.current };
      canvas.style.cursor = 'grabbing';
    };
    const onMouseUp = () => { dragRef.current.active = false; canvas.style.cursor = 'crosshair'; };
    const onMouseLeave = () => { mouseRef.current = null; dragRef.current.active = false; canvas.style.cursor = 'crosshair'; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomDelta = e.deltaY > 0 ? 0.85 : 1.18; // scroll down = zoom out, up = zoom in
      zoomLevelRef.current = Math.max(0.3, Math.min(8, zoomLevelRef.current * zoomDelta));
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div className="panel flex flex-col h-full" style={{ minHeight: 0 }}>
      {title && (
        <div className="flex items-center justify-between px-3 py-1 border-b border-border-dark shrink-0">
          <span className="text-[0.65rem] text-gray-500 font-bold tracking-wider">{title}</span>
          <span className="text-[0.6rem] text-gray-600">CUMULATIVE VOLUME DELTA</span>
        </div>
      )}
      <div ref={containerRef} style={{ flex: '1 1 0%', minHeight: 0, position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: 'crosshair' }}
        />
      </div>
    </div>
  );
}

function niceStep(range: number, targetLines: number): number {
  const rough = range / targetLines;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let nice: number;
  if (norm <= 1.5) nice = 1;
  else if (norm <= 3) nice = 2;
  else if (norm <= 7) nice = 5;
  else nice = 10;
  return nice * mag;
}

function formatCvd(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? '+' : '-';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
