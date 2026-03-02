# Algorithme de Generation de Scenarios de Trade

## Vue d'ensemble

Le systeme genere des scenarios de trade en combinant des **signaux** provenant de multiples sources (structure de marche, order flow, derivatives) dans un **moteur de confluence**. Quand suffisamment de signaux convergent dans la meme zone de prix et la meme direction, un scenario est emis.

```
Signaux (16 types) --> Regroupement par zone de prix --> Score de confluence
    --> Match template (10 modeles) --> Calcul TP/SL --> Emission scenario
```

---

## 1. Les 16 Types de Signaux

Chaque signal a un **poids** qui determine son importance dans le score final.

### Signaux Structure (poids eleves = plus fiables)

| Signal | Poids | Source | Description |
|--------|-------|--------|-------------|
| **ORDER_BLOCK** | 20 | Structure Analyzer | Zone ou les institutionnels ont accumule. Retest = entree probable |
| **LIQUIDITY_SWEEP** | 20 | Structure Analyzer | Balayage de liquidite (stop hunt) suivi d'un retournement |
| **STRUCTURE (BOS/CHoCH)** | 15 | Structure Analyzer | Break of Structure / Change of Character = changement de tendance |

### Signaux Order Flow (poids moyens)

| Signal | Poids | Source | Description |
|--------|-------|--------|-------------|
| **ABSORPTION** | 10 | Detector | Gros volume absorbe sans mouvement de prix = mur d'ordres |
| **FVG** | 10 | Structure Analyzer | Fair Value Gap = desequilibre a combler |
| **DIVERGENCE** | 8 | Detector | Prix monte mais delta descend (ou inverse) = faiblesse cachee |
| **LIQUIDATION** | 8 | Detector | Cascade de liquidations forcees |

### Signaux Derivatives (poids moyens)

| Signal | Poids | Source | Description |
|--------|-------|--------|-------------|
| **FUNDING_EXTREME** | 8 | Funding Tracker | Funding rate anormalement eleve/bas = desequilibre |
| **OI (Surge/Flush/Divergence)** | 8 | OI Tracker | Open Interest change significativement |
| **BASIS_EXTREME** | 5 | Basis Tracker | Ecart futures/spot anormal (contango/backwardation) |

### Signaux Faibles (confirmation)

| Signal | Poids | Source | Description |
|--------|-------|--------|-------------|
| **SPIKE** | 5 | Detector | Pic de volume soudain |
| **VELOCITY** | 5 | Detector | Acceleration rapide du prix |
| **TWAP** | 5 | Detector | Detection d'execution algorithmique (Time-Weighted Average Price) |
| **EXHAUSTION** | 5 | Detector | Volume qui s'epuise = fin de mouvement |
| **VWAP_POSITION** | 5 | VWAP Calculator | Prix par rapport aux bandes VWAP |
| **VOLUME_PROFILE** | 5 | Volume Profile | Proximite du Point of Control (POC) |

---

## 2. Regroupement par Zone de Prix

Les signaux ne sont utiles que s'ils pointent vers la **meme zone**. L'algorithme regroupe les signaux par proximite de prix :

1. Trie tous les signaux actifs par prix
2. Regroupe les signaux dont le prix est a **< 0.3%** les uns des autres
3. Ajoute une zone "near-price" : tous les signaux a **< 1%** du prix actuel
4. **Minimum 2 signaux** par zone pour etre evaluee

