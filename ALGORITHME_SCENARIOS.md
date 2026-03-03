# Algorithme de Generation de Scenarios de Trade

## Vue d'ensemble

Le systeme genere des scenarios de trade en combinant des **signaux** provenant de multiples sources (structure de marche, order flow, derivatives) dans un **moteur de confluence**. Quand suffisamment de signaux convergent dans la meme zone de prix et la meme direction, un scenario est emis.

```
Signaux (16 types) --> Regroupement par zone de prix --> Score de confluence
    --> Cluster bonus --> Trend multiplier --> Counter-trend blocking
    --> Seuil minimum (40) --> SL cooldown check
    --> Match template (10 modeles) --> Cross-template dedup
    --> Calcul TP/SL (ATR-based) --> Emission scenario
```

---

## 1. Les 16 Types de Signaux

Chaque signal a un **poids** qui determine son importance dans le score final, et un **strength** (0 a 1) qui module ce poids.

### Signaux Structure (poids eleves = plus fiables)

| Signal | Poids | TTL | Source | Description |
|--------|-------|-----|--------|-------------|
| **ORDER_BLOCK** | 20 | 15 min | Structure Analyzer | Zone ou les institutionnels ont accumule. Retest = entree probable |
| **LIQUIDITY_SWEEP** | 20 | 10 min | Structure Analyzer | Balayage de liquidite (stop hunt) suivi d'un retournement |
| **STRUCTURE (BOS/CHoCH)** | 15 | 10 min | Structure Analyzer | Break of Structure / Change of Character = changement de tendance |

### Signaux Order Flow (poids moyens)

| Signal | Poids | TTL | Source | Description |
|--------|-------|-----|--------|-------------|
| **ABSORPTION** | 10 | 5 min | Detector | Gros volume absorbe sans mouvement de prix = mur d'ordres |
| **FVG** | 10 | 15 min | Structure Analyzer | Fair Value Gap = desequilibre a combler |
| **DIVERGENCE** | 5 | 5 min | Detector | Prix monte mais delta descend (ou inverse) = faiblesse cachee |
| **LIQUIDATION** | 8 | 3 min | Detector | Cascade de liquidations forcees |

### Signaux Derivatives (poids moyens)

| Signal | Poids | TTL | Source | Description |
|--------|-------|-----|--------|-------------|
| **FUNDING_EXTREME** | 8 | 8 min | Funding Tracker | Funding rate anormalement eleve/bas = desequilibre |
| **OI (Surge/Flush/Divergence)** | 8 | 8 min | OI Tracker | Open Interest change significativement |
| **BASIS_EXTREME** | 5 | 5 min | Basis Tracker | Ecart futures/spot anormal (contango/backwardation) |

### Signaux Faibles (confirmation)

| Signal | Poids | TTL | Source | Description |
|--------|-------|-----|--------|-------------|
| **SPIKE** | 5 | 2 min | Detector | Pic de volume soudain |
| **VELOCITY** | 5 | 2 min | Detector | Acceleration rapide du prix |
| **TWAP** | 5 | 5 min | Detector | Detection d'execution algorithmique (Time-Weighted Average Price) |
| **EXHAUSTION** | 5 | 3 min | Detector | Volume qui s'epuise = fin de mouvement |
| **VWAP_POSITION** | 5 | 5 min | VWAP Calculator | Prix aux extremes des bandes VWAP (±2 sigma) |
| **VOLUME_PROFILE** | 5 | 5 min | Volume Profile | Proximite du Point of Control (POC) |

---

## 2. Regroupement par Zone de Prix

Les signaux ne sont utiles que s'ils pointent vers la **meme zone**. L'algorithme regroupe les signaux par proximite de prix :

1. Trie tous les signaux actifs par prix
2. Regroupe les signaux dont le prix est a **< 0.3%** les uns des autres
3. Ajoute une zone "near-price" : tous les signaux a **< 1%** du prix actuel
4. **Minimum 2 signaux** par zone pour etre evaluee

---

## 3. Calcul du Score de Confluence

Pour chaque zone, l'algorithme :

### 3.1 Determine la direction (LONG ou SHORT)

Chaque signal a une direction. Les poids pondent le vote :
- Signaux LONG : somme des poids = score haussier
- Signaux SHORT : somme des poids = score baissier
- La direction majoritaire l'emporte

