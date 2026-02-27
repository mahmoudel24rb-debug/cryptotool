# Guide des Signaux — QUANT SYS Order Flow Monitor

---

## Comprendre les bases

### Qu'est-ce que l'Order Flow ?
L'order flow, c'est le flux réel des ordres d'achat et de vente sur un exchange.
Contrairement aux graphiques classiques qui montrent juste le prix, l'order flow
montre QUI achète, QUI vend, avec COMBIEN, et À QUELLE VITESSE.

### Vocabulaire clé

| Terme | Définition |
|-------|-----------|
| **Taker** | Celui qui passe un ordre au marché (market order) — il "prend" la liquidité |
| **Maker** | Celui qui a un ordre limite dans le carnet — il "fournit" la liquidité |
| **CVD** | Cumulative Volume Delta = somme(volume buy) - somme(volume sell). Montre qui domine |
| **Spot** | Marché au comptant — tu achètes du vrai BTC |
| **Perp** | Perpetual futures — contrats dérivés avec levier |
| **Liquidation** | Fermeture forcée d'une position à levier quand la marge est insuffisante |

---

## Les 7 Signaux

---

### 1. ABSORPTION (tag jaune)

**Concept** : Un mur d'ordres limites absorbe l'agressivité du camp opposé.

#### Bearish Absorption
```
ABSORPTION | PERP | 20:43:11 | BINANCE_FUTURES:btcusdt
Bearish Absorption! Heavy buying (+$10.56M) absorbed by limit sellers on BINANCE_FUTURES:btcusdt.
```

**Ce qui se passe** :
- Les acheteurs balancent $10.56M en market buy orders (ils achètent agressivement)
- MAIS le prix ne monte presque pas
- Pourquoi ? Des gros limit sellers (vendeurs passifs) absorbent tout
- C'est comme pousser un mur — tu dépenses de l'énergie mais ça bouge pas

**Interprétation** :
- ⚠️ BEARISH — Les vendeurs sont plus forts que les acheteurs
- Quand les acheteurs s'épuiseront → le prix risque de chuter
- Plus le volume absorbé est gros, plus le signal est fort

#### Bullish Absorption
```
Bullish Absorption! Heavy selling (-$3.25M) absorbed by limit buyers on HYPERLIQUID:BTC.
```

**Ce qui se passe** :
- Les vendeurs balancent $3.25M en market sell orders
- MAIS le prix ne baisse presque pas
- Des gros limit buyers (acheteurs passifs) absorbent tout

**Interprétation** :
- ✅ BULLISH — Les acheteurs tiennent le support
- Les vendeurs vont s'épuiser → potentiel rebond

---

### 2. DIVERGENCE (tag cyan)

**Concept** : Le prix va dans un sens, mais le volume (CVD) dit le contraire.

#### Bullish Divergence
```
DIVERGENCE | SPOT | 15:36:41 | BINANCE SPOT:btcusdt
Bullish Divergence! Price falling but BINANCE:btcusdt CVD rising (+$23.67M).
```