**Exemple :**
- Signal ORDER_BLOCK a $86,500
- Signal ABSORPTION a $86,700 (0.23% d'ecart -> meme zone)
- Signal SPIKE a $87,500 (1.15% d'ecart -> nouvelle zone)

---

## 3. Calcul du Score de Confluence

Pour chaque zone, l'algorithme :

### 3.1 Determine la direction (LONG ou SHORT)

Chaque signal a une direction. Les poids pondent le vote :
- Signaux LONG : somme des poids = score haussier
- Signaux SHORT : somme des poids = score baissier
- La direction majoritaire l'emporte

**Exemple :** ORDER_BLOCK(LONG, 20) + FVG(LONG, 10) + SPIKE(SHORT, 5) = LONG (30 vs 5)

### 3.2 Calcule le score

```
Pour chaque signal dans la zone :
  - Si meme direction que la zone :
      - Ajoute le poids au score (une seule fois par TYPE de signal)
  - Si direction opposee :
      - Soustrait 30% du poids (penalite contra)
```

**Deduplication importante :** Deux signaux ORDER_BLOCK dans la meme zone ne comptent que pour **20 points** (pas 40). Chaque categorie ne compte qu'une fois.

**Exemple de calcul :**
```
Zone LONG :
  + CHoCH (LONG)       = +15
  + ORDER_BLOCK (LONG)  = +20
  + FVG (LONG)          = +10
  + ABSORPTION (LONG)   = +10
  - SPIKE (SHORT)       = -floor(5 * 0.3) = -1
                        ────────
  Score = 54 / maxScore = 60
```

### 3.3 Seuils de priorite

| Priorite | Score minimum | Signification |
|----------|---------------|---------------|
| **LOW** | >= 30 | Confluence basique (2-3 signaux) |
| **MEDIUM** | >= 40 | Confluence moderee |
| **HIGH** | >= 55 | Forte confluence (3-4 signaux majeurs) |
| **EXTREME** | >= 75 | Confluence exceptionnelle (rare) |

---

## 4. Les 10 Templates de Scenarios

Chaque scenario doit correspondre a un **template** predefined. Le template determine le contexte du trade.

### Template 1 : OB Retest apres CHoCH
- **Requis :** CHoCH + ORDER_BLOCK (les 2 obligatoires)
- **Bonus :** FVG, ABSORPTION, VWAP
- **Logique :** Le marche a change de structure (CHoCH), puis revient tester un order block = entree classique smart money

### Template 2 : Liquidity Sweep + Reversal
- **Requis :** LIQUIDITY_SWEEP (1 seul suffit)
- **Bonus :** ORDER_BLOCK, ABSORPTION, LIQUIDATION
- **Logique :** Le prix balaye les stops (sweep), puis les institutionnels entrent en sens inverse

### Template 3 : FVG Fill + Continuation
- **Requis :** BOS + FVG (les 2 obligatoires)
- **Bonus :** ORDER_BLOCK, VWAP
- **Logique :** Break of Structure confirme la tendance, le prix revient combler un FVG avant de continuer

### Template 4 : Cascade de Liquidation
- **Requis :** LIQUIDATION + FUNDING_EXTREME (les 2 obligatoires)
- **Bonus :** ABSORPTION, ORDER_BLOCK, OI_SURGE
- **Logique :** Funding extreme + liquidations en cours = mouvement force en cascade

### Template 5 : Short Squeeze Setup (LONG uniquement)
- **Requis :** FUNDING_EXTREME + STRUCTURE
- **Bonus :** VELOCITY, SPIKE, FVG, ORDER_BLOCK
- **Logique :** Funding tres negatif + structure haussiere = les shorts vont se faire liquider

### Template 6 : Long Squeeze Setup (SHORT uniquement)
- **Requis :** FUNDING_EXTREME + STRUCTURE
- **Bonus :** VELOCITY, SPIKE, FVG, ORDER_BLOCK
- **Logique :** Funding tres positif + structure baissiere = les longs vont se faire liquider

### Template 7 : VWAP Mean Reversion
- **Requis :** VWAP_POSITION + EXHAUSTION
- **Bonus :** ORDER_BLOCK, FVG, ABSORPTION
- **Logique :** Prix aux extremes du VWAP + volume en exhaustion = retour vers la moyenne

### Template 8 : POC Rejection
- **Requis :** VOLUME_PROFILE + ABSORPTION
- **Bonus :** STRUCTURE, VWAP
- **Logique :** Le prix touche le Point of Control et est rejete (absorption visible)

### Template 9 : TWAP Accumulation Breakout
- **Requis :** TWAP + FVG
- **Bonus :** OI_SURGE, STRUCTURE, SPIKE
- **Logique :** Detection d'accumulation algo (TWAP) + FVG = breakout programme

### Template 10 : Multi-Exchange Divergence
- **Requis :** DIVERGENCE (1 seul suffit)
- **Bonus :** BASIS_EXTREME, SPIKE, VELOCITY
- **Logique :** Divergence delta/prix entre exchanges = mouvement cache imminent

---

## 5. Calcul des TP / SL

### Stop Loss
```
Buffer = prix * 0.1% (environ $87 pour BTC a $87K)

LONG :  SL = bord bas de la zone d'entree - buffer
SHORT : SL = bord haut de la zone d'entree + buffer
```

### Take Profit (multiples du risque)
```
Risque = distance entree -> SL

LONG :
  TP1 = entree + risque * 1.5   (premier objectif, conservative)
  TP2 = entree + risque * 2.5   (objectif principal)
  TP3 = entree + risque * 4.0   (objectif ambitieux)

SHORT :
  TP1 = entree - risque * 1.5
  TP2 = entree - risque * 2.5
  TP3 = entree - risque * 4.0
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
   PENDING ──────> ACTIVE ──────> TRIGGERED (TP1 atteint)
     │                │
     │                └──> INVALIDATED (SL touche)
     │
     └──> EXPIRED (30 min ecoulees)
     └──> INVALIDATED (prix au-dela de l'invalidation)
```

- **PENDING** : Scenario cree, en attente que le prix entre dans la zone
- **ACTIVE** : Prix dans la zone d'entree, le trade est "en cours"
- **TRIGGERED** : TP1 atteint (considere comme un succes)
- **INVALIDATED** : SL touche ou prix trop loin
- **EXPIRED** : 30 minutes ecoulees sans activation

**Limites :**
- Maximum **5 scenarios actifs** simultanement
- Si un 6e est cree avec un meilleur score, il remplace le plus faible
- Les scenarios expires/invalides sont nettoyes apres 60 secondes

---

## 7. Faiblesses Identifiees (pourquoi le winrate est mauvais)

### 7.1 Pas de filtre de tendance
Le moteur de confluence est **independant** du Trend Analyzer. Un scenario LONG peut etre genere en plein DOWNTREND, et inversement. Il n'y a aucune penalite pour les trades contre-tendance.

**Impact :** Beaucoup de scenarios sont generes a contre-courant du marche.

### 7.2 TP/SL purement mecaniques
Les niveaux TP sont des multiples fixes du risque (1.5x, 2.5x, 4x). Ils ne tiennent **pas compte** de :
- Niveaux de structure (supports/resistances)
- Zones de liquidite
- Order blocks proches
- Points of Control (POC)

**Impact :** Les TP sont souvent dans des zones ou le prix n'a aucune raison d'aller.

### 7.3 Zone d'entree trop etroite
La zone d'entree est bornee a **+/- 0.1%** du prix minimum/maximum des signaux. Pour BTC a $87K, ca fait ~$174 de zone. Combine avec le SL buffer de 0.1%, le risque est tres petit, ce qui rend les TP tres proches.

**Impact :** Le scenario passe de PENDING a ACTIVE puis INVALIDATED tres vite, sans laisser le trade respirer.

### 7.4 Pas de tracking TP2/TP3
Une fois TP1 atteint, le scenario passe a TRIGGERED et c'est fini. Il n'y a pas :
- De tracking des TP2/TP3
- De trailing stop
- De gestion partielle des positions

**Impact :** Impossible de savoir si les scenarios auraient atteint des objectifs plus ambitieux.

### 7.5 Le champ `strength` est ignore
Chaque signal peut porter une force (0 a 1) mais elle n'est **jamais utilisee** dans le calcul du score. Un signal ABSORPTION faible (noise) compte autant qu'un signal ABSORPTION fort (vrai mur).

**Impact :** Des signaux faibles/bruyants contribuent autant que des signaux forts, generant des faux positifs.

### 7.6 Deduplication = un seul OI dans le score
Tous les signaux OI (OI_SURGE, OI_FLUSH, OI_DIVERGENCE) sont regroupes dans la meme categorie de poids. Meme si tu as 3 alertes OI differentes, ca ne compte que pour **8 points**.

### 7.7 Penalite contra trop faible
Un signal dans la direction opposee ne deduit que **30%** de son poids. Un ORDER_BLOCK (SHORT) dans un scenario LONG ne retire que 6 points sur les 20 qu'il "vaut". Ca ne dissuade pas assez les scenarios conflictuels.

### 7.8 Fenetre de 5 minutes pour les signaux
Les signaux de plus de 5 minutes sont supprimes. C'est tres court — un order block identifie il y a 6 minutes est ignore meme s'il est encore valide structurellement.

### 7.9 Templates 5/6 ne verifient pas le signe du funding
Le Short Squeeze (template 5) devrait exiger un funding **negatif** (trop de shorts). Le Long Squeeze (template 6) devrait exiger un funding **positif** (trop de longs). Actuellement, seule la direction du scenario est verifiee, pas le signe du funding.

### 7.10 Pas d'integration entre trend et scenario
Le Trend Analyzer calcule un score composite de -100 a +100 (6 facteurs : momentum prix, CVD, carnet d'ordres, biais signaux, momentum volume, pression liquidations). Mais ce score n'est **jamais injecte** dans le moteur de confluence. Les deux systemes vivent en parallele.

---

## 8. Le Trend Analyzer (systeme parallele)

Score composite de **-100 a +100** base sur 6 facteurs :

| Facteur | Poids | Ce qu'il mesure |
|---------|-------|-----------------|
| Price Momentum | 25% | EMA(8) vs EMA(21) |
| CVD Trend | 25% | Pression achat/vente cumulative |
| Order Book | 15% | Ratio bids vs asks |
| Signal Bias | 15% | Ratio signaux bull vs bear |
| Volume Momentum | 10% | Acceleration volume * direction prix |
| Liquidation Pressure | 10% | Liquidations shorts vs longs |

**Resultat :** `BULL` (score > 15), `BEAR` (score < -15), `NEUTRAL` (entre -15 et +15)

Ce score est affiche dans l'UI (barre du haut) mais **n'influence pas** la generation de scenarios.

---

## 9. Pistes d'Amelioration

1. **Integrer le trend dans le score** : ajouter un facteur "trend alignment" (+15 si scenario aligne avec la tendance, -15 si contre)
2. **Utiliser le champ strength** : ponderer le poids des signaux par leur force (poids * strength)
3. **TP bases sur la structure** : utiliser les niveaux de structure (previous highs/lows, OBs, liquidite) comme TP au lieu de multiples fixes
4. **Elargir la zone d'entree** : augmenter le buffer a 0.3-0.5% pour laisser le trade respirer
5. **Augmenter la fenetre signaux** : passer de 5 a 15 minutes pour les signaux de structure (OB, FVG, BOS)
6. **Tracker TP2/TP3** : continuer le suivi apres TP1 pour mesurer le vrai potentiel
7. **Penalite contra plus forte** : passer de 30% a 60-80% pour decourager les scenarios conflictuels
8. **Verifier le signe du funding** dans les templates squeeze
9. **Minimum de signaux "forts"** : exiger au moins 1 signal de poids >= 15 (structure, OB, sweep) pour valider un scenario
