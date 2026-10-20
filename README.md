# personaly

Application **locale** de suivi de patrimoine et de **projection financière** (FR).
Objectif : modéliser finement l'évolution du patrimoine net dans le temps — actifs,
passifs, revenus/dépenses, hypothèses — et le simuler sur plusieurs années.

> **100 % local** : aucun compte, aucun backend. Tout vit dans le `localStorage`
> (`personaly:v1`). Aucune donnée ne quitte le navigateur. Export / import JSON.

---

## Stack & principes

- **Vite** + **React 19** + **TypeScript**.
- **react-router-dom** (`BrowserRouter`) — URLs réelles, deep-link, back/forward.
- **motion** pour les animations (enveloppé dans `<MotionConfig reducedMotion="user">`).
- **Aucune** lib de graphes : tout est en **SVG maison**. Pas de lib UI (design system maison).
- **Thème sombre uniquement** ; feuille `@media print` pour un export papier propre.

```bash
npm run dev       # dev
npm run build     # tsc -b && vite build  (VÉRIFIE LES TYPES — à lancer après changement)
npm test          # vitest run  (À LANCER APRÈS TOUTE MODIF DU MOTEUR/MODÈLE)
npm run preview   # prévisualiser le build
```

**Tests** (`src/lib/*.test.ts`, 171 cas, temps figé) : moteur de projection + ses
**invariants** (patrimoine début + enrichissement = début suivant ; sous-lignes qui somment
aux agrégats ; neutralité des transferts : flows du surplus/retrait, transferts, achats/ventes ;
plafonds ; 6 événements ; jalons/dates relatives ; inflation/euros constants ; 1re année
partielle), Monte Carlo (générateurs seedés + taux de succès), **migrations** localStorage
(`store.test.ts`), **taxonomie d'actifs** (`assets.test.ts`, dont l'invariant « bloc UI
versements ⇔ `DEPOSIT_ELIGIBLE` »).

---

## Architecture

```
src/
├── main.tsx            # entrée React ; importe styles/*.css DANS L'ORDRE (= cascade, ne pas réordonner)
├── App.tsx             # StoreProvider > MotionConfig > BrowserRouter > Shell ; titre par route
├── routes.tsx          # table de routes + slugs des sous-vues Projection
├── lib/                # modèle & logique PURE (testée)
│   ├── types.ts        # modèle = source de vérité (AppState, Asset, Plan, SimState…)
│   ├── store.tsx       # contexte React + persistance + MIGRATIONS + export/import
│   ├── assets.ts       # REGISTRE des types d'actifs (méta, presets, familles, normalizeAsset)
│   ├── selectors.ts    # calculs dérivés (patrimoine, flux, comptabilité, assetPerformance)
│   ├── projection.ts   # MOTEUR mois par mois (déterministe + stochastique)
│   ├── montecarlo.ts   # Monte Carlo (bandes P10–P90, taux de succès)
│   ├── finance.ts      # amortissement (mensualité, split intérêts/capital)
│   └── format.ts       # money(), percent(), périodes, âge, whenLabel(), uid()
├── ui/                 # PRIMITIVES du design system (enrobent les classes CSS)
│   └── Button Input Field Select Segment Card Tag MoneyInput Donut PerformanceBadge(+perfColor)
├── components/         # composants transverses
│   ├── Modal.tsx       # modale générique : PORTAIL vers <body>, focus-trap, verrou de scroll, Escape
│   ├── Sidebar.tsx     # nav (00→03) + liste des PLANS + patrimoine net + accès Paramètres
│   ├── SettingsModal.tsx  # Paramètres : nom, date de naissance
│   ├── PageHeader WhenPicker MilestonesEditor SankeyChart icons
└── pages/
    ├── DashboardPage.tsx   # 00 — Accueil (vue d'ensemble)
    ├── PatrimoinePage.tsx  # 01 — Patrimoine (actifs + passifs)
    ├── FluxPage.tsx        # 02 — Flux (entrants/sortants)
    ├── ProjectionPage.tsx  # 03 — Projection : ORCHESTRATEUR (état, moteur, navigation, modales)
    └── projection/         # les 5 vues + graphes SVG + modales (un fichier par responsabilité)
        └── ProjectionView EventsView CashflowView MonteCarloView
            NetWorthChart CompareChart CascadeEditor SurplusFlowEditor SettingsView EventModal YearDetailModal
            eventHelpers.ts chartUtils.ts
```

