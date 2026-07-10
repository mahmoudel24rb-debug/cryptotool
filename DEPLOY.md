# Déploiement Railway — MACKUANT

## Prérequis (une fois)

```bash
npm i -g @railway/cli
railway login
```

## Première mise en ligne

Depuis `c:\Users\dglco\Documents\code\cryptotool` :

```bash
railway init          # crée le projet (choisis un nom, ex. "mackuant")
railway up            # build + déploiement (uploade aussi la charting_library via .railwayignore)
```

Puis dans le **dashboard Railway** (railway.com → ton projet → le service) :

1. **Région** : Settings → Region → **EU (Amsterdam)**. ⚠ OBLIGATOIRE : les IP
   américaines sont bloquées par Binance — en région US, aucun flux Binance.
2. **Variables** (onglet Variables) :
   - `ANTHROPIC_API_KEY` = ta clé (celle du fichier .env local)
   - `APP_PASSWORD` = le mot de passe de ton dashboard (choisis-en un solide)
3. **Volume** (clic droit sur le service → Attach Volume) :
   - Mount path : `/app/data`
   - C'est là que vivent le journal des trades et l'état des scénarios —
     sans volume, tout est effacé à chaque redéploiement.
4. **Domaine** : Settings → Networking → Generate Domain → tu obtiens
   `https://mackuant-production-xxxx.up.railway.app`

Ouvre l'URL : le navigateur demande un identifiant/mot de passe —
**n'importe quel nom d'utilisateur**, et ton `APP_PASSWORD`.

## Mises à jour ensuite

```bash
railway up            # redéploie le code local actuel
railway logs          # suit les logs ([CONFLUENCE], [SCENARIO], [FEEDS]...)
```

## À savoir

- Le healthcheck Railway utilise `/api/health` (seule route sans mot de passe).
- Les modifications de config faites via l'onglet Settings du dashboard vivent
  dans le conteneur : elles sont **perdues au redéploiement** (config.json est
  dans l'image). Les réglages durables se font dans le repo local puis `railway up`.
- En cloud, pas d'Avast : le WebSocket Binance Futures fonctionne en direct
  (plus de tag `REST` dans [FEEDS]).
- Essai gratuit : ~5 $ de crédit / 30 jours. Ensuite plan Hobby 5 $/mois.
- Coût estimé de l'app : ~0,2-0,4 vCPU + ~300-500 Mo RAM en continu.
