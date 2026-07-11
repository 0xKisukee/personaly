# personaly

Application de **projection financière et de suivi de patrimoine** personnelle.
Objectif : modéliser avec précision l'évolution du patrimoine net dans le temps —
revenus de tout type, croissance des actifs, dettes, dépenses — pour simuler sa
situation sur plusieurs années.

> 100 % local : aucune base de données, aucun compte, aucune auth.
> Tout est stocké dans le `localStorage` du navigateur.

---

## Stack technique

- **Vite** + **React 19** + **TypeScript**
- **motion** (anciennement framer-motion) pour les animations
- Pas de routeur (navigation par état local), pas de lib UI, pas de lib de graphiques
  (tout en **SVG maison**), pas de backend
- Persistance : `localStorage` (clé `personaly:v1`)

### Lancer le projet

```bash
npm install
npm run dev      # serveur de dev
npm run build    # tsc -b + build de prod (à lancer pour vérifier les types)
npm run preview  # prévisualiser le build
npm test         # vitest — À LANCER APRÈS TOUTE MODIF DU MOTEUR (src/lib/*.test.ts)
```

Les tests (6 fichiers, ~110 cas) couvrent le moteur de projection et ses **invariants
structurels** (voir `src/lib/projection.test.ts`) : colonne patrimoine de la modale =
patrimoine net, pont « début + enrichissement = début suivant », sous-lignes qui somment
aux agrégats, neutralité des transferts (cascade de surplus **et de retrait**, versements,
achats/ventes), plafonds de versements, événements (les 6 types + ordre + désactivation),
**jalons** (dates relatives, offsets, jalon supprimé), inflation/euros constants, 1re année
partielle. `montecarlo.test.ts` couvre les générateurs seedés et le taux de succès ;
`store.test.ts` couvre les **migrations** du localStorage. Le temps y est figé (fake timers).

---

## Aesthetic / design system

Thème **« maison de patrimoine »** : encre vert-forêt profonde, accents **laiton**,
texte ivoire. Tout le style est dans un **seul fichier** : [`src/index.css`](src/index.css)
(tokens, atomes, layout, pages — pas de CSS séparé par page).

- **Polices** (chargées dans [`index.html`](index.html) via Google Fonts) :
  - `Fraunces` — titres éditoriaux (serif à fort contraste)
  - `Hanken Grotesk` — UI / texte courant
  - `Spline Sans Mono` — tous les chiffres (tabulaires)
