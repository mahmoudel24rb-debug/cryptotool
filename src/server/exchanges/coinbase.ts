import { BaseExchangeConnector } from './base';
import { ExchangeConfig, NormalizedTrade } from './types';

export class CoinbaseConnector extends BaseExchangeConnector {
  constructor(config: ExchangeConfig) {
    super('COINBASE', config);
  }

  connect() {
    if (this.config.spot) this.connectSpot();
    if (this.config.perp) {
      // BTC-PERP-INTX does not exist on the Exchange feed (it's Coinbase
      // International, a separate authenticated API) — subscribing made the
      // server reject and close the socket in an endless reconnect loop
      console.warn('[COINBASE] Perp feed not supported (INTX requires its own authenticated API) — skipping');
    }
  }

  private connectSpot() {
    const url = 'wss://ws-feed.exchange.coinbase.com';

    this.createWebSocket(url, 'spot', (ws) => {
      // 'matches' + 'heartbeat' only: level2 channels require authentication
      // since 2023 — subscribing to them killed the whole connection
      // (including trades). The heartbeat keeps the stale-feed watchdog fed.
      ws.send(JSON.stringify({
        type: 'subscribe',
        product_ids: ['BTC-USD'],
        channels: ['matches', 'heartbeat'],
      }));
    }, (data) => {
      if (data.type === 'error') {
        console.error(`[COINBASE] Subscribe error: ${data.message} ${data.reason || ''}`);
        return;
      }
      if (data.type === 'match' || data.type === 'last_match') {
        this.handleMatch(data, 'SPOT');
      }
    });
  }

  private handleMatch(data: any, market: string) {
    const price = parseFloat(data.price);
    const quantity = parseFloat(data.size);
    const trade: NormalizedTrade = {
      exchange: 'COINBASE',
      market,
      symbol: data.product_id || 'BTC-USD',
      price,
      quantity,
      side: data.side === 'sell' ? 'SELL' : 'BUY', // Coinbase side = maker side; taker is opposite
      timestamp: new Date(data.time).getTime(),
      usdValue: price * quantity,
    };
    this.emitTrade(trade);
  }

}