### 3.2 Verifie l'ancrage (Anchor Check)

Au moins **1 signal de poids >= 15** doit etre present dans la direction choisie. Les signaux eligibles sont : STRUCTURE/BOS/CHoCH (15), ORDER_BLOCK (20), LIQUIDITY_SWEEP (20).

Si aucun signal structurel "fort" n'est present, la zone est ignoree. Cela force la presence d'un signal de structure de marche (OB, sweep, ou BOS/CHoCH).

### 3.3 Calcule le score avec decay, proximite et strength

Pour chaque signal **dans la direction** :

```
strength  = max(0.3, signal.strength ?? 1.0)     // floor a 30%
decay     = max(0, 1.0 - (age / ttl) * 0.7)      // perd de la valeur avec l'age
proximity = max(0, 1.0 - distance / 0.01)          // perd de la valeur si loin du prix actuel
tfMult    = TF_MULTIPLIERS[timeframe] ?? 1.0       // 1m=0.6, 5m=1.0, 15m=1.4, 1h=1.6

effectiveScore = round(poids * strength * decay * proximity * tfMult)
```

**Deduplication :** Un seul signal par TYPE dans le score (garde le meilleur effectiveScore).

Pour chaque signal **contra** (direction opposee) :

```
penalite = floor(poids * strength * penaltyRatio)

penaltyRatio :
  0.70 si poids >= 15  (ORDER_BLOCK, LIQUIDITY_SWEEP, STRUCTURE contra = gros red flag)
  0.50 si poids >= 8   (ABSORPTION, FVG, DIVERGENCE, etc.)
  0.30 si poids < 8    (SPIKE, VELOCITY, etc.)
```

`rawScore = max(0, somme_alignes - somme_contras)`

### 3.4 Bonus de clustering temporel

Si plusieurs signaux apparaissent dans une fenetre de **30 secondes** (convergence rapide) :
- 3+ paires de signaux proches temporellement → **+10 points**
- 1-2 paires → **+5 points**

`scoreWithCluster = rawScore + clusterBonus`

### 3.5 Multiplicateur de tendance

Le Trend Analyzer fournit un score de -100 a +100. Le scenario est compare a la tendance :

```
Si aligne (LONG + trend positif, ou SHORT + trend negatif) :
  trendMultiplier = 1.0 + (|trendScore| / 100) * 0.25     // max +25%

Si contre-tendance :
  trendMultiplier = 1.0 - (|trendScore| / 100) * 0.40     // max -40%

adjustedScore = round(scoreWithCluster * trendMultiplier)
```

**Blocage counter-trend :**
- Si `|trendScore| > 60` (tendance forte) : **blocage total** des scenarios counter-trend
- Si `|trendScore| > 30` (tendance moderee) ET `rawScore < 50` : **blocage** (pas assez de confluence brute)
- Si `|trendScore| < 30` (range/neutre) : comportement normal (penalite proportionnelle)

### 3.6 Cooldown apres Stop Loss

Apres un SL dans une direction, **5 minutes de cooldown** dans cette meme direction. Seuls les scenarios avec `adjustedScore >= 55` (HIGH) peuvent bypass le cooldown.

### 3.7 Seuils de priorite

| Priorite | Score minimum | Signification |
|----------|---------------|---------------|
| **LOW** | >= 40 | Confluence basique (3+ signaux) |
| **MEDIUM** | >= 50 | Confluence moderee |
| **HIGH** | >= 60 | Forte confluence (signaux majeurs) |
| **EXTREME** | >= 75 | Confluence exceptionnelle (rare) |

### 3.8 Exemple de calcul complet

**Situation :** BTC a $90,000, trend score = +45 (BULL)

| Signal | Type | Poids | Strength | Age | TTL | Decay | Dist | Prox | TF | Score |
|--------|------|-------|----------|-----|-----|-------|------|------|----|-------|
| CHoCH BULLISH | STRUCTURE | 15 | 0.8 | 2m | 10m | 0.86 | 0.06% | 0.94 | 15m (1.4) | **14** |
| OB BULLISH | ORDER_BLOCK | 20 | 0.7 | 4m | 15m | 0.81 | 0.11% | 0.89 | 5m (1.0) | **10** |
| FVG BULLISH | FVG | 10 | 0.6 | 1m | 15m | 0.95 | 0.06% | 0.94 | 1m (0.6) | **3** |
| SPIKE SELL (contra) | SPIKE | 5 | 0.5 | 30s | 2m | — | — | — | — | **-0** |