- **Couleurs** (variables CSS dans `:root`) : `--brass` (laiton), `--sage` (vert
  végétal), `--gain` (vert flux entrant), `--drain` (terracotta flux sortant),
  `--ink*` (échelle d'ivoire).
- Animations : reveals échelonnés au chargement, transitions de page (`AnimatePresence`).

---

## Architecture

```
src/
├── main.tsx                 # entrée React, importe index.css
├── App.tsx                  # provider + "routeur" (état local) + transitions de page
├── index.css                # TOUT le design system
├── lib/
│   ├── types.ts             # modèle de données (source de vérité)
│   ├── store.tsx            # contexte React + persistance + MIGRATIONS localStorage
│   ├── format.ts            # money(), percent(), périodes, âge, whenLabel(), uid()
│   ├── finance.ts           # amortissement : mensualité, split intérêts/capital, durée
│   ├── selectors.ts         # tous les calculs dérivés (patrimoine + flux, sur l'état réel)
│   ├── projection.ts        # moteur de projection mois par mois (déterministe + stochastique)
│   └── montecarlo.ts        # Monte Carlo : rejoue le moteur N fois, bandes P10–P90, succès
├── components/
│   ├── Sidebar.tsx          # nav + ROUTES + LISTE DES PLANS + patrimoine net
│   ├── PageHeader.tsx       # en-tête de page (eyebrow + titre + lede + actions)
│   ├── Modal.tsx            # modale générique animée
│   ├── WhenPicker.tsx       # sélecteur de date : année précise OU jalon ± n années
│   ├── MilestonesEditor.tsx # éditeur de jalons d'un plan (utilisé dans Projection)
│   ├── SankeyChart.tsx      # diagramme de flux (cash-flow d'une année) — SVG maison
│   └── icons.tsx            # icônes SVG inline (pas de dépendance)
└── pages/
    ├── ProfilPage.tsx       # 01 — Profil (identité seule)
    ├── PatrimoinePage.tsx   # 02 — Patrimoine (actifs + passifs)
    ├── FluxPage.tsx         # 03 — Flux (entrants/sortants)
    └── ProjectionPage.tsx   # 04 — Projection : 4 vues (Projection / Événements / Cash-flow / Probabilité)
```

La navigation est un simple `useState<RouteId>` dans `App.tsx`. Les `ROUTES`
sont définies dans `Sidebar.tsx`.

### Finances courantes vs Plans (distinction structurante)

Comme ProjectionLab, l'app sépare **l'état réel** des **simulations** :

- **Finances courantes** (racine de `AppState` : `profile`, `assets`, `liabilities`,
  `incomes`, `expenses`) = la vérité d'aujourd'hui, **source de vérité unique**. Éditées
  dans Profil / Patrimoine / Flux. Une simulation ne les modifie **jamais**.
- **Plans** (`state.plans: Plan[]`, actif = `state.activePlanId`) = des couches de
  simulation posées dessus. Chaque plan a **ses** jalons, **ses** événements et **ses**
  hypothèses (`ProjectionParams`). Sélection + création dans la **sidebar** (« Nouveau
  plan » = duplication du plan actif). « Plan retraite à 60 » vs « à 64 » côte à côte.

Le moteur ne connaît ni plans ni finances courantes : il reçoit un **instantané composé**
`SimState` via `simInput(state, plan)` (finances courantes + jalons/événements du plan).

---

## Modèle de données

Voir [`src/lib/types.ts`](src/lib/types.ts) pour la source de vérité. Résumé :

```ts
AppState = {                        // === FINANCES COURANTES (réalité) ===
  profile:     { firstName, birthDate }
  assets:      Asset[]
  liabilities: Liability[]
  incomes:     IncomeItem[]         // revenus complémentaires (FLUX)
  expenses:    ExpenseItem[]        // dépenses & impôts (FLUX)
  plans:       Plan[]               // === SIMULATIONS (couches virtuelles) ===
  activePlanId: string
}

Plan = {
  id, name
  milestones:  Milestone[]          // jalons de vie du plan (année nommée)
  events:      PlannedEvent[]       // événements datés du plan
  projection:  ProjectionParams     // hypothèses du plan (persistées)
}

// Entrée du moteur = finances courantes + couche du plan, composée par simInput()
SimState = { profile, milestones, assets, liabilities, incomes, expenses, events }
```

### Milestone (jalon) — dates relatives

Un jalon est une **année nommée** propre à un plan (`{ id, label, year }`) : Retraite,
Achat maison, Départ des enfants… Les flux et événements peuvent **s'ancrer** dessus via
un `MilestoneRef { milestoneId, offset? }` (± n années) au lieu d'une année en dur :
déplacer le jalon **recale tout d'un coup** ce qui s'y accroche. L'ancrage **prime** sur
l'année en dur, qui reste comme **instantané de secours** si le jalon est supprimé (rien
ne casse, un warning est émis). Résolution : `refYear()`, `eventYear()`, `flowBounds()`
(types.ts) ; libellé humain : `whenLabel()` (format.ts, ex. `« Retraite +2 (2059) »`).
Un plan dupliqué copie ses jalons avec les **mêmes ids** — les ancrages continuent de
résoudre dans la copie.

### Asset (actif) — deux mécanismes de gain INDÉPENDANTS

C'est **la** distinction centrale du modèle :

1. **Croissance de la valeur** (`growthRate`, %/an) — **CAPITALISÉE**.
   Le gain reste dans l'actif, sa valeur grossit et **se compose** dans la
   projection. Positif (PEA +6, immo +2) ou négatif (voiture −15).
   → N'alimente PAS le cashflow. C'est une **plus-value/moins-value latente**.

2. **Revenu distribué** (`incomeMode`: `none` | `rate` | `amount`) — **PERÇU EN CASH**.
   Le gain sort de l'actif (loyer, dividende) et alimente les flux entrants ;
   il **ne se compose pas** dans l'actif (la valeur ne bouge pas de ce fait).
   Dans la projection : le mode `rate` suit la valeur de l'actif (donc croît si
   l'actif s'apprécie), le mode `amount` est indexé sur l'inflation si
   `indexIncomes` est actif.

