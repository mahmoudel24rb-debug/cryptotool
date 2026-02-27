import React, { useEffect, useRef } from 'react';

interface ProfileBin {
  price: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
}

interface VolumeProfileData {
  bins: ProfileBin[];
  poc: number;
  vah: number;
  val: number;
  highPrice: number;
  lowPrice: number;
  totalVolume: number;
}

interface VolumeProfilePanelProps {
  data: VolumeProfileData | null;
}

const BG_COLOR = '#131722';
const FONT = '"JetBrains Mono", monospace';
const TEXT_COLOR = '#787b86';
const BUY_COLOR = 'rgba(38, 166, 154, 0.6)';
const SELL_COLOR = 'rgba(239, 83, 80, 0.6)';
const POC_COLOR = 'rgba(251, 191, 36, 0.8)';
const VA_COLOR = 'rgba(96, 165, 250, 0.15)';
const PADDING = { top: 24, bottom: 8, left: 4, right: 48 };

export default function VolumeProfilePanel({ data }: VolumeProfilePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  const rafRef = useRef(0);

  dataRef.current = data;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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

      const vpData = dataRef.current;
      if (!vpData || vpData.bins.length === 0) {
        ctx.fillStyle = TEXT_COLOR;
        ctx.font = `10px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('No volume data', w / 2, h / 2);
        return;
      }

      const chartW = w - PADDING.left - PADDING.right;
      const chartH = h - PADDING.top - PADDING.bottom;
      if (chartW <= 0 || chartH <= 0) return;

      const bins = vpData.bins;
      const maxBinVol = Math.max(...bins.map(b => b.volume));
      if (maxBinVol <= 0) return;

      const binHeight = chartH / bins.length;

      // Draw value area background
      for (let i = 0; i < bins.length; i++) {
        const price = bins[i].price;
        if (price >= vpData.val && price <= vpData.vah) {
          const y = PADDING.top + chartH - (i + 1) * binHeight;
          ctx.fillStyle = VA_COLOR;
          ctx.fillRect(PADDING.left, y, chartW, binHeight);
        }
      }

      // Draw volume bars (horizontal)
      for (let i = 0; i < bins.length; i++) {
        const bin = bins[i];
        const y = PADDING.top + chartH - (i + 1) * binHeight;
        const totalW = (bin.volume / maxBinVol) * chartW;
        const buyW = bin.buyVolume > 0 ? (bin.buyVolume / bin.volume) * totalW : 0;
        const sellW = totalW - buyW;

        // Buy volume (left part, green)
        if (buyW > 0) {
          ctx.fillStyle = BUY_COLOR;
          ctx.fillRect(PADDING.left, y + 1, buyW, binHeight - 1);
        }
        // Sell volume (right part, red)
        if (sellW > 0) {
          ctx.fillStyle = SELL_COLOR;
          ctx.fillRect(PADDING.left + buyW, y + 1, sellW, binHeight - 1);
        }

        // POC highlight
        if (Math.abs(bin.price - vpData.poc) < (vpData.highPrice - vpData.lowPrice) / bins.length) {
          ctx.strokeStyle = POC_COLOR;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(PADDING.left, Math.round(y + binHeight / 2) + 0.5);
          ctx.lineTo(PADDING.left + chartW, Math.round(y + binHeight / 2) + 0.5);
          ctx.stroke();
        }
      }

      // Price labels on right side
      ctx.font = `8px ${FONT}`;
      ctx.textAlign = 'left';

      // POC label
      const pocIdx = bins.findIndex(b => Math.abs(b.price - vpData.poc) < (vpData.highPrice - vpData.lowPrice) / bins.length);
      if (pocIdx >= 0) {
        const pocY = PADDING.top + chartH - (pocIdx + 0.5) * binHeight;
        ctx.fillStyle = POC_COLOR;
        ctx.fillText(`POC ${formatPrice(vpData.poc)}`, PADDING.left + chartW + 3, pocY + 3);
      }

      // VAH label
      const vahIdx = bins.findIndex(b => Math.abs(b.price - vpData.vah) < (vpData.highPrice - vpData.lowPrice) / bins.length * 2);
      if (vahIdx >= 0) {
        const vahY = PADDING.top + chartH - (vahIdx + 0.5) * binHeight;
        ctx.fillStyle = 'rgba(96, 165, 250, 0.6)';
        ctx.fillText(`VAH ${formatPrice(vpData.vah)}`, PADDING.left + chartW + 3, vahY + 3);
      }

      // VAL label
      const valIdx = bins.findIndex(b => Math.abs(b.price - vpData.val) < (vpData.highPrice - vpData.lowPrice) / bins.length * 2);
      if (valIdx >= 0) {
        const valY = PADDING.top + chartH - (valIdx + 0.5) * binHeight;
        ctx.fillStyle = 'rgba(96, 165, 250, 0.6)';
        ctx.fillText(`VAL ${formatPrice(vpData.val)}`, PADDING.left + chartW + 3, valY + 3);
      }

      // Title
      ctx.font = `bold 9px ${FONT}`;
      ctx.fillStyle = TEXT_COLOR;
      ctx.textAlign = 'left';
      ctx.fillText('VOLUME PROFILE', PADDING.left + 4, 14);

      // Vol total
      ctx.font = `8px ${FONT}`;
      ctx.fillStyle = '#4b5563';
      const volStr = vpData.totalVolume >= 1e9
        ? `$${(vpData.totalVolume / 1e9).toFixed(1)}B`
        : vpData.totalVolume >= 1e6
        ? `$${(vpData.totalVolume / 1e6).toFixed(0)}M`
        : `$${(vpData.totalVolume / 1e3).toFixed(0)}K`;
      ctx.fillText(volStr, PADDING.left + chartW - 30, 14);
    };

    const tick = () => {
      draw();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full" style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      />
    </div>
  );
}

function formatPrice(price: number): string {
  if (price >= 10000) {
    const str = Math.round(price).toString();
    return str.slice(0, -3) + ' ' + str.slice(-3);
  }
  return price.toFixed(0);
}
