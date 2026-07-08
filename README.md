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
- Pas de routeur (navigation par état local), pas de lib UI, pas de backend
- Persistance : `localStorage` (clé `personaly:v1`)

### Lancer le projet

```bash
npm install
npm run dev      # serveur de dev
npm run build    # tsc -b + build de prod (à lancer pour vérifier les types)
npm run preview  # prévisualiser le build
```

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
│   ├── store.tsx            # contexte React + persistance localStorage
│   ├── format.ts            # money(), percent(), périodes, âge, uid()
│   ├── finance.ts           # amortissement : mensualité, split intérêts/capital, durée
│   ├── selectors.ts         # tous les calculs dérivés (patrimoine + flux)
│   └── projection.ts        # moteur de projection mois par mois (N années)
├── components/
│   ├── Sidebar.tsx          # nav + définition des ROUTES + patrimoine net
│   ├── PageHeader.tsx       # en-tête de page (eyebrow + titre + lede + actions)
│   ├── Modal.tsx            # modale générique animée
│   └── icons.tsx            # icônes SVG inline (pas de dépendance)
└── pages/
    ├── ProfilPage.tsx       # 01 — Profil
    ├── PatrimoinePage.tsx   # 02 — Patrimoine (actifs + passifs)
    ├── FluxPage.tsx         # 03 — Flux (entrants/sortants)
    └── ProjectionPage.tsx   # 04 — Projection (graphe + table année par année)
```

La navigation est un simple `useState<RouteId>` dans `App.tsx`. Les `ROUTES`
sont définies dans `Sidebar.tsx`.

---

## Modèle de données

Voir [`src/lib/types.ts`](src/lib/types.ts) pour la source de vérité. Résumé :

```ts
AppState = {
  profile:     { firstName, birthDate }
  assets:      Asset[]
  liabilities: Liability[]
  incomes:     IncomeItem[]         // revenus complémentaires (FLUX)
  expenses:    ExpenseItem[]        // dépenses & impôts (FLUX)
  projection:  ProjectionParams     // hypothèses de la page Projection (persistées)
}
```

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

### Liability (passif) — emprunt amortissable

`outstanding` (capital restant dû) réduit le patrimoine net. Pour un emprunt :
`rate`, `termMonths` (durée restante → date de fin), `monthlyPayment`
(**calculée automatiquement** depuis capital + taux + durée, ou saisie si
`autoPayment = false`). Voir `monthlyPayment()` dans `finance.ts`.

### IncomeItem / ExpenseItem (FLUX)

Saisis manuellement, mensuel ou annuel (`period`). Les revenus sont **nets avant
impôt**. L'impôt n'est PAS calculé par un moteur : c'est une **dépense** de
catégorie `impot` que l'utilisateur ajoute lui-même (décision explicite).

---

## Les pages

### 01 — Profil
Prénom + date de naissance (âge calculé). Sert de socle aux projections futures.

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
Simulation **mois par mois** sur un horizon réglable (10/20/30/40 ans) — moteur dans
[`src/lib/projection.ts`](src/lib/projection.ts).
- Les actifs à `growthRate` ≠ 0 **se composent** (intérêts composés, appliqués mensuellement).
- Les emprunts sont **amortis échéance par échéance** et **s'éteignent** à leur terme
  (`termMonths`) ou quand le capital est remboursé → la mensualité libérée gonfle l'épargne.
- Le cash net réalisé s'accumule en **épargne cumulée**, **réinvestie** au taux
  `savingsYield` (composée).
- **Affectation du surplus en cascade** (`surplusTargets: string[]`, ordonné) : le
  surplus mensuel est versé dans le 1er actif éligible (PEA, livret…) jusqu'à son
  **plafond de versements**, l'excédent passe au 2e, etc. — chaque dépôt se compose
  ensuite au `growthRate` de l'actif. Ce qui reste après la cascade, et les
  **déficits**, sont portés par l'épargne. (Migration : l'ancien `surplusTargetId`
  est converti en cascade à 1 élément au chargement, cf. `store.tsx`.)
- **Hypothèses** paramétrables (persistées dans `state.projection`) : rendement de
  l'épargne, **inflation**, indexation des revenus/dépenses, affichage en
  **euros constants** (réel) ou courants (nominal).
- **Indépendance financière** : seuil de patrimoine net **défini par l'utilisateur**
  (`fiTarget`), PAS déduit par le moteur — l'utilisateur sait mieux que nous ce qu'il
  garderait ou vendrait (voiture, maison…) pour en vivre. Le moteur marque la première
  année où le patrimoine net projeté atteint le seuil (évalué après conversion en
  euros constants si activée : le seuil s'entend en pouvoir d'achat d'aujourd'hui).
- **Flux à durée limitée + indexation par flux** : chaque revenu/dépense peut avoir un
  `startYear`/`endYear` et un taux de revalorisation `growth` propre.
- **Détail d'une année** : clic sur une ligne de la table → modale de composition
  (patrimoine début d'année + décomposition des flux). Le moteur émet un
  `detail` par `YearPoint`.
- La 1re année ne couvre que les **mois restants de l'année civile** (départ au mois courant).
- Rendu : hero (patrimoine à l'horizon, évolution, ×mult, CAGR), **graphe SVG maison**
  avec 2 vues (**patrimoine net** en aire · **composition** actifs/épargne/dettes empilés),
  survol, marqueurs (fin d'emprunt, indépendance financière) et **table annuelle** cliquable.

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

---

## Évolutions futures (feuille de route)

### PROJECTION — déjà fait
Réinvestissement de l'épargne (rendement composé), inflation + indexation + euros
constants, indépendance financière, flux à durée limitée (start/end), graphe
composition (actifs/épargne/dettes), **indexation par flux** (`growth` propre à
chaque revenu/dépense), **charges par actif**, **assurance emprunteur**, **plancher
de valeur**, **patrimoine d'indépendance** (seuil `fiTarget` saisi par l'utilisateur →
année d'atteinte), **détail d'une année**
(clic sur une ligne → composition patrimoine + flux), 1re année partielle (mois restants),
**affectation du surplus en cascade d'actifs** (PEA → livret → … au lieu de l'épargne,
avec **plafond de versements** par actif — `depositCap`).

### PROJECTION — pistes restantes
- **Scénarios comparés** (pessimiste / médian / optimiste) côte à côte — volontairement
  non implémenté pour l'instant.
- **Événements ponctuels** (achat/vente d'actif, nouvel emprunt daté, prime/héritage) :
  retirés car buggés, à re-concevoir proprement plus tard.
- Horizon personnalisé au-delà des presets ; taux d'épargne requis pour atteindre le
  patrimoine d'indépendance.

### Pistes plus lointaines
- Fiscalité optionnelle plus fine (toujours sans moteur lourd : taux effectifs par
  type de revenu, par ex.).
- Retour éventuel des **sociétés** (SAS/SCI, quote-part des résultats).
- Export / import des données (sauvegarde JSON), puisque tout est local.
- Plusieurs scénarios de projection comparés.

---

## Où regarder en premier en reprenant

1. [`src/lib/types.ts`](src/lib/types.ts) — le modèle et ses commentaires (les
   décisions de modèle y sont documentées).
2. [`src/lib/selectors.ts`](src/lib/selectors.ts) — toute la logique de calcul
   (patrimoine + flux + comptabilité de l'enrichissement).
3. [`src/lib/finance.ts`](src/lib/finance.ts) — amortissement des emprunts.
4. [`src/pages/FluxPage.tsx`](src/pages/FluxPage.tsx) — la page la plus riche, qui
   matérialise toute la comptabilité.