Un même actif peut cumuler les deux (appartement loué : +2 %/an de valeur ET un loyer).

**Versements (projection)** : les actifs « liquides » (`compte_courant`, `livret_epargne`,
`placement` — voir `canReceiveDeposits()`) peuvent recevoir le **surplus d'épargne** de la
projection. `depositCap` = plafond de **dépôts cumulés** (ex. 150 000 € pour un PEA),
`depositsMade` = versements déjà effectués. Le plafond porte sur les dépôts, pas sur la
valeur : la croissance peut le dépasser, seuls les versements s'arrêtent.

**Volatilité (`volatility`, %/an)** : écart-type annuel du rendement, utilisé
**uniquement** par le Monte Carlo (onglet Probabilité). La projection déterministe garde
`growthRate` sec. Absent/0 = rendement certain.

### Liability (passif) — emprunt amortissable

`outstanding` (capital restant dû) réduit le patrimoine net. Pour un emprunt :
`rate`, `termMonths` (durée restante → date de fin), `monthlyPayment`
(**calculée automatiquement** depuis capital + taux + durée, ou saisie si
`autoPayment = false`). Voir `monthlyPayment()` dans `finance.ts`.

### PlannedEvent — événements datés, ATOMIQUES et COMPOSABLES

Six types (`kind`), datés à l'**année** — soit en dur (`year`) soit **ancrés sur un
jalon** (`when: MilestoneRef`, prioritaire) — appliqués au 1er mois, avant les flux :
`buy` (achat d'actif payé cash, avec `fees` sortie sèche — l'actif embarqué est un
`Asset` complet : croissance, revenu, charges…), `sell` (produit → épargne ; prix
fixé optionnel, sinon valeur projetée), `loan` (nouvel emprunt : capital → épargne,
mensualité calculée), `cash` (rentrée/sortie ponctuelle), `repay` (remboursement
anticipé), `deposit` (versement épargne → actif éligible, transfert neutre — la
capacité de plafond est PARTAGÉE avec la cascade du surplus, `capLeftByAsset`).
**Les crédits sont indépendants des biens, comme sur la page
Patrimoine** : un achat financé = `loan` + `buy` la même année ; une vente avec
crédit en cours = `sell` + `repay`. Ordre d'application dans une année : le cash
entre d'abord (sell → cash → loan) puis sort (repay → buy). Chaque événement a une
case à cocher (`disabled`) pour l'exclure/réinclure de la projection sans le supprimer.

**« Et si ? »** : il n'y a **pas de scénarios** (retirés — voir décisions). Pour comparer
des variantes, on joue à deux niveaux : décocher un événement (`disabled`) au sein d'un
plan, ou **dupliquer le plan** et comparer les trajectoires via le mode **Plans** du
graphe. Un plan est plus lourd qu'un ancien scénario (copie complète, indépendante) mais
plus lisible : pas de niveau de variante caché.

**Comptabilité** : tous ces événements sont des transferts **neutres** pour le
patrimoine net, SAUF les frais (`eventFees`, sortie sèche), l'écart prix de vente
fixé − valeur projetée (`eventGain`, PV réalisée) et les rentrées/sorties
(`eventCash`). Ces trois termes entrent dans l'enrichissement pour préserver
l'identité « patrimoine début + enrichissement = début suivant » (testée). Si un
événement rend l'épargne négative ou est inapplicable (actif déjà vendu…), le
moteur émet un **warning** affiché en bannière — jamais d'annulation silencieuse.

### IncomeItem / ExpenseItem (FLUX)

Saisis manuellement, mensuel ou annuel (`period`). Les revenus sont **nets avant
impôt**. L'impôt n'est PAS calculé par un moteur : c'est une **dépense** de
catégorie `impot` que l'utilisateur ajoute lui-même (décision explicite).

**Bornes ancrables** : `startYear`/`endYear` (années en dur) OU `startRef`/`endRef`
(ancrage jalon, prioritaire). Ex. salaire jusqu'à la Retraite, pension à partir de
Retraite +1. Résolu par `flowBounds()` avec les jalons du **plan actif** ; libellé par
`whenLabel()`. Chaque flux garde aussi un taux de revalorisation propre `growth` (sinon
suit l'inflation globale si l'indexation est active).

---

## Les pages

