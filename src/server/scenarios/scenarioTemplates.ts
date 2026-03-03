import { ConfluenceSignal, ScenarioDirection, SignalContribution } from './types';

export interface ScenarioTemplate {
  id: number;
  name: string;
  description: string;
  requiredSignals: string[];    // must have ALL of these signal types
  bonusSignals: string[];       // additional confluence if present
  minRequiredCount: number;     // minimum required signals matched
}

const TEMPLATES: ScenarioTemplate[] = [
  {
    id: 1,
    name: 'OB Retest après CHoCH',
    description: 'CHoCH + Order Block retest — setup classique et fiable',
    requiredSignals: ['CHoCH', 'ORDER_BLOCK'],
    bonusSignals: ['FVG', 'ABSORPTION', 'VWAP'],
    minRequiredCount: 2,
  },
  {
    id: 2,
    name: 'Liquidity Sweep + Reversal',
    description: 'Stop hunt institutionnel — sweep puis reversal confirmé',
    requiredSignals: ['LIQUIDITY_SWEEP'],
    bonusSignals: ['ORDER_BLOCK', 'ABSORPTION', 'LIQUIDATION'],
    minRequiredCount: 1,
  },
  {
    id: 3,
    name: 'FVG Fill + Continuation',
    description: 'Pullback dans un FVG après BOS — continuation de tendance',
    requiredSignals: ['BOS', 'FVG'],
    bonusSignals: ['ORDER_BLOCK', 'VWAP'],
    minRequiredCount: 2,
  },
  {
    id: 4,
    name: 'Cascade de Liquidation',
    description: 'Contre-tendance après cascade de liquidations massives',
    requiredSignals: ['LIQUIDATION', 'FUNDING_EXTREME'],
    bonusSignals: ['ABSORPTION', 'ORDER_BLOCK', 'OI_SURGE'],
    minRequiredCount: 2,
  },
  {
    id: 5,
    name: 'Short Squeeze Setup',
    description: 'Funding négatif + OI montante + BOS bullish — shorts piégés',
    requiredSignals: ['FUNDING_EXTREME', 'STRUCTURE'],
    bonusSignals: ['VELOCITY', 'SPIKE', 'FVG', 'ORDER_BLOCK'],
    minRequiredCount: 2,
  },
  {
    id: 6,
    name: 'Long Squeeze Setup',
    description: 'Funding élevé + OI montante + BOS bearish — longs piégés',
    requiredSignals: ['FUNDING_EXTREME', 'STRUCTURE'],
    bonusSignals: ['VELOCITY', 'SPIKE', 'FVG', 'ORDER_BLOCK'],
    minRequiredCount: 2,
  },
  {
    id: 7,
    name: 'VWAP Mean Reversion',
    description: 'Retour à la moyenne après extension au-delà de VWAP ±2σ',
    requiredSignals: ['VWAP_POSITION', 'EXHAUSTION'],
    bonusSignals: ['ORDER_BLOCK', 'FVG', 'ABSORPTION'],
    minRequiredCount: 2,
  },
  {
    id: 8,
    name: 'POC Rejection',
    description: 'Rejet au Point of Control du volume profile',
    requiredSignals: ['VOLUME_PROFILE', 'ABSORPTION'],
    bonusSignals: ['STRUCTURE', 'VWAP'],
    minRequiredCount: 2,
  },
  {
    id: 9,
    name: 'TWAP Accumulation Breakout',
    description: 'Breakout après accumulation TWAP algorithmique',
    requiredSignals: ['TWAP', 'FVG'],
    bonusSignals: ['OI_SURGE', 'STRUCTURE', 'SPIKE'],
    minRequiredCount: 2,
  },
  {
    id: 10,
    name: 'Multi-Exchange Divergence',
    description: 'Divergence prix/CVD entre exchanges — confirmée par absorption ou structure',
    requiredSignals: ['DIVERGENCE', 'ABSORPTION', 'STRUCTURE'],
    bonusSignals: ['BASIS_EXTREME', 'SPIKE', 'VELOCITY'],
    minRequiredCount: 2,
  },
];

// Normalize signal type for matching (handle aliases)
function normalizeType(type: string): string {
  const aliases: Record<string, string> = {
    'SWEEP': 'LIQUIDITY_SWEEP',
    'OB_RETEST': 'ORDER_BLOCK',
    'OB': 'ORDER_BLOCK',
    'FVG_FILL': 'FVG',
    'FUNDING': 'FUNDING_EXTREME',
    'OI': 'OI_SURGE',
    'OI_FLUSH': 'OI_SURGE',
    'OI_DIVERGENCE': 'OI_SURGE',
    'BASIS': 'BASIS_EXTREME',
    'POC': 'VOLUME_PROFILE',
    'BOS': 'STRUCTURE',
    'CHoCH': 'CHoCH', // keep as-is, it's special
  };
  return aliases[type] || type;
}

/**
 * Match a set of signals against all templates.
 * Returns the best matching template or null.
 */
export function matchTemplate(
  signals: ConfluenceSignal[],
  direction: ScenarioDirection,
  contributions: SignalContribution[],
): ScenarioTemplate | null {
  const signalTypes = new Set(signals.map(s => normalizeType(s.type)));
  // Also add raw types
  for (const s of signals) signalTypes.add(s.type);

  let bestTemplate: ScenarioTemplate | null = null;
  let bestScore = 0;

  for (const template of TEMPLATES) {
    // Check direction constraints for squeeze scenarios
    if (template.id === 5 && direction !== 'LONG') continue;   // Short squeeze = LONG
    if (template.id === 6 && direction !== 'SHORT') continue;  // Long squeeze = SHORT

    // Phase 1.3: Verify funding sign for squeeze templates
    if (template.id === 5 || template.id === 6) {
      const fundingSignal = signals.find(s =>
        s.type === 'FUNDING_EXTREME' || s.type === 'FUNDING'
      );
      if (fundingSignal) {
        // Short Squeeze (5, LONG): funding must be negative → shorts pay longs → direction LONG
        // Long Squeeze (6, SHORT): funding must be positive → longs pay shorts → direction SHORT
        if (template.id === 5 && fundingSignal.direction !== 'LONG') continue;
        if (template.id === 6 && fundingSignal.direction !== 'SHORT') continue;
      }
    }

    // Count required signal matches
    const requiredMatched = template.requiredSignals.filter(req =>
      signalTypes.has(req) || signalTypes.has(normalizeType(req))
    );

    if (requiredMatched.length < template.minRequiredCount) continue;

    // Count bonus signal matches
    const bonusMatched = template.bonusSignals.filter(b =>
      signalTypes.has(b) || signalTypes.has(normalizeType(b))
    );

    // Score = required matches * 10 + bonus * 5
    const score = requiredMatched.length * 10 + bonusMatched.length * 5;

    if (score > bestScore) {
      bestScore = score;
      bestTemplate = template;
    }
  }

  return bestTemplate;
}

export function getTemplates(): ScenarioTemplate[] {
  return TEMPLATES;
}