`styles/` est éclaté en `tokens.css` (variables) → `base.css` (reset, a11y, print) →
`primitives.css` (atomes + classes utilitaires `.txt-*`) → `layout.css` → `charts.css`.
`main.tsx` les importe **dans cet ordre** (la cascade en dépend).

### Finances courantes vs Plans (distinction structurante)

- **Finances courantes** (`profile`, `assets`, `liabilities`, `incomes`, `expenses`) =
  la réalité d'aujourd'hui, **source de vérité unique**, éditée dans Patrimoine / Flux.
  Une simulation ne les modifie **jamais**.
- **Plans** (`state.plans[]`, actif = `activePlanId`) = des couches **hypothétiques**
  posées dessus : chacun a **ses** événements, **ses** hypothèses, et **ses jalons propres**
  (en supplément des jalons globaux — voir « Jalons » plus bas). Sélection / création dans la
  sidebar (« Nouveau plan » = **plan vide**, hypothèses par défaut, hérite des jalons globaux) ;
  « Dupliquer » (page Projection) = **copie** du plan actif (jalons propres/événements/hypothèses).

Le moteur ne connaît ni l'un ni l'autre : il reçoit un instantané composé `SimState` via
`simInput(state, plan)`.

---

## Modèle de données (`src/lib/types.ts` = source de vérité)

```ts
AppState = {
  profile:   { firstName, birthDate }
  settings:  { horizon, indexIncomes, indexExpenses, realTerms }  // GLOBAUX, partagés par tous les plans
  milestones: Milestone[]                    // JALONS GLOBAUX (voir « Jalons » plus bas)
  assets, liabilities, incomes, expenses     // FINANCES COURANTES
  plans: Plan[], activePlanId                // SIMULATIONS
}
Plan = { id, name, milestones[], events[], projection: ProjectionParams }  // milestones = propres au plan (supplément)
SimState = simInput(state, plan)             // entrée du moteur : jalons = globaux + propres au plan
```

### Actif — DEUX mécanismes de gain indépendants (la distinction centrale)

1. **Croissance de la valeur** (`growthRate`, %/an) — **CAPITALISÉE** : le gain reste dans
   l'actif, se compose, ne verse rien (PEA +7, immo +2, voiture −15). C'est une **plus/moins-value
   latente** ; n'alimente pas le cashflow.
2. **Revenu distribué** (`incomeMode`: `none`/`rate`/`amount`) — **PERÇU EN CASH** (loyer,
   dividende) : alimente les flux entrants, à plat, ne se compose pas.