### 01 — Profil
Prénom + date de naissance (âge calculé). Socle des finances courantes. Les **jalons**
de vie ne sont plus ici : ils sont propres à chaque plan et s'éditent dans l'onglet
**Événements** de la page Projection.

### 02 — Patrimoine
- **Hero** : Patrimoine net = Brut − Passifs.
- **Actifs** : catégories (immobilier, compte courant, livret, placement, véhicule,
  autre). Modale avec les deux blocs distincts *Croissance capitalisée* et
  *Revenu distribué*.
- **Passifs** : emprunts (taux, durée, mensualité auto) et dettes simples.

### 03 — Flux
Visualise ce qui fait varier le patrimoine net, en **mensuel ou annuel** (bascule).

**Comptabilité (rigoureuse) :**

```
ΔPatrimoine net = revenus encaissés          (cash entrant)
                + plus-value latente          (croissance capitalisée, actifs qui montent)
                − dépenses & impôts           (cash sortant)
                − intérêts d'emprunt          (vrai coût)
                − moins-value latente         (dépréciation, actifs qui baissent)
```

Deux décisions clés encodées ici :

- **La croissance capitalisée EST une évolution de patrimoine** et apparaît dans
  les flux (entrants si appréciation, sortants si dépréciation), taguée `latent`
  (≠ `encaissé`). On distingue *encaissé/réalisé* de *latent* (et non
  liquide/illiquide : un Livret A est liquide mais sa croissance n'est pas un
  revenu encaissé).