**Ce qui se passe** :
- Le PRIX BAISSE (ce qu'on voit sur le graphique)
- Mais le CVD MONTE (= plus d'achats que de ventes en réalité)
- Ça veut dire que les acheteurs accumulent discrètement pendant que le prix baisse

**Interprétation** :
- ✅ BULLISH — Le smart money achète dans la faiblesse
- La baisse de prix est artificielle ou temporaire
- Retournement haussier probable

#### Bearish Divergence
```
Bearish Divergence! Price rising but OKX:BTC-USDT CVD dropping (-$4.06M).
```

**Ce qui se passe** :
- Le PRIX MONTE
- Mais le CVD BAISSE (= plus de ventes que d'achats)
- Le prix monte sur du vent, sans vrai support acheteur

**Interprétation** :
- ⚠️ BEARISH — La hausse est fragile, pas soutenue par du vrai volume acheteur
- Distribution probable (les gros vendent dans la hausse)

#### Variante [MICRO]
```
[MICRO] Bullish Divergence! Price falling but BINANCE:btcusdt CVD rising (+$4.51M).
```
- Même logique mais sur une fenêtre TRÈS courte (30 secondes)
- Signal plus rapide, plus fréquent, utile pour le scalping
- Moins fiable que la divergence normale

---

### 3. EXHAUSTION (tag magenta/rose)

**Concept** : Gros mouvement de prix sur très peu de volume = le mouvement est à bout de souffle.

#### Bullish Exhaustion (= bon pour les acheteurs)
```
EXHAUSTION | SPOT | 22:28:44 | BYBIT:BTCUSDC-SPOT
Bullish Exhaustion! BYBIT:BTCUSDC-SPOT dropped $88.80 on mere $12k volume. Sellers exhausted.
```

**Ce qui se passe** :
- Le prix a CHUTÉ de $88.80
- Mais seulement $12k de volume a été échangé
- C'est rien du tout — il n'y a plus de vendeurs, ils sont épuisés

**Interprétation** :
- ✅ BULLISH — Les vendeurs n'ont plus de munitions
- Le dump est terminé, rebond probable
- Plus le ratio prix/volume est extrême, plus le signal est fort

#### Bearish Exhaustion
```
Bearish Exhaustion! OKX:BTC-USDT rose $52.30 on mere $45k volume. Buyers exhausted.
```

**Interprétation** :
- ⚠️ BEARISH — Les acheteurs n'ont plus de munitions
- La hausse est à bout de souffle

---

### 4. SPIKE (tag orange)

**Concept** : Pic soudain et massif de volume — quelque chose vient de se passer.

```
SPIKE | PERP | 20:44:59 | BINANCE_FUTURES:btcusdt
Massive Buy Spike on BINANCE_FUTURES:btcusdt. Vol: $4.05M
```

**Ce qui se passe** :
- Le volume sur les 5 dernières secondes est 5x supérieur à la moyenne des 5 dernières minutes
- Quelqu'un (ou un algo) a passé un GROS ordre d'un coup

**Interprétation** :
- 🔶 NEUTRE — Un spike seul ne donne pas de direction
- **Buy Spike** = afflux massif d'acheteurs → potentiellement bullish
- **Sell Spike** = afflux massif de vendeurs → potentiellement bearish
- Souvent déclenché par : une news, un breakout, un stop-loss en cascade
- Regarde les autres signaux qui arrivent en même temps pour comprendre le contexte

**Clé de lecture** :
- Spike + Absorption = le mouvement est contenu (pas de continuation)
- Spike + pas d'absorption = le prix va probablement continuer dans la direction du spike
- Spike + Liquidation = cascade de stops, mouvement violent probable

---

### 5. VELOCITY (tag violet)

**Concept** : Le CVD bouge d'un montant énorme en moins de 3 secondes. C'est de l'activité de whale ou d'algorithme.

#### Flash Pump / Flash Dump
```
VELOCITY | PERP | 18:11:17 | BINANCE_FUTURES:btcusdt
[VELOCITY] Flash Dump! BINANCE_FUTURES:btcusdt CVD shifted $5.73M in under 3s.
```

**Ce qui se passe** :
- $5.73M de ventes nettes en MOINS DE 3 SECONDES
- C'est pas un humain qui fait ça — c'est un algo ou une whale qui exécute d'un coup

#### Flash Buy/Sell Cluster
```
[VELOCITY] Flash Buy Cluster! BINANCE_FUTURES:btcusdt CVD shifted $5.97M in under 3s.
```

**Ce qui se passe** :
- Même chose mais ça s'est produit PLUSIEURS FOIS en 30 secondes
- C'est une attaque coordonnée ou un gros algorithme en train d'exécuter

**Interprétation** :
- 🔥 TRÈS IMPORTANT — C'est le signal le plus "urgent"
- Flash Dump Cluster = quelqu'un de gros est en train de vendre massivement
- Flash Buy Cluster = quelqu'un de gros est en train d'acheter massivement
- Ce type de mouvement précède souvent un gros move directionnel
- Si tu vois un cluster dans un sens → le prix va probablement suivre

---

### 6. TWAP (tag bleu)

**Concept** : Détecte les algorithmes TWAP (Time-Weighted Average Price) — typiquement des institutionnels.

```
TWAP | SPOT | 20:52:50 | BINANCE SPOT:btcusdt
[TWAP] Systematic algorithmic selling detected on BINANCE:btcusdt.
```

**Ce qui se passe** :
- L'outil a détecté des trades avec :
  - Taille similaire (ex: tous autour de $50k)
  - Intervalles réguliers (ex: toutes les 8 secondes)
  - Même direction (tous des sells)
  - Au moins 5 occurrences d'affilée
- C'est la signature d'un algo TWAP institutionnel

**Interprétation** :
- 📊 TRÈS INFORMATIF — Un institutionnel est en train d'exécuter un gros ordre
- **TWAP Selling** = un institutionnel distribue (vend progressivement) → bearish
- **TWAP Buying** = un institutionnel accumule (achète progressivement) → bullish
- Les algos TWAP sont discrets par nature — le fait qu'on les détecte = edge
- Le mouvement peut durer des heures (les TWAP exécutent lentement)

---

### 7. LIQUIDATION (tag rouge)

**Concept** : Des positions à levier sont liquidées de force.

```
LIQUIDATION | PERP | 18:10:21 | BINANCE_FUTURES:btcusdt
Massive LONG Liquidation: $76k wiped out on BINANCE_FUTURES:btcusdt.
```

**Ce qui se passe** :
- Des traders qui étaient en position LONG (pariaient à la hausse) avec du levier
  ont été liquidés (marge insuffisante → l'exchange ferme leur position de force)
- $76k de positions liquidées en 60 secondes

**Interprétation** :
- **LONG Liquidation** = le prix baisse et les longs se font liquider
  - ⚠️ Amplifie la baisse (les liquidations créent des market sells)
  - Peut créer un effet cascade (une liq en déclenche d'autres)
  - MAIS si le volume de liquidation est énorme → possible point bas (tout le monde est sorti)

- **SHORT Liquidation** = le prix monte et les shorts se font liquider
  - 🚀 Amplifie la hausse (les liquidations créent des market buys = short squeeze)
  - Peut provoquer un short squeeze violent

---

## Comment lire les signaux ensemble

### Combo bearish (prépare-toi à une baisse)
1. **Bearish Absorption** répétée (les acheteurs tapent dans un mur)
2. **Bearish Divergence** (prix monte mais CVD baisse)
3. **TWAP Selling** (un institutionnel distribue)
4. **Bearish Exhaustion** (la hausse s'essouffle)
5. → Puis **Sell Spike** + **LONG Liquidations** = le dump arrive

### Combo bullish (prépare-toi à une hausse)
1. **Bullish Absorption** répétée (les vendeurs tapent dans un mur)
2. **Bullish Divergence** (prix baisse mais CVD monte)
3. **TWAP Buying** (un institutionnel accumule)
4. **Bullish Exhaustion** (le dump s'essouffle)
5. → Puis **Buy Spike** + **SHORT Liquidations** = le pump arrive

### Signaux d'alerte maximum 🚨
- **Velocity Cluster** + **Spike** + **Liquidation** en même temps
  = mouvement MASSIF en cours, fais attention à ta position
- Plusieurs exchanges affichent le même signal au même moment
  = confirmation cross-exchange, signal très fort

---

## Les couleurs dans l'interface

| Élément | Couleur | Signification |
|---------|---------|---------------|
| `SPOT` | 🟢 Vert | Marché au comptant (vrai BTC) |
| `PERP` | 🟣 Violet | Perpetual futures (levier) |
| `ABSORPTION` | 🟡 Jaune | Absorption détectée |
| `DIVERGENCE` | 🔵 Cyan | Divergence prix/CVD |
| `EXHAUSTION` | 🟣 Magenta | Épuisement du mouvement |
| `SPIKE` | 🟠 Orange | Pic de volume |
| `VELOCITY` | 🟣 Violet | Mouvement ultra-rapide du CVD |
| `TWAP` | 🔵 Bleu | Algo institutionnel détecté |
| `LIQUIDATION` | 🔴 Rouge | Liquidation massive |

## Les exchanges dans le graphique

| Ligne | Exchange | Marché |
|-------|----------|--------|
| 🔵 Bleu | Binance Futures | Perp |
| 🟢 Vert | Hyperliquid | Perp |
| 🟣 Violet | Bybit | Perp |
| 🟡 Jaune | Binance | Spot |
| 🔵 Cyan | Coinbase | Spot |
| 🟠 Orange | OKX | Spot/Perp |

---

## Tips

1. **Un signal seul ne veut rien dire** — regarde toujours le contexte (autres signaux, timeframe, prix)
2. **Les signaux PERP sont plus importants que SPOT** — c'est là que se joue le levier et les liquidations
3. **Volume > tout** — un signal avec $10M est 10x plus significatif qu'un signal avec $500k
4. **Cross-exchange = confirmation** — si Binance ET Bybit montrent la même absorption, c'est solide
5. **TWAP = le plus rare et le plus précieux** — quand un instit se montre, ça dure longtemps
6. **Liquidation en cascade = danger** — si tu es positionné dans le même sens, sors vite