```
rawScore       = 14 + 10 + 3 - 0 = 27
clusterBonus   = +5 (1 paire dans 30s)
scoreWithCluster = 32
counterTrend?  = Non (LONG + trend positif)
trendMultiplier = 1.0 + (45/100) * 0.25 = 1.1125
adjustedScore  = round(32 * 1.1125) = 36
SL cooldown?   = Non
```

Resultat : score 36, **en dessous du seuil de 40** → scenario rejete.

---

## 4. Les 10 Templates de Scenarios

Chaque scenario doit correspondre a un **template** predefini. Le meilleur match gagne (score = requiredMatched * 10 + bonusMatched * 5).

| # | Nom | Requis | Bonus | Direction |
|---|-----|--------|-------|-----------|
| 1 | OB Retest apres CHoCH | CHoCH + ORDER_BLOCK | FVG, ABSORPTION, VWAP | — |
| 2 | Liquidity Sweep + Reversal | LIQUIDITY_SWEEP | ORDER_BLOCK, ABSORPTION, LIQUIDATION | — |
| 3 | FVG Fill + Continuation | BOS + FVG | ORDER_BLOCK, VWAP | — |
| 4 | Cascade de Liquidation | LIQUIDATION + FUNDING_EXTREME | ABSORPTION, ORDER_BLOCK, OI_SURGE | — |
| 5 | Short Squeeze Setup | FUNDING_EXTREME + STRUCTURE | VELOCITY, SPIKE, FVG, ORDER_BLOCK | LONG |
| 6 | Long Squeeze Setup | FUNDING_EXTREME + STRUCTURE | VELOCITY, SPIKE, FVG, ORDER_BLOCK | SHORT |
| 7 | VWAP Mean Reversion | VWAP_POSITION + EXHAUSTION | ORDER_BLOCK, FVG, ABSORPTION | — |
| 8 | POC Rejection | VOLUME_PROFILE + ABSORPTION | STRUCTURE, VWAP | — |
| 9 | TWAP Accumulation Breakout | TWAP + FVG | OI_SURGE, STRUCTURE, SPIKE | — |
| 10 | Multi-Exchange Divergence | DIVERGENCE + (ABSORPTION ou STRUCTURE) | BASIS_EXTREME, SPIKE, VELOCITY | — |

**Validation squeeze :**
- Template 5 (Short Squeeze, LONG) : le funding doit etre negatif (`direction === 'LONG'` = shorts paient)
- Template 6 (Long Squeeze, SHORT) : le funding doit etre positif (`direction === 'SHORT'` = longs paient)

---

## 5. Calcul des TP / SL

### Zone d'entree
```
entryBuffer = prix * 0.15%    (~$135 pour BTC a $90K)

LONG :  entryLow  = min(prix_signaux) - entryBuffer
        entryHigh = max(prix_signaux) + entryBuffer
SHORT : idem
```

### Stop Loss (ATR-based)
```
Mode ATR (defaut) :
  slBuffer = max(prix * 0.1%, ATR(14) * 1.0)
  → S'adapte a la volatilite : plus serre en range, plus large en tendance

Mode fixe (fallback si ATR pas dispo) :
  slBuffer = prix * 0.2%

LONG :  SL = entryLow - slBuffer
SHORT : SL = entryHigh + slBuffer
```

### Take Profit (multiples du risque)
```
risk = entryHigh - stopLoss   (LONG)
     = stopLoss - entryLow    (SHORT)

LONG :
  TP1 = entryHigh + risk * 1.0   (premier objectif, conservateur)
  TP2 = entryHigh + risk * 2.0   (objectif principal)
  TP3 = entryHigh + risk * 3.5   (objectif ambitieux)

SHORT :
  TP1 = entryLow - risk * 1.0
  TP2 = entryLow - risk * 2.0
  TP3 = entryLow - risk * 3.5
```

### Risk/Reward minimum
- R:R calcule de l'entree (milieu zone) jusqu'a TP2
- **Minimum 1.5:1** sinon le scenario est rejete

