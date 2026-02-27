import { Candle } from '../candles/candleBuilder';
import { LiquidityPool, LiquiditySweep, LiquidityConfig, SwingPoint } from './types';

const MAX_POOLS = 40;
const MAX_SWEEPS = 30;

/**
 * Liquidity detector.
 * Identifies liquidity pools (equal highs/lows) and detects sweeps.
 * Equal levels = clusters of swing highs or lows at similar prices → stop liquidity.
 */
export class LiquidityDetector {
  private config: LiquidityConfig;
  private pools: LiquidityPool[] = [];
  private sweeps: LiquiditySweep[] = [];
  private timeframe: string;

  constructor(config: LiquidityConfig, timeframe: string) {
    this.config = config;
    this.timeframe = timeframe;
  }

  /**
   * Build/update liquidity pools from swing points.
   * Groups nearby swing highs into buyside pools and swing lows into sellside pools.
   */
  updatePools(swingHighs: SwingPoint[], swingLows: SwingPoint[]): void {
    // Build buyside liquidity (equal highs = stop losses above)
    this.pools = this.pools.filter(p => !p.swept); // keep only active
    this.buildPoolsFromSwings(swingHighs, 'BUYSIDE');
    this.buildPoolsFromSwings(swingLows, 'SELLSIDE');
    this.prunePools();
  }

  private buildPoolsFromSwings(swings: SwingPoint[], type: 'BUYSIDE' | 'SELLSIDE'): void {
    if (swings.length < 2) return;
    const threshold = this.config.equalLevelThreshold / 100;

    // Group swings by similar price levels
    const used = new Set<number>();

    for (let i = 0; i < swings.length; i++) {
      if (used.has(i)) continue;
      const group: SwingPoint[] = [swings[i]];
      used.add(i);

      for (let j = i + 1; j < swings.length; j++) {
        if (used.has(j)) continue;
        const priceDiff = Math.abs(swings[j].price - swings[i].price) / swings[i].price;
        if (priceDiff <= threshold) {
          group.push(swings[j]);
          used.add(j);
        }
      }

      if (group.length >= this.config.minTouches) {
        const avgPrice = group.reduce((s, p) => s + p.price, 0) / group.length;
        const existingPool = this.pools.find(
          p => p.type === type && !p.swept &&
          Math.abs(p.level - avgPrice) / avgPrice <= threshold
        );

        if (existingPool) {
          // Update existing pool
          existingPool.strength = group.length;
          existingPool.levels = group.map(g => g.price);
          existingPool.timestamps = group.map(g => g.timestamp);
          existingPool.level = avgPrice;
        } else {
          const pool: LiquidityPool = {
            id: `LIQ-${this.timeframe}-${type}-${Math.random().toString(36).slice(2, 6)}`,
            type,
            level: avgPrice,
            strength: group.length,
            levels: group.map(g => g.price),
            timestamps: group.map(g => g.timestamp),
            swept: false,
          };
          this.pools.push(pool);
        }
      }
    }
  }

  /**
   * Check for liquidity sweeps based on current price action.
   * A sweep occurs when price briefly pierces through a pool level and reverses.
   */
  checkSweeps(candles: Candle[]): LiquiditySweep | null {
    if (candles.length < this.config.sweepConfirmationCandles + 1) return null;

    const recent = candles.slice(-this.config.sweepConfirmationCandles - 1);
    const currentCandle = recent[recent.length - 1];

    for (const pool of this.pools) {
      if (pool.swept) continue;

      if (pool.type === 'BUYSIDE') {
        // Check if price wicked above the pool and came back down
        const pierced = recent.some(c => c.high > pool.level);
        const reversedBack = currentCandle.close < pool.level;

        if (pierced && reversedBack) {
          const maxWick = Math.max(...recent.map(c => c.high));
          const sweepDepth = maxWick - pool.level;

          pool.swept = true;
          pool.sweptAt = Math.floor(Date.now() / 1000);

          const sweep: LiquiditySweep = {
            id: `SWEEP-${this.timeframe}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'BUYSIDE_SWEEP',
            pool,
            sweepPrice: maxWick,
            sweepDepth,
            timestamp: currentCandle.time,
            reversalDetected: true,
          };
          this.sweeps.unshift(sweep);
          this.pruneSweeps();
          return sweep;
        }
      } else {
        // Check if price wicked below the pool and came back up
        const pierced = recent.some(c => c.low < pool.level);
        const reversedBack = currentCandle.close > pool.level;

        if (pierced && reversedBack) {
          const minWick = Math.min(...recent.map(c => c.low));
          const sweepDepth = pool.level - minWick;

          pool.swept = true;
          pool.sweptAt = Math.floor(Date.now() / 1000);

          const sweep: LiquiditySweep = {
            id: `SWEEP-${this.timeframe}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'SELLSIDE_SWEEP',
            pool,
            sweepPrice: minWick,
            sweepDepth,
            timestamp: currentCandle.time,
            reversalDetected: true,
          };
          this.sweeps.unshift(sweep);
          this.pruneSweeps();
          return sweep;
        }
      }
    }

    return null;
  }

  getActivePools(): LiquidityPool[] {
    return this.pools.filter(p => !p.swept);
  }

  getAllPools(): LiquidityPool[] {
    return this.pools;
  }

  getRecentSweeps(): LiquiditySweep[] {
    return this.sweeps.slice(0, 10);
  }

  private prunePools(): void {
    // Remove swept pools older than 10 min
    const cutoff = Math.floor(Date.now() / 1000) - 600;
    this.pools = this.pools.filter(p => !p.swept || (p.sweptAt && p.sweptAt > cutoff));
    if (this.pools.length > MAX_POOLS) {
      this.pools = this.pools.slice(0, MAX_POOLS);
    }
  }

  private pruneSweeps(): void {
    if (this.sweeps.length > MAX_SWEEPS) {
      this.sweeps = this.sweeps.slice(0, MAX_SWEEPS);
    }
  }
}
