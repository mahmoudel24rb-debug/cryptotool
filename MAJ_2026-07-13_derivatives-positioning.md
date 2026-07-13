# MAJ 2026-07-13 — Onglet Derivatives : positionnement (Long/Short + Δ OI 24h)

Commit : `3eaaed8` · Service Railway : `mackuant` (production) · 5 fichiers, +330 / −19

---

## Pourquoi

L'onglet **Derivatives** montrait l'Open Interest avec un seul chiffre de variation :
un `-0.02%` **instantané** (fenêtre glissante d'environ 1 minute, calculée sur le
buffer mémoire). Ça ne dit pas l'essentiel : **est-ce que les positions se
construisent ou se dénouent** pendant que le basis se dégrade ? Un OI qui monte
sous un basis en discount (backwardation) est une lecture *opposée* à un OI qui
fond. Il manquait aussi le **long/short ratio** — savoir de quel côté est la foule.

Objectif de la MAJ : ajouter ces deux signaux de positionnement, à la fois dans
l'UI et dans le contexte fourni au Risk Desk (LLM).

---

## Ce qui a été ajouté

### 1. Δ OI sur 24h glissantes (construction vs débouclage)

- **Vraie fenêtre 24h**, pas l'instantané. Le buffer mémoire ne retient que
  ~30 min (200 snapshots × 10 s), donc impossible d'en tirer du 24h. On
  reconstruit la baseline « il y a 24h » depuis l'**historique REST** des
  exchanges :
  - **Binance** : `futures/data/openInterestHist?period=1h&limit=25` →
    champ `sumOpenInterestValue` déjà **en USD** (pas de multiplication par le prix).
    Série croissante dans le temps → `data[0]` = il y a ~24h.
  - **Bybit** : `v5/market/open-interest?intervalTime=1h&limit=25` → OI en BTC,
    converti en USD via le prix courant. Série décroissante → dernier élément = ~24h.
- Affichage dans la colonne **OPEN INTEREST** :
  - **`Δ 24h`** : pourcentage **agrégé pondéré par l'OI** de chaque exchange,
    + le delta en USD (ex. `+5.55%  +$0.54B`).
  - **Badge `+x% 24h`** par exchange, à droite de sa barre.
  - **Verdict** en clair : *» positions se construisent / se dénouent / stables*.
  - **Couverture** : liste des exchanges réellement inclus dans la baseline
    (ex. `BYB·BIN`) — transparence sur ce qui entre dans le calcul.
- L'ancien `-0.02%` instantané est **conservé mais rétrogradé** en petite ligne
  grise **`Δ 1m`**, pour ne pas le confondre avec le 24h.

### 2. Long/Short ratio (positionnement des comptes)

Trois sources, rafraîchies avec le reste :
- **Retail Binance** — `globalLongShortAccountRatio` (tous les comptes).
- **Top traders** — `topLongShortPositionRatio` (positions des gros comptes Binance).
- **Comptes OKX** — `rubik/stat/contracts/long-short-account-ratio`.

Nouvelle section **POSITIONING — LONG/SHORT** dans la colonne OPEN INTEREST :
pour chaque source, le **ratio** (vert si > 1 = plus de longs, rouge si < 1) et
une **barre long (vert) / short (rouge)** avec repère à 50 %.

### 3. Alimentation du Risk Desk (LLM)

Les deux signaux sont ajoutés au contexte marché (`RiskDeskContext.derivatives`) :
`oiDelta24hPct` + `longShortRatios`. Le system prompt a été enrichi pour que l'IA
croise explicitement : *OI en hausse + basis en discount + comptes majoritairement
longs = risque de purge des longs en retard*.

---

## Ce qui a été corrigé / une décision de correctness

### OKX exclu de la baseline 24h (piège d'échelle)

Pendant la vérification live, une erreur a été rattrapée : brancher OKX sur le
Δ 24h fabriquait un faux `-22%`.

**Cause** : mismatch de périmètre. L'OI OKX **temps réel** de l'app ne couvre que
`BTC-USDT-SWAP` (~2,0 B$), alors que l'historique **rubik** (`ccy=BTC`) agrège
**tous** les contrats BTC (USDT + USDC + coin-margined, ~2,6 B$). Comparer « now »
(un seul contrat) à « 24h ago » (tous les contrats) invente une variation qui
n'existe pas.

**Décision** : **OKX est retiré de la baseline 24h**. Binance et Bybit comparent
bien *contrat identique à contrat identique* → l'agrégat pondéré reste honnête.
OKX **reste affiché** pour l'OI courant et le long/short ratio ; seul son Δ 24h
est écarté. Le label de couverture rend ça visible (`BYB·BIN`).

### Garde-fous

- **Sanity guard** sur la baseline 24h : une OI « il y a 24h » n'est acceptée que
  si elle reste dans `[0.2× ; 5×]` de l'OI actuel — une réponse malformée ou une
  mauvaise unité ne peut pas corrompre le delta.
- **`deltaPct` pondéré, pas un ratio de deux sommes** : le % agrégé est
  `Σ(oiNow · pct) / Σ(oiNow)` sur les seuls exchanges qui ont une baseline. On ne
  divise jamais deux sommes calculées sur des ensembles d'exchanges différents
  (ce qui serait biaisé si un exchange manque d'un côté).
- **`null` explicite** quand aucune baseline n'est encore dispo (l'UI affiche
  `baseline…` au lieu d'un faux `0%`).

---

## Cadence

- OI / funding / basis temps réel : cadence existante inchangée (poll 10 s,
  broadcast 10 s).
- Baseline 24h + long/short ratio : rafraîchis toutes les **5 min** (ces valeurs
  bougent lentement), poll séparé lancé au `start()` du tracker OI.

---

## Vérification (avant déploiement)

Le parsing (noms de champs, ordre des tableaux, unités) a été **testé contre les
vrais endpoints** avant validation — c'est ce test qui a révélé le piège OKX.

Contrôle live (BTC ~62 k$) :

| Exchange | OI courant | Δ 24h |
|----------|-----------:|------:|
| Binance  | 6,67 B$    | +3,2 % |
| Bybit    | 3,73 B$    | +9,8 % |
| OKX      | 2,00 B$    | (hors baseline) |
| Hyperliquid | 2,26 B$ | (pas d'historique) |
| **Agrégat pondéré** | | **+5,5 %** |

Long/Short : Retail 1,80 · Top traders 1,70 · OKX 1,68 → **foule nettement longue**.

Lecture combinée : positions qui **se construisent** (+5,5 % OI / 24h) pendant que
le basis est en **backwardation** et que les comptes sont **longs** → configuration
typique de risque de purge des longs. Exactement le signal recherché.

`tsc` serveur + client **clean**, `npm run build` **OK**.

---

## Fichiers touchés

| Fichier | Rôle |
|---------|------|
| `src/server/derivatives/openInterest.ts` | Poll historique 24h + long/short, agrégation pondérée, sanity guard, getters `getOI24hDelta` / `getLongShort` / `getAvgLongShortRatio` |
| `src/server/derivatives/types.ts` | Types `LongShortData`, champs 24h + long/short sur `DerivativesState` et `DerivativesSnapshot` |
| `src/server/engine.ts` | Câblage dans le broadcast dérivés + contexte Risk Desk |
| `src/server/llm/riskDesk.ts` | Type de contexte étendu + hint de prompt (build/unwind + positionnement) |
| `src/client/components/tabs/DerivativesTab.tsx` | Rendu : Δ 1m rétrogradé, Δ 24h + verdict + couverture, section POSITIONING long/short |