### Invalidation
- Un buffer supplementaire sous le SL (LONG) ou au-dessus (SHORT)
- Si le prix depasse ce niveau, le scenario est automatiquement invalide

---

## 6. Cycle de Vie d'un Scenario

```
PENDING ──> ACTIVE ──> TP1_HIT ──> TP2_HIT ──> TP3_HIT
   │           │          │           │
   │           │          │           └── INVALIDATED (SL)
   │           │          └── INVALIDATED (SL au breakeven)
   │           └── INVALIDATED (SL)
   │
   ├── EXPIRED (30 min, seulement si adjustedScore < 40)
   └── INVALIDATED (prix au-dela de l'invalidation)
```

### Etats

- **PENDING** : Scenario cree, en attente que le prix entre dans la zone
- **ACTIVE** : Prix dans la zone d'entree, le trade est "en cours"
- **TP1_HIT** : TP1 atteint, tracking continue vers TP2
- **TP2_HIT** : TP2 atteint, tracking continue vers TP3
- **TP3_HIT** : TP3 atteint, scenario completement reussi
- **INVALIDATED** : SL touche ou prix trop loin
- **EXPIRED** : 30 minutes ecoulees sans activation

### Trailing Stop Loss

Apres chaque TP atteint, le SL est remonte pour proteger les gains :
- Apres TP1 → SL deplace au **breakeven** (milieu de la zone d'entree)
- Apres TP2 → SL deplace au **TP1**

### Non-expiration haute priorite

Les scenarios avec `adjustedScore >= 40` ne sont **jamais expires** automatiquement. Ils restent actifs jusqu'a TP ou SL.

### MFE / MAE Tracking

Pour chaque scenario actif, le systeme traque en continu :
- **MFE** (Max Favorable Excursion) : meilleur prix atteint dans la bonne direction
- **MAE** (Max Adverse Excursion) : pire prix atteint dans la mauvaise direction

Permet d'analyser apres coup si les SL sont trop serres ou les TP trop ambitieux.

### Limites

- Maximum **3 scenarios actifs** simultanement
- Si un 4e est cree avec un meilleur score, il remplace le plus faible
- Les scenarios termines (INVALIDATED/EXPIRED/TP3_HIT) sont nettoyes apres 60 secondes
- **Deduplication double :**
  1. Meme template + direction + statut actif + < 2 min = skip
  2. Cross-template : si 50%+ d'overlap de zone d'entree avec un scenario existant dans la meme direction → skip (ou remplacement si meilleur score)

---

## 7. Le Trend Analyzer

Score composite de **-100 a +100** base sur 6 facteurs :

| Facteur | Poids | Ce qu'il mesure |
|---------|-------|-----------------|
| Price Momentum | 25% | EMA(8) vs EMA(21) sur samples de prix 1s |
| CVD Trend | 25% | Pression achat/vente cumulative (recent vs ancien) |
| Order Book | 15% | Ratio bids vs asks (smoothing EMA 0.1) |
| Signal Bias | 15% | Ratio signaux bull vs bear (30 dernieres alertes) |
| Volume Momentum | 10% | Acceleration volume * direction prix |
| Liquidation Pressure | 10% | Liquidations shorts vs longs (5 min, seuil $10K) |

**Resultat :** `BULL` (score > 15), `BEAR` (score < -15), `NEUTRAL` (entre -15 et +15)

Le trend est integre dans le scoring des scenarios via le **multiplicateur de tendance** (section 3.5).

---

## 8. Persistence et Logging

### Scenarios actifs
- Sauvegardes toutes les 30 secondes dans `./data/active_scenarios.json`
- Restaures au redemarrage du serveur (les scenarios PENDING/ACTIVE reprennent)

### Historique des outcomes
- Chaque scenario termine est logge dans `./data/scenario_outcomes.jsonl` (append-only)
- Champs : id, template, direction, scores, prix, statut final, duree, MFE, MAE
- Accessible dans l'UI via le Trade Journal (onglet Tools)
- Endpoint REST : `GET /api/trade-history`

---

## 9. Mapping Directionnel (alertes → signaux confluence)

| Type alerte | Direction LONG | Direction SHORT |
|-------------|---------------|----------------|
| ABSORPTION | dominantSide = SELL (absorption des ventes) | dominantSide = BUY |
| SPIKE | message contient 'Buy' | message contient 'Sell' |
| VELOCITY | message contient 'Buy' | message contient 'Sell' |
| EXHAUSTION | message 'Bullish' (prix baisse, vendeurs epuises) | message 'Bearish' (prix monte, acheteurs epuises) |
| DIVERGENCE | message 'Bullish' | message 'Bearish' |
| TWAP | message 'buying' | message 'selling' |
| LIQUIDATION | liquidations SHORT (short squeeze) | liquidations LONG |
| FUNDING_EXTREME | rate < 0 (shorts paient) | rate > 0 (longs paient) |
| BASIS_EXTREME | basis < 0 | basis > 0 |
| OI | OI+/prix+ ou OI-/prix+ | OI+/prix- ou OI-/prix- |
| BOS/CHoCH | direction BULLISH | direction BEARISH |
| ORDER_BLOCK | type BULLISH | type BEARISH |
| FVG | type BULLISH | type BEARISH |
| LIQUIDITY_SWEEP | SELLSIDE sweep | BUYSIDE sweep |
| VWAP_POSITION | prix <= lowerBand2 | prix >= upperBand2 |
| VOLUME_PROFILE | prix < POC | prix > POC |

---

## 10. Constantes Configurables (SCENARIO_CONFIG)

```
// Trend & scoring
TREND_ALIGNED_MAX_BOOST    = 0.25    // +25% max si trend aligne
TREND_COUNTER_MAX_PENALTY  = 0.40    // -40% max si contre-tendance
TREND_HARD_BLOCK_THRESHOLD = 60      // |trendScore| au-dessus = blocage total counter-trend
TREND_SOFT_BLOCK_THRESHOLD = 30      // |trendScore| au-dessus = rawScore minimum requis
COUNTER_TREND_MIN_RAW_SCORE= 50      // rawScore minimum pour counter-trend en tendance moderee
MIN_STRENGTH_FLOOR         = 0.3     // signal ne peut valoir < 30% de son poids
CONTRA_PENALTY_HIGH        = 0.70    // penalite contra pour poids >= 15
CONTRA_PENALTY_MEDIUM      = 0.50    // penalite contra pour poids >= 8
CONTRA_PENALTY_LOW         = 0.30    // penalite contra pour poids < 8
DECAY_RATE                 = 0.7     // vitesse de decay temporel
TF_MULTIPLIERS             = { 1m: 0.6, 5m: 1.0, 15m: 1.4, 1h: 1.6 }
PROXIMITY_MAX_DISTANCE     = 0.01    // 1% max de distance
CLUSTER_WINDOW_MS          = 30000   // 30 secondes pour le clustering
CLUSTER_BONUS_HIGH         = 10      // 3+ paires
CLUSTER_BONUS_LOW          = 5       // 1-2 paires
MINIMUM_ANCHOR_WEIGHT      = 15      // poids min pour un signal "fort" (OB, SWEEP, STRUCTURE)
TRAILING_SL_ENABLED        = true

// Entry & TP/SL
minScoreForScenario        = 40      // seuil minimum (ancien: 30)
maxActiveScenarios         = 3       // slots simultanees (ancien: 5)
minRiskReward              = 1.5     // R:R minimum sur TP2
ENTRY_BUFFER_PCT           = 0.15%   // zone d'entree (ancien: 0.3%)
SL_MODE                    = 'ATR'   // mode SL adaptatif
ATR_SL_MULTIPLIER          = 1.0     // 1x ATR comme buffer SL
MIN_SL_BUFFER_PCT          = 0.1%    // plancher SL
TP1_MULTIPLIER             = 1.0     // (ancien: 1.5)
TP2_MULTIPLIER             = 2.0     // (ancien: 2.5)
TP3_MULTIPLIER             = 3.5     // (ancien: 4.0)
scenarioExpirationMs       = 30 min

// Dedup & cooldown
DEDUP_OVERLAP_THRESHOLD    = 0.5     // 50% overlap = meme trade
SL_COOLDOWN_MS             = 300000  // 5 min cooldown apres SL
SL_COOLDOWN_OVERRIDE_SCORE = 55      // score HIGH bypass le cooldown
```