Un actif peut cumuler les deux (immo `rented` : valeur qui monte **et** loyer). Autres champs :
`charges`, `valueFloor`, `volatility` (Monte Carlo **uniquement**), `depositCap`/`depositsMade`
(versements du surplus), `incomeLiquid`/`growthLiquid`/`liquidYear`/`liquidRef` (liquidité pour
l'indépendance financière — voir « Concepts transverses »). **Registre `lib/assets.ts`** = source
unique par catégorie :

- Catégories : `immobilier` (+ flag `rented`), `epargne` (livrets **et** placements fusionnés),
  `liquidites`, `vehicule`, `autre`. Chaque type porte : libellé, icône, **accent d'identité
  (neutre)**, blocs de formulaire affichés, **presets** (Livret A, PEA, RP, Locatif…),
  `defaultVolatility`.
- **Familles** (regroupement de la liste) : Immobilier / Épargne & liquidités / Autres.
- `normalizeAsset(a)` (appliqué à l'enregistrement) coupe les champs qu'une catégorie n'expose
  pas → pas de « loyer fantôme » sur un bien non loué.
- **`DEPOSIT_ELIGIBLE = ["epargne"]`** (`canReceiveDeposits`) : gouverne **uniquement** le champ
  UI **plafond de versements** (`depositCap`, propre aux livrets/placements). Invariant testé :
  `hasField(cat,"deposits")` ⇔ `canReceiveDeposits`. **Les mouvements de trésorerie** (affectation
  du surplus, retraits en déficit, transferts) portent eux sur **`TRANSFER_ELIGIBLE = ["epargne",
  "liquidites"]`** (`canTransfer`) : tous les **comptes liquides**, compte courant inclus — avec
  l'**Épargne** (`EPARGNE_ID`) comme extrémité supplémentaire des transferts.

### Passif — emprunt amortissable

`emprunt_immo` | `credit` | `autre`. `outstanding` réduit le net ; mensualité **calculée**
depuis capital + taux + durée (`finance.ts`) ou saisie (`autoPayment:false`). `insurance` =
assurance emprunteur mensuelle **en plus** de la mensualité (coût réel ; idem sur un événement
`loan`). **Les crédits sont indépendants des biens** (pas de couplage modèle).

### Flux (`incomes`/`expenses`)

Mensuel ou annuel. Revenus **nets avant impôt** ; l'impôt est une **dépense** manuelle
(catégorie `impot`) — pas de moteur fiscal. Bornes `startYear`/`endYear` **ou** ancrage jalon
`startRef`/`endRef` (prioritaire). `growth` propre au flux (sinon suit l'inflation si indexé).
`nature` (`actif`/`passif`, défaut dérivé de la catégorie) et `liquid`/`liquidYear`/`liquidRef` ne
servent qu'à l'**indépendance financière** (voir « Concepts transverses »).

### Jalons & événements

- **Milestone** = année nommée (`{id,label,year}`, ex. Retraite). Les flux/événements s'y
  **ancrent** via `MilestoneRef{milestoneId, offset?}` : déplacer le jalon recale tout. L'année
  en dur survit comme secours si le jalon disparaît (`refYear`/`eventYear`/`flowBounds`).
- **Jalons GLOBAUX vs propres au plan.** Les jalons vivent à la **racine** (`state.milestones`) :
  ils sont **liés aux finances courantes** (source de vérité) et **présents dans tous les plans**.
  Un plan peut en ajouter **en supplément** (`plan.milestones`, temporaires). Le moteur reçoit
  l'union via `planMilestones(state, plan) = [...state.milestones, ...plan.milestones]`.
  Au **premier lancement**, un jalon global par défaut « **Espérance de vie** » est posé
  (`birthYear + ESPERANCE_AGE`, 85 ans ; recalé quand on change la date de naissance dans les
  Paramètres). S'il est supprimé, il n'est **pas** réajouté. Un **nouveau plan** est vide et
  hérite simplement des jalons globaux.
- **PlannedEvent** = 6 types datés (ou ancrés) : `buy` `sell` `loan` `cash` `repay` `transfer`.
  **Atomiques** (un achat financé = `loan` + `buy` la même année). Transferts **neutres** pour
  le net, sauf frais (`eventFees`), plus-value réalisée (`eventGain`) et rentrées/sorties
  (`eventCash`). `disabled` exclut sans supprimer. Un cas inapplicable → **warning** (jamais
  d'annulation silencieuse).
- **`transfer`** déplace de l'argent entre deux **comptes liquides** — l'**Épargne** (le pool
  de trésorerie `savings`, exposé comme un compte via `EPARGNE_ID`) ou un actif **`canTransfer`**
  (`TRANSFER_ELIGIBLE = ["epargne", "liquidites"]`). Il **remplace l'ancien `deposit`** (versement)
  dont il est un sur-ensemble : `Épargne → actif` (= l'ancien versement), `actif → Épargne`
  (retrait partiel), `actif → actif` (rééquilibrage). **Neutre** : compté comme un **retrait**
  (source, `withdrawn`) ET un **versement** (destination, `deposited`) qui s'annulent au net.
  Une destination-actif respecte son **plafond de versements** (`capLeftByAsset`, partagé avec la
  cascade du surplus) ; l'Épargne n'a pas de plafond (∞, un découvert est signalé). Montant borné
  par `min(demandé, solde source, capacité destination)`. Migration : les `deposit` persistés
  deviennent des `transfer` depuis l'Épargne (`store.tsx`).
- **Euros constants vs courants** (`nominal?` sur **tout** événement) : par **défaut** un montant est en
  **euros d'aujourd'hui** — le moteur l'**indexe sur l'inflation** jusqu'à l'année de l'événement
  (`evInfl`), donc un don de 150 k€ en 2050 = 150 k€ de pouvoir d'achat actuel (plus élevé nominalement,
  stable en euros constants). `nominal:true` = valeur **nominale** telle quelle à la date. Exceptions non
  indexées : prix de vente **absent** (= valeur projetée), remboursement **total**, taux/durée d'un emprunt.
  Pour un **flux** (`flow`), `nominal` change l'**année de référence de la revalorisation** : par défaut
  elle compose depuis **aujourd'hui** (le montant est en euros constants dès un début futur) ; en `nominal`,
  depuis le **début du flux** (le 1er versement = le montant saisi, nominal — ex. « pension de 2 000 €
  nominaux en 2050 »). Détail crucial pour un flux qui **démarre dans le futur**.
- **Récurrence** (`Recurrence` sur `buy`/`cash`/`loan`/`transfer`) : répète un événement à
  intervalle régulier. Le moteur ne fait pas de récurrence « vivante » — il **déplie** le motif
  en instances atomiques datées **avant** la simulation (`expandRecurring`), donc les invariants
  tiennent sans cas spécial. `buy` = **remplacement** (chaque échéance revend l'exemplaire précédent
  à sa valeur projetée, puis achète un neuf — « changer de voiture tous les 10 ans » ; `keepLast`
  garde la dernière) ; `cash`/`loan`/`transfer` = **répétition** du montant. Le dépliage n'applique que
  le `scaling` (réévaluation **réelle**) ; l'inflation de chaque instance vient du moteur (`evInfl`,
  selon `nominal`). Instances éditables depuis le graphe (id dérivé `${id}~k` tronqué pour retrouver
  le motif source).

---

## Moteur (`lib/projection.ts`)

`project(SimState, params)` simule **mois par mois** sur `horizon` ans → `points[]` annuels.
- Actifs `growthRate≠0` **composés** (mensuellement) ; emprunts **amortis** et éteints à terme
  (la mensualité libérée gonfle l'épargne).
- Épargne cumulée **réinvestie** à `savingsYield`.
- **Affectation du surplus** (`surplusTargets: SurplusFlow[]`, ordonné = « cash flow priorities » ;
  cibles = comptes liquides `canTransfer`, compte courant inclus) :
  chaque mois le surplus est servi aux **flows** dans l'ordre de priorité, chacun prélevant dans le
  surplus RESTANT selon son **mode** — `max` (verser le maximum, avant les flows suivants), `percent`
  (% du restant), `amount` (montant fixe/période, indexé sur l'inflation sauf `nominal`) — borné par le
  **plafond de versements** (`depositCap`, partagé avec les transferts) ET un éventuel **solde cible**
  (`targetBalance` : « monter jusqu'à ce solde puis maintenir » ; absent = indéfini). Le reliquat
  retombe en épargne. (Migré depuis l'ancien `string[]` d'ids = flows `max`.) **Cascade de retrait**
  (`withdrawalTargets[]`, string[] ordonné) : en déficit, on puise dans ces actifs avant de peser sur
  l'épargne (décumulation retraite).
- **Indépendance financière** = **calculée**, pas saisie : le moteur marque la 1re année où les
  **revenus passifs liquides** (`liquidIncome`) couvrent les **besoins** (`needs` = dépenses + impôts
  + charges d'actifs + mensualités d'emprunt, capital et assurance compris). Les deux montants sont
  portés par chaque `YearPoint` (voir « Liquidité & nature des revenus »).
- Hypothèses (persistées dans `plan.projection`) : `savingsYield`, `inflation`, indexation
  revenus/dépenses, `realTerms` (euros constants). **Monte Carlo** (`montecarlo.ts`) rejoue ~400×
  en bruitant la croissance selon `volatility` (seedé) → bandes P10–P90 + taux de succès.
- La 1re année ne couvre que les **mois restants** de l'année civile.

### Les 5 vues de Projection (`pages/projection/`)

La page `ProjectionPage` orchestre (compose l'entrée, lance le moteur **une fois**, distribue),
avec une barre de plan (renommer / dupliquer / supprimer) et 5 vues portées par l'URL (`/projection/:vue`) :

- **Projection** — hero (net à l'horizon, évolution, CAGR), **graphe SVG** en 3 modes (net /
  composition actifs·épargne·dettes / **Plans** : une courbe par plan) avec jalons `◇`, marqueurs
  cliquables (`⚑` événement → édite, `✓` fin d'emprunt, `◆` FI) + légende ; **table annuelle** →
  clic = modale **détail d'une année** (composition dépliable ; en euros constants, une ligne
  **érosion monétaire** boucle le pont début → fin). **Volontairement épurée** (pas de
  réglages) : c'est l'écran d'atterrissage. Seul le sélecteur d'**horizon** vit dans l'en-tête.
- **Événements** — deux éditeurs `MilestonesEditor` : **jalons communs** (globaux, tous les plans)
  et **jalons propres à ce plan** (supplément) + liste des 6 événements (saisie via `WhenPicker` :
  année précise ou jalon ± n).
- **Cash-flow** — **Sankey** (`SankeyChart`, SVG maison) d'une année : sources → trésorerie →
  affectations ; l'épargne est le **poste d'équilibre** (surplus « vers l'épargne » / déficit « puisé »).
- **Probabilité** — **Monte Carlo** : jauge de **taux de succès** + **éventail** de percentiles
  (P10–P90 / P25–P75) + médiane + trajectoire déterministe en pointillé.
- **Réglages** (`SettingsView`) — deux blocs : les **hypothèses** (panneau `.assum` : rendement,
  inflation, indexation, euros constants) et les **règles de trésorerie** appliquées chaque mois
  (`SurplusFlowEditor` = flows du surplus, `CascadeEditor` = retraits en déficit). Isolé pour garder
  la Projection propre pour les nouveaux utilisateurs.

---

## Design system

- Thème **« maison de patrimoine »** sombre (thème unique) : encre vert-forêt, accents **laiton**,
  texte ivoire.
- **Polices** (chargées dans `index.html`) : **Fraunces** (titres serif éditoriaux), **Hanken
  Grotesk** (UI/texte), **Spline Sans Mono** (tous les chiffres, tabulaires).
- **Tokens** (`styles/tokens.css`) : `--brass` (laiton), `--sage` (vert végétal), `--gain`/`--drain`
  (performance/flux), `--ink*` (échelle ivoire), `--cat-1..5` (palette catégorielle validée),
  `--perf-*` (échelle de performance divergente), rayons/ombres/`--sidebar-w`.
- Les **primitives `ui/*`** enrobent ces classes ; on construit les pages avec elles (pas de style
  inline dispersé — voir Conventions).

---

## Concepts transverses (à connaître avant de toucher l'UI)

- **Encaissé vs Latent** (comptabilité de la page Flux, rigoureuse) :
  ```
  ΔPatrimoine net = revenus encaissés  + plus-value latente   (croissance des actifs qui montent)
                  − dépenses & impôts  − intérêts d'emprunt   − moins-value latente
  ```
  La croissance capitalisée EST une variation de patrimoine (taguée `latent`, ≠ `encaissé`) — on
  distingue **réalisé/encaissé** de **latent**, pas liquide/illiquide (un Livret A est liquide mais
  sa croissance n'est pas encaissée) — l'axe liquide/illiquide existe, mais sert **uniquement** à
  l'indépendance financière (puce suivante). Le **capital remboursé** n'est ni coût ni gain :
  il sort du cash mais revient en net (la dette baisse d'autant) → exclu des flux sortants (seuls les
  **intérêts** comptent ; split via `loanYearSplit()`). Sous-groupes Entrants : revenus du patrimoine
  (auto) · complémentaires (manuel) · plus-value latente (auto) ; Sortants : dépenses & impôts · charges
  d'actifs · intérêts d'emprunt · moins-value latente.
- **Liquidité & nature des revenus** (axe distinct du précédent, sert **uniquement** à
  l'indépendance financière) : un revenu ne compte au numérateur que s'il est **passif** ET
  **liquide** ET **débloqué**.
  - **Nature** (revenus manuels) : `nature` `actif`/`passif` (`incomeNature`, `isPassiveIncome`),
    défaut dérivé de la catégorie (`salaire` = actif, le reste = passif), surchargeable par flux.
    Un revenu **actif** ne compte JAMAIS — un salaire s'arrête si on arrête.
  - **Liquidité** : revenu manuel passif → `liquid` (défaut **false**, l'utilisateur tague ce qui
    compte) ; revenu **distribué** d'un actif → `incomeLiquid` (défaut **true** : c'est du cash) ;
    **plus-value latente** d'un actif → `growthLiquid` (défaut **false** : un bien qui s'apprécie
    ne verse rien ; à activer pour une assurance-vie ou un placement revendable).
  - **Déblocage** : `liquidYear` / `liquidRef` (ancrage jalon **prioritaire**) — avant cette date
    rien ne compte (assurance-vie, placement bloqué). Absente = liquide immédiatement.
  - **UI** : chaque ligne de revenu de la page **Flux** porte une pastille `LiqPill` cliquable
    (« Revenu du travail » / « Illiquide » / « Liquide dès … ») ouvrant la modale de liquidité.
- **Langage couleur de PERFORMANCE** : `assetPerformance(a)` = `growthRate` + revenu distribué
  net / valeur. Échelle divergente drain→neutre→gain (`--perf-*`), rendue par `ui/PerformanceBadge`
  (+ `perfColor`). ⚠️ **`--gain`/`--drain` = performance RÉELLE par actif** ; les accents de
  catégorie/famille sont **neutres** (identité, pas un jugement). La **palette catégorielle**
  `--cat-1..5` (camemberts, séries de plans) est **validée CVD** (script `validate_palette.js` de
  la skill `dataviz`) et toujours accompagnée d'une **légende**.
- **Accueil (Dashboard, `/`)** : ses modules de **base** (hero patrimoine, Répartition, Flux)
  ne dépendent PAS d'un plan (finances courantes uniquement) ; en dessous, une section **Plans**
  affiche **un aperçu par plan** — mini `NetWorthChart` (courbe + jalons) obtenu en projetant
  chaque plan (net de fin annoncé **à l'âge** atteint), clic → ouvre la Projection sur ce plan.
  **Horizon des aperçus = basé sur l'âge** (jusqu'à 60/80/100/120 ans selon la tranche :
  <40→60, 40–60→80, 60–80→100, >80→120),
  **indépendant** de `settings.horizon` (la timeframe de Projection) — défaut 40 ans si la date
  de naissance est absente.
- **Réglages GLOBAUX** : `settings` porte les préférences partagées par tous les plans —
  `horizon` (fenêtre de projection) **et** les conventions d'indexation/affichage `indexIncomes`,
  `indexExpenses`, `realTerms` (euros constants). Fusionnés à l'appel du moteur
  (`{...plan.projection, ...clés de settings}`) ; `setP` reroute ces clés vers `settings` plutôt que
  vers le plan. Le reste des hypothèses (inflation, rendement, cascades…) reste **propre à chaque
  plan**. Migration : les valeurs sont hissées depuis le plan actif si `settings` ne les portait
  pas encore (continuité).

---

## Conventions & pièges (NE PAS casser)

- **Toutes les modales passent par `components/Modal`** : portail vers `<body>` (sinon un
  ancêtre avec `backdrop-filter`/`transform` — ex. la sidebar — enferme le `position:fixed`),
  focus-trap, verrou de scroll, `role="dialog"`, Escape.
- **Perf de scroll (macOS) — 2 patterns bannis** : (1) `backdrop-filter` au-dessus d'un conteneur
  qui scrolle → re-rasterisation par frame ; (2) `background-attachment: fixed` → repeint le fond
  par frame. Utiliser un assombrissement opaque et un calque `body::before { position: fixed }`.
- **Vue de projection conservée au changement de plan** : `Sidebar` ne navigue vers `/projection`
  que si on n'y est pas déjà (la vue est portée par l'URL `/projection/:vue`).
- **Styles inline sémantiques → classes utilitaires** (`.txt-gain/-drain/-sage/-brass/-faint/-soft`,
  `.tag-brass`). Ne restent en inline que les valeurs **dynamiques** (couleur calculée, accent de
  donnée).
- **a11y** : `<MotionConfig reducedMotion="user">` + `@media (prefers-reduced-motion)` ;
  `:focus-visible` global ; `role="dialog"` + focus-trap. **`@media print`** recolore toute l'app
  (SVG compris) en surchargeant les **tokens** (sombre→clair) et masque nav/boutons. Export JSON
  tagué `charset=utf-8` (anti-mojibake).
- **Migrations tolérantes** (`store.tsx`, `loadState`/`migrateState`) : l'import passe par les
  **mêmes garanties**, tout se réécrit propre au prochain `setState`. Migrations actives :
  état **plat → plans** (ancien `AppState` sans `plans[]` → « Plan principal ») ; **scénarios
  retirés** (événement `scenario` → `disabled:true`, clé purgée) ; **versement `deposit` → `transfer`
  depuis l'Épargne** (`EPARGNE_ID`) ; **`surplusTargets: string[]` → `SurplusFlow[]`** (ids → flows
  `max`) ; backfill `settings` (+ hissage de `horizon` depuis le plan actif) ; remaps de catégories
  (`livret_epargne`/`placement`→`epargne`, `compte_courant`→`liquidites`) ; purges héritées
  (`valuationRate`, `surplusTargetId`→`surplusTargets`, `goalAmount`/`goalYear`/`fiTarget` — ancien
  seuil de patrimoine, remplacé par l'indépendance **calculée**) ; garde-fous
  (`activePlanId` invalide → 1er plan ; liste vide → plan par défaut). **Après tout changement de modèle :
  ajouter/adapter une migration + un test.**

---

## Décisions déjà tranchées (ne pas re-débattre)

Pas de moteur fiscal (impôt = dépense manuelle) · pas de sociétés (SAS/SCI retirées) ·
croissance capitalisée ≠ revenu distribué (2 champs) · terminologie **encaissé vs latent** ·
mensualité d'emprunt calculée · capital remboursé exclu des flux · saisie mensuelle **ou**
annuelle · **FI = calculée** (revenus passifs liquides ≥ besoins), pas un seuil saisi ·
objectif daté retiré · événements **atomiques**, crédits indépendants des biens ·
**scénarios retirés** (remplacés par plans + `disabled`) · **cascade de retrait** (décumulation)
miroir du surplus · Monte Carlo optionnel (la projection principale reste déterministe).

---

## Travaux futurs (reportés — à faire quand l'app sera jugée terminée)

- **Onboarding** (wizard état vide → 1re projection) + **mode démo complet** (persona sandboxé,
  backup/restore non destructif via `loadState`) + **visite guidée**. Reporté délibérément :
  guider vers des écrans encore mouvants serait à refaire. Cadrage détaillé dans l'historique git.
- Pistes moteur : scénarios d'hypothèses nommés, fiscalité française optionnelle (vrai
  différenciateur).

---

## Où regarder en premier

1. `lib/types.ts` — le modèle et ses commentaires (décisions documentées).
2. `lib/projection.ts` — le moteur mois par mois (le cœur, le plus testé).
3. `lib/assets.ts` — le registre des types d'actifs (taxonomie, presets, familles).
4. `lib/selectors.ts` — calculs dérivés (patrimoine, flux, `assetPerformance`).
5. `lib/store.tsx` — persistance + migrations (après tout changement de modèle).
6. `pages/ProjectionPage.tsx` — la page la plus riche (orchestre moteur + 5 vues).