- **Le capital remboursé d'un emprunt n'est NI un coût NI un gain** : seuls les
  **intérêts** sont un flux sortant. Le capital sort de la trésorerie mais revient
  en patrimoine (la dette baisse d'autant) → il s'annule. Le split intérêts/capital
  est calculé par amortissement réel sur 12 mois (`loanYearSplit()`).

**Sous-groupes :**
- Entrants : *Revenus du patrimoine* (auto) · *Revenus complémentaires* (manuel) · *Plus-value latente* (auto)
- Sortants : *Dépenses & impôts* (manuel) · *Intérêts d'emprunt* (auto) · *Moins-value latente* (auto)

Sous le hero, une bande décompose l'enrichissement en **Réalisé (encaissé) + Latent**.

### 04 — Projection
La page opère toujours sur le **plan actif** (barre en haut : renommer / dupliquer /
supprimer le plan). Elle est découpée en **4 vues** :

**Projection** — Simulation **mois par mois** sur un horizon réglable (10/20/30/40 ans) —
moteur dans [`src/lib/projection.ts`](src/lib/projection.ts).
- Les actifs à `growthRate` ≠ 0 **se composent** (intérêts composés, appliqués mensuellement).
- Les emprunts sont **amortis échéance par échéance** et **s'éteignent** à leur terme
  (`termMonths`) ou quand le capital est remboursé → la mensualité libérée gonfle l'épargne.
- Le cash net réalisé s'accumule en **épargne cumulée**, **réinvestie** au taux
  `savingsYield` (composée).
- **Affectation du surplus en cascade** (`surplusTargets: string[]`, ordonné) : le
  surplus mensuel est versé dans le 1er actif éligible (PEA, livret…) jusqu'à son
  **plafond de versements**, l'excédent passe au 2e, etc. — chaque dépôt se compose
  ensuite au `growthRate` de l'actif. Ce qui reste après la cascade, et les **déficits**
  (si pas de cascade de retrait), sont portés par l'épargne.
- **Cascade de retrait / décumulation** (`withdrawalTargets: string[]`, MIROIR du
  surplus) : quand l'épargne devient négative, on **puise** dans ces actifs dans l'ordre
  (transfert neutre actif → épargne) avant de laisser le déficit sur l'épargne.
  Indispensable pour projeter une **retraite** (phase de décumulation). Vide = comportement
  historique (déficit porté par l'épargne, qui peut passer en négatif).
- **Hypothèses** paramétrables (persistées dans `plan.projection`) : rendement de
  l'épargne, **inflation**, indexation des revenus/dépenses, affichage en
  **euros constants** (réel) ou courants (nominal).
- **Indépendance financière** : seuil de patrimoine net **défini par l'utilisateur**
  (`fiTarget`), PAS déduit par le moteur. Le moteur marque la première année où le
  patrimoine net projeté atteint le seuil (évalué après conversion en euros constants).
- **Graphe SVG maison**, modes **patrimoine net** (aire) · **composition** (actifs/épargne/
  dettes empilés) · **Plans** (une courbe de patrimoine net par plan, quand >1 plan).
  Survol, **jalons** (repères ◇ nommés), **marqueurs cliquables** (⚑ événement → ouvre
  l'éditeur, ✓ fin d'emprunt, ◆ indépendance financière) avec légende des glyphes.
- **Table annuelle** cliquable → **détail d'une année** (modale de composition : patrimoine
  début d'année + décomposition des flux, chaque agrégat dépliable en sous-lignes).

**Événements** — éditeur des **jalons du plan** (`MilestonesEditor`, avec suggestions
Retraite / Espérance de vie d'après l'âge) puis la liste des événements datés (les 6 types,
via `WhenPicker` : année précise ou jalon ± n).

**Cash-flow** — diagramme de **Sankey** (`SankeyChart`, SVG maison) du cash-flow d'une
année (slider pour choisir l'année) : sources → trésorerie → affectations. L'**épargne**
est le poste d'équilibre (surplus « vers l'épargne », déficit « puisé dans l'épargne » ou
couvert par les retraits d'actifs). Capital remboursé et versements = transferts neutres.

**Probabilité** — **Monte Carlo** (`src/lib/montecarlo.ts`) : rejoue le moteur ~400 fois en
bruitant la croissance mensuelle de chaque actif selon sa `volatility` (rendement mensuel
~ N(μ, σ/√12), générateur **seedé** → reproductible). Affiche une **jauge de taux de succès**
(part des tirages où l'épargne ne tombe jamais à sec, cascade de retrait incluse) et un
**graphe en éventail** (bandes de percentiles P10–P90 / P25–P75, médiane, + la trajectoire
déterministe en pointillé). Bouton « appliquer des valeurs types » si aucun actif n'a de
volatilité. Le moteur tourne en **mode light** (`opts.light`, pas de `detail`) pour la vitesse.

La 1re année ne couvre que les **mois restants de l'année civile** (départ au mois courant).

---

## Décisions de conception déjà tranchées (ne pas re-débattre)

- ❌ **Pas de moteur fiscal.** Revenus saisis nets avant impôt ; l'impôt est une
  dépense manuelle. Volonté explicite : un moteur serait trop complexe et incomplet.
- ❌ **Pas de sociétés.** La page SAS/SCI a été retirée (peut-être plus tard).
- ✅ **Croissance capitalisée vs revenu distribué** : deux champs séparés par actif.
- ✅ **encaissé vs latent** (terminologie), pas liquide/illiquide.
- ✅ **Mensualité d'emprunt calculée** depuis capital + taux + durée.
- ✅ **Capital remboursé exclu** des flux sortants (neutre pour le patrimoine).
- ✅ **Saisie mensuelle OU annuelle** au choix, conversion automatique.
- ✅ **Indépendance financière = seuil saisi par l'utilisateur** (`fiTarget`), pas une
  heuristique de revenus passifs (essayée puis abandonnée : impossible de deviner quels
  actifs l'utilisateur vendrait/garderait).
- ❌ **Objectif daté retiré** (« X € en année Y » + bannière d'écart) : jugé peu utile,
  redondant avec le seuil d'indépendance qui répond à la meilleure question (« quand
  est-ce que j'atteins X ? »).
- ✅ **Événements atomiques, crédits indépendants des biens** : pas d'emprunt embarqué
  dans un achat ni de « solder l'emprunt » dans une vente — on compose des événements
  simples la même année (cohérent avec le modèle Patrimoine).
- ✅ **Finances courantes ≠ Plans** : l'état réel (patrimoine, flux) est unique et jamais
  modifié par une simulation ; les « et si » vivent dans des **plans** (jalons + événements
  + hypothèses par plan), comparés via le mode Plans du graphe.
- ✅ **Jalons = dates relatives** : ancrer flux/événements sur un jalon (Retraite…) plutôt
  qu'une année en dur ; déplacer le jalon recale toute la projection. L'année en dur
  survit comme secours si le jalon disparaît.
- ❌ **Scénarios retirés** (ils ne faisaient varier QUE les événements) : redondants avec
  les plans (qui varient tout) + `disabled` par événement. Deux niveaux de variantes = trop
  de charge cognitive. Migration : un événement anciennement tagué devient **désactivé**.
- ✅ **Cascade de retrait** (décumulation) en miroir de la cascade de surplus : le déficit
  puise dans les actifs choisis avant de peser sur l'épargne. Neutre pour le patrimoine.
- ✅ **Monte Carlo optionnel** : la volatilité est par actif et n'affecte QUE l'onglet
  Probabilité ; la projection principale reste **déterministe** (lisible, reproductible).

---

## Évolutions futures (feuille de route)

### PROJECTION — déjà fait
Réinvestissement de l'épargne (rendement composé), inflation + indexation + euros
constants, indépendance financière, **charges par actif**, **assurance emprunteur**,
**plancher de valeur**, **détail d'une année** (clic → composition patrimoine + flux),
1re année partielle (mois restants), **cascade de surplus** (PEA → livret → … avec
`depositCap`) et **cascade de retrait** (décumulation), **événements datés** (6 types,
marqueurs ⚑ cliquables, alertes d'épargne négative), **jalons / dates relatives**
(flux et événements ancrés sur Retraite… — recalage automatique), **plans multiples**
(finances courantes vs simulations, comparaison inter-plans sur le graphe),
**Monte Carlo** (bandes P10–P90 + taux de succès, volatilité par actif),
**cash-flow en Sankey** par année.

### PROJECTION — pistes restantes
- Scénarios sur les **hypothèses** (pessimiste/médian/optimiste : taux de croissance
  décalés) — le Monte Carlo couvre déjà l'incertitude, mais pas des jeux d'hypothèses nommés.
- Récurrence d'événements (« changer de voiture tous les 8 ans ») et **modèles** d'événements
  composés (achat immobilier financé = buy + loan pré-liés).
- Horizon personnalisé au-delà des presets ; taux d'épargne requis pour atteindre le
  patrimoine d'indépendance.

### Pistes plus lointaines
- Fiscalité **française** optionnelle (PFU 30 % hors enveloppe, exonération PEA > 5 ans,
  abattements assurance-vie) — vrai différenciateur vs ProjectionLab (US-centré).
- Retour éventuel des **sociétés** (SAS/SCI, quote-part des résultats).
- Export / import des données (sauvegarde JSON), puisque tout est local.

---

## Migrations du localStorage (`store.tsx`)

Le chargement (`loadState()`) est **tolérant** et migre les anciens formats en place —
tout se réécrit propre au prochain `setState`. Migrations actives :

- **État plat → plans** : un ancien `AppState` sans `plans[]` voit ses
  événements/jalons/hypothèses regroupés dans un « Plan principal » ; les finances
  courantes restent à la racine.
- **Scénarios supprimés** : un événement portant `scenario` devient **désactivé**
  (`disabled: true`), la clé est purgée (la trajectoire de Base est inchangée : ces
  événements en étaient déjà exclus). `projection.scenario` et `plan.scenarios` purgés.
- **Clés d'actifs héritées** : `valuationRate` (ancien nom de `growthRate`) supprimée.
- **Projection héritée** : `surplusTargetId` (cible unique) → `surplusTargets` (cascade) ;
  `goalAmount` / `goalYear` (ancêtres de `fiTarget`) purgés.
- **Garde-fous** : `activePlanId` invalide → 1er plan ; liste de plans vide → plan par défaut.

---

## Où regarder en premier en reprenant

1. [`src/lib/types.ts`](src/lib/types.ts) — le modèle et ses commentaires (les
   décisions de modèle y sont documentées) : `AppState` (finances courantes) vs `Plan`
   vs `SimState`, jalons/`MilestoneRef`, les 6 événements.
2. [`src/lib/projection.ts`](src/lib/projection.ts) — le **moteur** mois par mois
   (cascades, événements, jalons, mode stochastique) : le cœur, et le plus testé.
3. [`src/lib/selectors.ts`](src/lib/selectors.ts) — la logique de calcul dérivée
   (patrimoine + flux + comptabilité de l'enrichissement, sur l'état réel).
4. [`src/lib/store.tsx`](src/lib/store.tsx) — persistance + **migrations** localStorage
   (utile après tout changement de modèle).
5. [`src/pages/ProjectionPage.tsx`](src/pages/ProjectionPage.tsx) — la page la plus riche
   (4 vues), et [`src/pages/FluxPage.tsx`](src/pages/FluxPage.tsx) qui matérialise la comptabilité.
