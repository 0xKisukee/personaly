# REFACTOR — Personaly : du MVP portable à l'app de patrimoine « pro »

> Plan de transition détaillé et **modulaire**. On implémente **phase par phase**
> (jamais tout d'un coup). Chaque phase est auto-suffisante, livrable et testable
> isolément.
>
> **Langue** : ce document de travail mêle FR/EN ; l'app et les exemples de copie UI
> restent **100 % français**.
>
> ⚡ **Reprise rapide** — avant de coder, lire le **§11 Suivi d'avancement** (source de
> vérité de « ce qui est fait / à faire », à mettre à jour à chaque session).

---

## 0. Ce qui est décidé (verrouillé — ne pas re-débattre)

Ces réponses cadrent **tout** le plan. Si l'une change, plusieurs phases changent.

| Axe | Décision | Conséquence |
|---|---|---|
| **Cible** | Outil **perso** de puissance (toi + quelques proches) | Pas de comptes, pas de multi-tenant, pas de billing. |
| **Données** | **100 % local** (localStorage) | On garde le store actuel. On ajoute **export/import JSON** (sauvegarde). Pas de backend, pas de Supabase. |
| **Stack** | **Incrémental** sur Vite + React 19 | On garde le moteur, les types, les tests. On ajoute : **routeur** (`react-router-dom`, seule dépendance nouvelle), design system modulaire, primitives UI. Graphes : **SVG maison poli** (pas de lib). |
| **Contenu** | **Pas de nouvelles features complexes** | ❌ pas de moteur fiscal, ❌ pas de foyer/couple, ❌ pas d'agrégation bancaire, ❌ pas de sociétés. **Objectif = mieux utiliser l'existant.** |
| **Langue** | **100 % FR** pour l'instant | i18n non prévu (peut venir plus tard sans refonte si les strings sont centralisées). |

### Ce qu'on veut vraiment (reformulé depuis tes réponses)

1. **UX à la ProjectionLab** — parcours clair, guidage, moins de friction, feedback immédiat.
2. **UI & design de meilleur niveau** — design system propre, cohérent, respirant (voir §12,
   tu es ouvert à un **rafraîchissement de palette**).
3. **Onboarding + mode démo complet** — un premier lancement qui prend l'utilisateur par la
   main, **et** un mode démo qui montre toutes les fonctionnalités et explique l'app.
4. **Taxonomie d'actifs riche** — catégories nettes, chacune avec **ses propriétés propres**
   et **son formulaire dédié**, différenciées finement par des **presets** :
   `immobilier` (flag loué), `compte_courant`, `liquidités`, `épargne & placements`
   (presets : Livret A, LDDS, PEA, CTO, assurance-vie, PER, ETF/actions…), `véhicule`, `autre`.
5. **Langage couleur de performance** — d'un coup d'œil, savoir quel actif **rapporte /
   coûte**, lequel s'apprécie / se déprécie.
6. **« Just good to use »** — soin général, états vides, transitions, cohérence, saisie fluide.

### Non-objectifs (explicites)

- Aucun changement du **moteur de projection** (`projection.ts`, `montecarlo.ts`) autre
  que l'adaptation minimale à la taxonomie enrichie. Ses **invariants testés restent la loi**.
- Aucune fiscalité automatique, aucun foyer, aucune banque connectée, aucune société.
- Aucun serveur.

---

## 1. Principes directeurs

1. **Le moteur est sacré.** Toute la valeur de calcul est déjà là et testée (~110 cas).
   On ne le réécrit pas ; on l'**habille** mieux. Si un changement de modèle est
   nécessaire (taxonomie), il passe par une **migration store** + **mise à jour des tests**.
2. **Modularité d'abord.** Chaque phase = une PR autonome qui build, passe les tests, et
   se démontre seule. On peut s'arrêter après n'importe quelle phase sans casser l'app.
3. **Design system avant pages.** On extrait des **primitives** réutilisables *avant* de
   refaire les pages, sinon on recopie du style partout.
4. **Le modèle reste un sur-ensemble unifié.** On enrichit l'**UX** par type d'actif sans
   éclater `Asset` en N interfaces (voir §7 — **décision A confirmée**). Coût moteur ≈ nul.
5. **Zéro régression de données.** `loadState()` migre. Toute évolution de forme = une
   migration + un test de migration.
6. **Local-first assumé.** Puisque tout est local : **export/import JSON** est une
   fonctionnalité de première classe (sauvegarde, transfert de machine), pas un « plus tard ».
7. **Traçabilité multi-session.** Le **§11** est tenu à jour en fin de chaque session :
   ce qui est fait, en cours, à faire, et les décisions prises en cours de route.

---

## 2. Architecture cible (arborescence après refonte)

Évolution de l'existant, pas révolution. En **gras** = nouveau.

```
src/
├── main.tsx
├── App.tsx                      # devient shell + <RouterProvider>
├── lib/                         # ── cœur métier + moteur (peu touché) ──
│   ├── types.ts                 # + champs de taxonomie (flag rented, voir §7)
│   ├── store.tsx                # + migration taxonomie, + export/import, + seed démo
│   ├── format.ts  finance.ts  selectors.ts  projection.ts  montecarlo.ts
│   ├── **assets.ts**            # NEW — registre des types d'actifs (méta, presets, champs, couleur)
│   └── **demo.ts**              # NEW — persona de démonstration (AppState d'exemple complet)
├── **styles/**                  # NEW — index.css éclaté en modules
│   ├── tokens.css               #   variables : couleurs, type, espace, rayons, ombres
│   ├── base.css                 #   reset, body, scrollbars, sélection
│   ├── primitives.css           #   .btn .input .select .segment .field .tag .card …
│   ├── layout.css               #   shell, sidebar, page, grid
│   └── charts.css               #   styles partagés des graphes
├── **ui/**                      # NEW — primitives React (design system)
│   ├── Button.tsx  Input.tsx  MoneyInput.tsx  Select.tsx  Field.tsx  Segment.tsx
│   ├── Card.tsx  Row.tsx  Tag.tsx  Stat.tsx  Tooltip.tsx  Sparkline.tsx
│   ├── Modal.tsx                #   (déplacé depuis components/)
│   └── PerformanceBadge.tsx     #   NEW — pastille couleur de perf (voir §8)
├── components/                  # composants « métier » transverses (conservés)
│   ├── Sidebar.tsx  PageHeader.tsx  WhenPicker.tsx  MilestonesEditor.tsx
│   ├── SankeyChart.tsx  icons.tsx
│   └── **onboarding/**          # NEW — premier lancement + mode démo
│       ├── OnboardingFlow.tsx  steps/*.tsx  Tour.tsx  DemoBanner.tsx
├── pages/
│   ├── **DashboardPage.tsx**    # NEW — vue d'ensemble (00 — Accueil)
│   ├── ProfilPage.tsx  PatrimoinePage.tsx  FluxPage.tsx  ProjectionPage.tsx
│   └── projection/ …            # inchangé (habillage seulement)
└── **routes.tsx**               # NEW — table de routes (extraite de Sidebar)
```

---

## 3. Vue d'ensemble des phases

Ordre = **dépendances**. Chaque phase livre quelque chose de visible.

| # | Phase | Pourquoi maintenant | Dépend de |
|---|---|---|---|
| **0** | Socle : routeur + export/import + garde-fous | débloque navigation & sauvegarde, sans toucher au visuel | — |
| **1** | Design system : tokens + primitives (+ direction de design §12) | fondation de tout le reste | 0 |
| **2** | Taxonomie d'actifs (le cœur) | ta demande n°4 ; touche modèle + migration | 1 |
| **3** | Langage couleur de performance | ta demande n°5 ; s'appuie sur la taxonomie | 2 |
| **4** | Dashboard / vue d'ensemble | point d'entrée « à la ProjectionLab » | 1, 3 |
| **5** | Refonte page par page (Patrimoine, Flux, Projection) | applique le DS + la taxonomie partout | 2, 3 |
| **6** | Onboarding + **mode démo complet** | une fois les pages nettes, on guide vers elles | 4, 5 |
| **7** | Graphes : polish (SVG maison) | finition data-viz | 3, 5 |
| **8** | Responsive · a11y · finitions | passage final | tout |

> On peut **s'arrêter proprement** après n'importe quelle phase. 0→1→2→3 est le chemin
> critique. **Pas d'urgence** : on avance progressivement, en tenant le §11 à jour.

---

## 4. Détail des phases

Chaque phase liste : **But**, **Étapes** (petites, PR-able), **Fichiers**, **Acceptation**
(comment on sait que c'est fini), **Risques**.

---

### Phase 0 — Socle (routeur + sauvegarde + garde-fous)

**But.** Poser les fondations invisibles : une vraie navigation par URL et la sauvegarde
locale, sans changer l'apparence.

**Étapes.**
1. Ajouter `react-router-dom`. Extraire les routes de `Sidebar.tsx` vers `src/routes.tsx`.
   Remplacer le `useState<RouteId>` d'`App.tsx` par un routeur ; garder les transitions
   `AnimatePresence` sur le `<Outlet>` (clé = `location.pathname`). URLs : `/`, `/profil`,
   `/patrimoine`, `/flux`, `/projection/:vue`.
2. **Export JSON** : bouton « Exporter mes données » → télécharge `personaly-AAAA-MM-JJ.json`
   (dump de `AppState`).
3. **Import JSON** : bouton « Importer » → lit un fichier, passe par `loadState()` (donc
   **migrations appliquées**), remplace l'état après confirmation.
4. Garde-fous : écran de confirmation avant import/reset ; « Réinitialiser » (efface le
   localStorage) ; **indicateur « Enregistré »** discret (l'app persiste déjà à chaque
   `setState`, on le rend visible pour rassurer).

**Fichiers.** `App.tsx`, `routes.tsx` (new), `Sidebar.tsx`, `store.tsx` (export/import),
`pages/*` (imports de nav → `<Link>`/`useNavigate`).

**Acceptation.** Navigation par URL fonctionnelle (back/forward, deep-link d'une vue de
projection) ; export produit un JSON re-importable qui restitue l'état à l'identique ;
`npm run build` + `npm test` verts.

**Risques.** Faible. Bien vérifier que la vue active de Projection est portée par l'URL
(`/projection/probabilite`) pour ne pas perdre l'état au refresh.

---

### Phase 1 — Design system : tokens + primitives

**But.** Transformer le `index.css` monolithique (1613 lignes) en **système modulaire** et
créer une **bibliothèque de primitives React** réutilisables. Objectif : iso-rendu à la fin
du split (refactor structurel), puis on ouvre la porte au **rafraîchissement de design (§12)**.

**Étapes.**
1. **Éclater `index.css`** en `styles/{tokens,base,primitives,layout,charts}.css`, importés
   par `main.tsx`. Découpage mécanique, zéro changement de valeur.
2. **Enrichir les tokens** (`tokens.css`) : compléter l'échelle d'espacement (`--sp-1..8`),
   de rayons, d'ombres, de z-index ; **ajouter les tokens sémantiques de perf** (voir §8,
   prépare la phase 3). Garder le thème « maison de patrimoine » comme base.
3. **Extraire les primitives React** dans `src/ui/` en enrobant les classes existantes :
   `Button` (variants `brass`/`ghost`/`danger`), `Input`, **`MoneyInput`** (saisie monétaire
   avec séparateurs de milliers + `€`, gros gain d'ergonomie), `Select`, `Field`
   (label + help + erreur), `Segment`, `Card`, `Row`, `Tag`, `Stat` (eyebrow + valeur mono +
   sub), `Tooltip`. Déplacer `Modal` → `ui/`.
4. **Refactor pilote** : migrer **une seule** page (Profil, la plus simple) vers les
   primitives pour valider l'API des composants avant de tout migrer (phase 5).
5. **(Optionnel, si direction §12 retenue)** appliquer le rafraîchissement de palette /
   thème au niveau des tokens uniquement — les primitives héritent sans changement de code.

**Fichiers.** `styles/*` (new), `ui/*` (new), `main.tsx`, `pages/ProfilPage.tsx` (pilote),
`components/Modal.tsx` → `ui/Modal.tsx`.

**Acceptation.** Après le split : rendu **identique** avant/après. Profil utilise
exclusivement les primitives ; build + tests verts ; plus aucun style inline « one-off » sur
Profil ; `MoneyInput` en place.

**Risques.** Régressions visuelles subtiles au découpage CSS → migrer valeur par valeur,
pas de réécriture. **Commit « split pur » séparé** du commit « enrichissement/rafraîchissement ».

---

### Phase 2 — Taxonomie d'actifs (le cœur de la demande)

**But.** Passer d'un formulaire générique unique à des **types d'actifs distincts**, chacun
avec ses champs, ses libellés, ses **presets** et son **formulaire adapté**. Voir la
**spec complète en §7** (décision de modèle, liste des types, champs par type, migration).

**Étapes.**
1. **Faire évoluer `AssetCategory`** (voir §7.2) : catégories finales →
   `immobilier`, `compte_courant`, **`liquidites`** (NEW), **`epargne`** (fusion de
   `livret_epargne` + `placement`), `vehicule`, `autre`. Ajouter le **flag `rented?`** sur
   l'`Asset` (immobilier loué ou non).
2. **Créer le registre `lib/assets.ts`** : pour chaque catégorie → `{ label, icon, accent
   (couleur), champs affichés, canDeposit, presets, defaults, aide }`. Source unique de
   vérité UI (remplace le `ASSET_META` local à la page).
3. **Presets** (différenciateur fin, un clic pré-remplit) :
   - Épargne & placements : **Livret A** (plafond 22 950 €), **LDDS** (12 000 €), **PEL**,
     **PEA** (150 000 €, volatilité type), **CTO** (volatilité), **Assurance-vie** (fonds €/UC),
     **PER**, **ETF/Actions** (volatilité élevée). Les plafonds sont structurels ; les taux
     sont des valeurs par défaut **éditables** (ne pas figer un taux « officiel »).
   - Immobilier : **Résidence principale** (0 revenu, `rented=false`), **Locatif**
     (`rented=true` → loyer + charges).
   - Véhicule : **Voiture** (dépréciation −X %/an + plancher).
4. **`AssetModal` par type + flag** : le formulaire n'affiche que les blocs pertinents
   (croissance / revenu / charges / versements / volatilité / plancher) selon la catégorie ;
   pour l'immobilier, une **bascule « loué »** fait apparaître/disparaître le bloc revenu
   (loyer). Refonte de la modale actuelle en composant piloté par le registre.
5. **Migration store** (`store.tsx`, voir §7.3) : `livret_epargne` → `epargne`,
   `placement` → `epargne` ; test de migration dans `store.test.ts`.
6. **Adapter le moteur au strict minimum** : `projection.ts`/`selectors.ts` ne dépendent que
   de champs *comportementaux* (growthRate, incomeMode, depositCap, `canReceiveDeposits`…),
   pas des libellés. Mettre à jour `DEPOSIT_ELIGIBLE` = `["compte_courant", "epargne"]`.
   **Vérifier que tous les invariants testés passent.**

**Fichiers.** `lib/types.ts`, `lib/assets.ts` (new), `lib/store.tsx`, `lib/store.test.ts`,
`lib/selectors.ts`, `lib/projection.ts` (touche minime), `pages/PatrimoinePage.tsx`
(la modale), `projection/EventModal.tsx` (le `buy` embarque un `Asset` → même registre).

**Acceptation.** Chaque type d'actif a son formulaire adapté et ses presets ; la bascule
« loué » de l'immobilier marche ; un actif créé avant migration (`placement`/`livret`)
s'affiche correctement en `epargne` après migration ; `npm test` vert (invariants +
migrations) ; `EventModal` (achat) réutilise le même registre.

**Risques.** **Le plus élevé du plan.** Touche le modèle → ripple sur moteur, sélecteurs,
tests, migrations, `EventModal`. Mitigation : garder `Asset` comme **sur-ensemble unifié**
(§7 décision A), n'ajouter que des champs optionnels, migration exhaustive + tests d'abord.

---

### Phase 3 — Langage couleur de performance

**But.** Rendre lisible **d'un coup d'œil** quel actif rapporte / coûte / s'apprécie /
se déprécie. Voir la **spec en §8**.

**Étapes.**
1. Définir la **métrique de perf** par actif (§8.1) : rendement total = croissance
   capitalisée `growthRate` + rendement distribué net (revenu − charges) / valeur. Déjà
   calculable via `assetYearlyNet` + `growthRate`.
2. Ajouter les **tokens couleur** (échelle divergente drain→neutre→gain, + intensités) dans
   `tokens.css` ; s'assurer qu'ils tiennent dans le thème (pas de rouge/vert criard :
   réutiliser `--gain`/`--drain` et dériver des paliers).
3. Primitive **`PerformanceBadge`** + **`Sparkline`** (mini-courbe de valeur projetée sur
   l'horizon, réutilise le moteur en mode light).
4. **Appliquer** : liste des actifs (barre/point coloré + tri par perf), hero patrimoine,
   table de projection, Dashboard.
5. Accessibilité : **jamais la couleur seule** — toujours doublée d'un signe (↗/↘, +/−) et
   d'une valeur chiffrée (déjà le cas partiellement).

**Fichiers.** `tokens.css`, `ui/PerformanceBadge.tsx` (new), `ui/Sparkline.tsx` (new),
`lib/selectors.ts` (helper `assetPerformance()`), `PatrimoinePage.tsx`, `DashboardPage.tsx`.

**Acceptation.** Chaque actif porte une couleur cohérente reflétant sa perf ; tri
« par rendement » disponible ; contraste AA respecté ; l'info reste lisible en niveaux de
gris (test : désaturer).

**Risques.** Choix esthétique — risque de « sapin de Noël ». Mitigation : palette **sobre et
divergente** dérivée des tokens existants, intensité proportionnelle, une seule couleur
d'accent par ligne.

---

### Phase 4 — Dashboard / vue d'ensemble (00 — Accueil)

**But.** Une page d'accueil « à la ProjectionLab » : l'état du patrimoine en un écran +
raccourcis. Aujourd'hui l'app ouvre sur Patrimoine ; ce n'est pas un point d'entrée motivant.

**Étapes.**
1. Route `/` = `DashboardPage`. Sidebar : ajouter « Accueil » en tête.
2. Contenu : **hero patrimoine net** (+ variation projetée à 1/5/10 ans via moteur light),
   **répartition des actifs** (donut/barres colorés par la perf de la phase 3), **top
   revenus/coûts**, **mini-courbe de projection** (aperçu cliquable → page Projection),
   prochain **jalon** / prochain **événement**, **taux d'épargne** courant.
3. États vides intelligents : si aucun actif → CTA « Ajoute ton premier actif » (relie
   l'onboarding, phase 6).

**Fichiers.** `pages/DashboardPage.tsx` (new), `Sidebar.tsx`/`routes.tsx`, réutilise
`selectors.ts`, `projection.ts` (light), primitives UI + graphes.

**Acceptation.** Ouverture de l'app sur un tableau de bord lisible ; chaque bloc est
cliquable vers sa page ; se remplit/vide gracieusement selon les données.

**Risques.** Faible (composition de l'existant). Attention à ne **pas** relancer le moteur
plusieurs fois — mémoïser une projection light partagée.

---

### Phase 5 — Refonte page par page

**But.** Appliquer le design system (phase 1) + la taxonomie (phase 2) + les couleurs
(phase 3) à **chaque page**, en visant l'ergonomie ProjectionLab.

**Étapes (une sous-PR par page).**
1. **Patrimoine** : lignes d'actifs regroupées par **famille** (immobilier / liquidités &
   épargne / autres), sous-totaux par famille, tri (valeur / perf / nom), badge de perf,
   sparkline. Modale par type + bascule « loué » (phase 2). Passifs : idem, lien visuel
   actif↔emprunt (visuel seul, pas de couplage modèle — cf. décision « crédits indépendants »).
2. **Flux** : garder la comptabilité rigoureuse existante ; améliorer la **hiérarchie
   visuelle** des sous-groupes, la bascule mensuel/annuel, la bande « réalisé + latent ».
3. **Projection** : ne pas toucher au moteur ni aux 4 vues logiquement ; **habiller** —
   barre de plan plus claire, contrôles d'hypothèses regroupés (panneau), légende des
   glyphes du graphe, modale « détail d'année » plus lisible, cohérence des couleurs de perf
   dans la table annuelle.
4. **Profil** : déjà pilote en phase 1 ; ajouter éventuellement un résumé « âge / jalons du
   plan actif » discret.

**Fichiers.** `pages/PatrimoinePage.tsx`, `pages/FluxPage.tsx`, `pages/ProjectionPage.tsx`
+ `projection/*` (habillage), primitives UI.

**Acceptation.** Chaque page n'utilise plus que les primitives + tokens (plus de style
inline dispersé) ; regroupements/tri fonctionnels ; **aucune régression du moteur** (tests
verts) ; parcours fluide.

**Risques.** Volume de travail. Mitigation : **une page = une PR**, dans l'ordre
Patrimoine → Flux → Projection.

---

### Phase 6 — Onboarding + **mode démo complet**

**But.** Deux besoins complémentaires :
- **Onboarding** : guider un nouvel utilisateur (état vide) de zéro à une première projection.
- **Mode démo complet** : un environnement pré-rempli qui **montre toutes les fonctionnalités**
  et **explique comment utiliser l'app** — sans rien avoir à saisir, et sans écraser ses
  vraies données.

**Étapes.**
1. **Détection premier lancement** (state vide / flag `onboarded` en localStorage).
2. **Flow d'onboarding** (`components/onboarding/`) : (a) bienvenue + promesse + choix
   « Commencer de zéro » ou « Explorer la démo » ; (b) profil (prénom + naissance) ;
   (c) « ajoute un premier actif » avec les **presets** de la phase 2 ; (d) « un revenu /
   une dépense » ; (e) « voici ta première projection » → dépose sur le Dashboard.
   Skippable, reprenable.
3. **Mode démo (sandboxé, non destructif)** :
   - `lib/demo.ts` = un **`AppState` d'exemple complet** (persona, ex. « Camille, 34 ans ») :
     tous les types d'actifs (RP + locatif, compte, liquidités, Livret A + PEA + assurance-vie,
     véhicule), passifs (emprunt immo + auto), revenus/dépenses, **un plan** avec jalons
     (Retraite, Achat maison) et **les 6 types d'événements**, hypothèses + `fiTarget`.
   - Entrer en démo **sauvegarde les vraies données sous une clé de backup** et charge le
     persona ; **bandeau « Mode démo »** persistant avec « Quitter la démo » → restaure.
   - La démo doit passer par `loadState()`/migrations (mêmes garanties que l'import).
4. **Visite guidée** (`Tour.tsx`) : surbrillance + bulles pas-à-pas sur chaque page et
   chaque concept clé (croissance capitalisée vs revenu distribué, encaissé vs latent,
   cascade surplus/retrait, jalons/dates relatives, plans). Déclenchable depuis la démo ou
   à la demande (« ? »).
5. **Micro-guidage persistant** : tooltips/`?` contextuels sur les concepts, au-delà du tour.

**Fichiers.** `components/onboarding/*` (new : `OnboardingFlow`, `steps/*`, `Tour`,
`DemoBanner`), `lib/demo.ts` (new), `store.tsx` (flag + backup/restore démo), Dashboard
(CTA d'état vide + accès démo).

**Acceptation.** Un localStorage vide déclenche l'onboarding ; à la fin, l'utilisateur a un
profil + ≥1 actif + une projection. La **démo** peuple un patrimoine complet, la visite
guidée couvre toutes les pages, et **quitter la démo restaure exactement** les vraies
données (test round-trip backup/restore).

**Risques.** Moyen (sandboxing des données). Mitigation : backup/restore testé, démo en
lecture d'un `AppState` figé qui passe par `loadState()`.

---

### Phase 7 — Graphes : polish (SVG maison)

**But.** Élever la data-viz sans perdre l'âme « SVG maison ». **Décidé : on reste SVG maison**
(cohérence, zéro dépendance, contrôle total) et on le **polit**.

**Étapes.** Extraire des helpers de graphe partagés (`chartUtils.ts` étoffé) ; tooltips
unifiés ; grille et axes plus lisibles ; légendes des glyphes ; transitions d'entrée ;
cohérence des couleurs (phase 3) sur tous les graphes (NetWorth, Compare, Fan, Sankey) ;
responsive des SVG (`viewBox` + conteneur `overflow-x` si besoin).

**Fichiers.** `projection/{NetWorthChart,CompareChart,MonteCarloView,chartUtils}.tsx`,
`components/SankeyChart.tsx`, `styles/charts.css`.

**Acceptation.** Tous les graphes partagent un langage visuel (couleurs, tooltips, axes) ;
lisibles sur petit écran ; **aucune dépendance ajoutée**.

**Risques.** Faible.

---

### Phase 8 — Responsive · accessibilité · finitions

**But.** Passage final qualité.

**Étapes.** Sidebar repliable / nav mobile ; grilles et modales responsive ; focus states &
navigation clavier sur toutes les primitives ; `aria-*` sur modales/segments/tooltips ;
respect `prefers-reduced-motion` ; états vides et d'erreur soignés partout ; passe de copie
FR cohérente ; contrôle des contrastes (perf colors incluses) ; **feuille de style `print`**
pour un export papier propre du Dashboard/projection (bonus « pro », zéro dépendance).

**Acceptation.** Utilisable au clavier ; correct de ~360px à desktop ; `prefers-reduced-motion`
respecté ; pas d'état vide « nu » ; impression lisible.

**Risques.** Faible.

---

## 5. Fil rouge : dépendances entre phases

```
0 ── 1 ──┬── 2 ── 3 ──┬── 4 ──┐
         │            │       ├── 6
         │            └── 5 ──┤
         └──────────── 7 ─────┴── 8
```
Chemin critique : **0 → 1 → 2 → 3**. 4/5 parallélisables une fois 3 fait. 6 après 4+5.
7 peut avancer dès que 3 et une page « projection » habillée existent. 8 en dernier.

---

## 6. Stratégie de tests & migration (transverse, non négociable)

- **Invariants moteur = loi.** À chaque phase touchant `lib/`, `npm test` doit rester vert
  (colonne patrimoine = net, pont début+enrichissement, neutralité des transferts, plafonds,
  6 événements + ordre, jalons, inflation/euros constants, 1re année partielle, Monte Carlo
  seedé, migrations).
- **Toute évolution de forme du modèle** (phase 2 surtout) ⇒ une **migration** dans
  `loadState()` **+** un cas dans `store.test.ts` chargeant un ancien blob et vérifiant la
  forme migrée.
- **Nouvelles primitives UI** : pas de tests unitaires lourds requis (perso), mais garder
  `npm run build` (tsc strict) vert comme filet.
- **Export/import** (phase 0) et **backup/restore démo** (phase 6) : tests round-trip
  (état → export/backup → import/restore → état identique).

---

## 7. Deep-dive — Taxonomie d'actifs (spec de la phase 2)

### 7.1 Décision de modèle — **A confirmée** (B abandonné)

- **Décision A — sur-ensemble unifié (RETENUE).** On garde **une** interface `Asset`
  (comme aujourd'hui) ; on fait évoluer `AssetCategory`, on ajoute quelques champs
  **optionnels** (ex. `rented?`), et on pilote **l'UX** (champs visibles, presets, aides,
  couleur) par le **registre `lib/assets.ts`**. Le moteur ne bouge quasi pas (il lit
  toujours les mêmes champs comportementaux). **Risque minimal, valeur maximale.**
- ~~Décision B — union discriminée par type~~ → **abandonnée** (réécriture moteur/sélecteurs/
  migration lourde, coût >> bénéfice pour un outil perso).

### 7.2 Types d'actifs cibles (validés)

Chaque catégorie = une entrée du registre `assets.ts`. La finesse (Livret A vs PEA vs
assurance-vie…) est portée par les **presets**, pas par des catégories séparées — conforme à
ta réponse : « placement et livret, c'est la même chose ».

| Catégorie (`id`) | Libellé | Champs mis en avant | Presets | Versements ? |
|---|---|---|---|---|
| `immobilier` | Immobilier | valeur, `growthRate` (appréciation), charges, plancher ; **flag `rented`** → + revenu (loyer, mode `amount`/`rate`) | Résidence principale (`rented=false`), Locatif (`rented=true`) | non |
| `compte_courant` | Compte courant | valeur, ~0 growth | Compte chèque | **oui** |
| `liquidites` | Liquidités (cash) | valeur, 0 growth | Espèces | non |
| `epargne` | Épargne & placements | valeur, `growthRate` (capitalisé), **volatilité** (opt.), revenu/dividendes (opt.), `depositCap` (opt.) | Livret A (22 950 €), LDDS (12 000 €), PEL, PEA (150 000 €), CTO, Assurance-vie, PER, ETF/Actions | **oui** |
| `vehicule` | Véhicule | valeur, `growthRate` (souvent **négatif**), **plancher** | Voiture (−15 %/an) | non |
| `autre` | Autre | libre | — | opt. |

**Décisions figées (tes réponses §9) :**
- **Immobilier = un seul type** avec **flag `rented`** (bascule loué/non loué facile). Pas de
  catégorie `immobilier_locatif`.
- **`epargne` fusionne** `livret_epargne` + `placement`. Livret A, PEA, CTO, assurance-vie,
  PER, ETF… = **presets** de cette catégorie (rate/volatilité/plafond pré-remplis, éditables).
- La distinction visible « livret tranquille vs actions » est portée par le **preset** (taux,
  volatilité) et par le **langage couleur de perf** (§8), pas par une catégorie dédiée.

### 7.3 Migration (ancien → nouveau)

- `livret_epargne` → **`epargne`**.
- `placement` → **`epargne`**.
- `compte_courant`, `immobilier`, `vehicule`, `autre` : **inchangés** (`rented` absent = `false`).
- `liquidites` : **nouveau**, aucun ancien à mapper.
- Aucun champ supprimé : les nouveaux champs sont **optionnels** ⇒ migration = simple remap
  de `category` (+ `rented=false` par défaut) ; on **n'écrase jamais** une saisie utilisateur
  (les presets ne s'appliquent qu'à la création, pas en migration).
- Mettre à jour `DEPOSIT_ELIGIBLE` = `["compte_courant", "epargne"]` et `canReceiveDeposits()`.
- Test `store.test.ts` : ancien blob avec `placement`/`livret_epargne` → vérifie `epargne`
  + éligibilité dépôts conservée + `depositCap` préservé.

### 7.4 Registre `lib/assets.ts` (forme proposée)

```ts
type AssetFieldKey =
  | "value" | "growth" | "volatility" | "income" | "charges" | "floor" | "deposits" | "rented";

interface AssetPreset {
  label: string;             // "Livret A", "PEA", "Locatif"…
  patch: Partial<Asset>;     // growthRate, volatility, depositCap, incomeMode, rented…
  hint?: string;
}

interface AssetType {
  id: AssetCategory;
  label: string;
  icon: React.FC<{ size?: number }>;
  accent: string;            // couleur de base du type (token)
  fields: AssetFieldKey[];   // quels blocs afficher dans la modale (le flag `rented` révèle `income`)
  canDeposit: boolean;
  presets: AssetPreset[];    // pré-remplissages en un clic (la finesse produit vit ici)
  help: string;
}
// Source unique consommée par PatrimoinePage, EventModal(buy), Dashboard, couleurs.
```

---

## 8. Deep-dive — Langage couleur de performance (spec de la phase 3)

### 8.1 Métrique

Rendement total annuel d'un actif (déjà dérivable) :
```
perf% ≈ growthRate  +  (revenuDistribué − charges) / valeur
```
- `growthRate` = plus/moins-value latente (capitalisée).
- `(revenu − charges)/valeur` = rendement distribué net (`assetYearlyNet` existe déjà).
- Helper `assetPerformance(a)` dans `selectors.ts` renvoie `{ pct, latent, cash, net€ }`.

### 8.2 Échelle couleur

- Divergente : **`--drain`** (négatif) → **neutre ivoire** (≈0) → **`--gain`** (positif),
  avec 2–3 paliers d'intensité selon l'amplitude. Dérivée des tokens existants (pas de
  nouvelle palette criarde) pour rester cohérente avec la direction de design (§12).
- Un actif qui **coûte** (charges > revenu, ou dépréciation) penche `drain` ; un actif
  **productif** penche `gain` ; un actif **dormant** (cash 0 %) reste neutre.

### 8.3 Règles d'usage

- **Jamais la couleur seule** : toujours + signe (↗/↘, +/−) + valeur chiffrée.
- Un seul accent de perf par ligne (le point/barre à gauche + la valeur à droite).
- Applications : liste actifs, tri « par rendement », donut du Dashboard, table de projection.
- Contraste AA ; lisible désaturé (test niveaux de gris).

---

## 9. Décisions prises (réponses aux questions ouvertes)

Historique conservé — question → **ta réponse** → décision appliquée dans le plan.

1. **Modèle A vs B** — « on part sur A, oublie B » →
   **A retenue**, B supprimé (§7.1).
2. **Locatif = catégorie ou flag ?** — « tous les biens immobiliers du même type, les loués
   ont un flag `rented`, pour switcher facilement loué/non loué » →
   **flag `rented` sur `immobilier`** (§7.2).
3. **assurance_vie / PER = catégories ou presets ?** — « presets, tout comme le PEA, le CTO,
   le Livret A… » →
   **presets** de la catégorie `epargne` (§7.2).
4. **placement vs livret** — « placement et livret, c'est la même chose » →
   **fusion en `epargne`** (§7.2, §7.3).
5. **Langue** — « 100 % FR pour l'instant » → **FR only**, i18n non prévu.
6. **Graphes** — « SVG poli pour le moment » → **SVG maison poli**, pas de lib (Phase 7).
7. **Routeur** — « oui ajoute un routeur » → **`react-router-dom`** (Phase 0).
8. **Onboarding** — « oui, un mode démo complet qui montre toutes les fonctionnalités et
   explique comment utiliser l'app » → **Phase 6 étendue** (démo sandboxée + visite guidée).
9. **Thème** — « ouvert à un rafraîchissement si tu as des idées originales » →
   **§12 propose 3 directions**, appliquées au niveau tokens en Phase 1.
10. **Ordre / rythme** — « pas d'urgence, progressivement, garde un tracking de ce qui est
    fait/à faire pour ne pas se perdre entre sessions » → **§11 Suivi d'avancement** +
    ordre par dépendances (pas de Dashboard forcé en avance).

---

## 10. Jalons suggérés (regroupement en livrables démontrables)

| Milestone | Contenu | Résultat visible |
|---|---|---|
| **M1 — Fondations** | Phases 0 + 1 | Nav par URL, sauvegarde JSON, design system + primitives (Profil pilote), `MoneyInput`. Iso-visuel ailleurs. |
| **M2 — Actifs & couleurs** | Phases 2 + 3 | Types d'actifs, presets, flag loué, formulaires adaptés, perf colorée. **Le cœur de ta demande.** |
| **M3 — Parcours** | Phases 4 + 5 | Dashboard d'accueil + toutes les pages refondues. App « qui se tient ». |
| **M4 — Accueil & finition** | Phases 6 + 7 + 8 | Onboarding + mode démo complet, graphes polis, responsive/a11y, print. Prête à l'usage quotidien. |

---

## 11. Suivi d'avancement (SOURCE DE VÉRITÉ — à mettre à jour chaque session)

Légende : ⬜ à faire · 🟡 en cours · ✅ fait · ⏸️ en pause/bloqué.

**Reprise rapide**
- **Dernière session :** ✅ **Phase 4 (Dashboard / 00 — Accueil)**. Nouvelle route `/` =
  `DashboardPage` (l'app ouvre dessus) ; nav sidebar « 00 Accueil » (numérotation 0-indexée
  → aligne Profil 01 … Projection 04). Blocs cliquables vers leur page : hero patrimoine,
  **trajectoire** (net à +1/+5/+10 ans via une passe moteur mémoïsée), **flux mensuels** +
  taux d'épargne, **répartition** des actifs (barres teintées par la perf), **à venir**
  (prochain jalon / événement). État vide → CTA « Commence par ton patrimoine ». Build +
  **127 tests** verts, boot OK.
- **Prochaine étape :** Phases 5 + 7 **terminées**. Restent : **Phase 6 — Onboarding + mode
  démo** (sautée pour l'instant) et **Phase 8 — Responsive · a11y · finitions** (dont
  `prefers-reduced-motion` à câbler pour les transitions de graphes ajoutées en phase 7).
- **Branche en cours :** `main`. Committé jusqu'à `9586971 phase 5 - flux 2`. **Projection
  (habillage) en working tree, pas encore committé.** Lien actif↔emprunt **abandonné**.

**État par phase**

| Phase | Statut | Notes |
|---|---|---|
| 0 — Socle (routeur, export/import, garde-fous) | ✅ | `react-router-dom` (BrowserRouter) ; `routes.tsx` ; `migrateState`/`serializeState`/`importState` ; contrôles données + indicateur « Enregistré » en sidebar ; vue Projection portée par `/projection/:vue`. |
| 1 — Design system (tokens, primitives, `MoneyInput`, Profil pilote) | ✅ (structurel) | `styles/{tokens,base,primitives,layout,charts}.css` (split contigu iso-visuel) ; `ui/{Button,Input,MoneyInput,Field,Select,Segment,Card,Tag}` + barrel ; Profil migré. **Reste optionnel :** `Stat`/`Tooltip`/`Row` + déplacer `Modal`→`ui/` (différés en phase 5, avec vrais consommateurs) ; rafraîchissement de palette §12 (non appliqué, on est resté iso-visuel). |
| 2 — Taxonomie d'actifs (`epargne`, `liquidites`, flag `rented`, presets, migration) | ✅ | Catégories : `immobilier`(+`rented`), `epargne`(fusion), `compte_courant`, `liquidites`, `vehicule`, `autre`. `lib/assets.ts` (registre : label/icône/accent/champs/presets/`defaultVolatility`/`normalizeAsset`). Migration `livret_epargne`+`placement`→`epargne`. Invariant testé : bloc UI « deposits » ⇔ `DEPOSIT_ELIGIBLE`. **Reste optionnel :** EventModal(buy) garde un mini-formulaire d'actif (pas les presets) → parité en phase 5. |
| 3 — Couleur de performance | ✅ | Métrique `assetPerformance()` {pct, latent/cash pct+€, netEur} ; tokens `--perf-*` divergents 3 paliers (`color-mix` sur `--gain`/`--drain`) ; `ui/PerformanceBadge` (+ `perfColor`) ; liste Patrimoine : barre d'accent + badge (flèche+signe+chiffre, jamais couleur seule) + tri Ordre/Rendement/Valeur. **Sparkline retirée** (inutile sans échelle). **Reste optionnel :** hero patrimoine, table de projection, donut Dashboard → phases 4/5/7. |
| 4 — Dashboard | ✅ | Route `/` = `DashboardPage` (atterrissage) ; nav « 00 Accueil » (numérotation 0-indexée). Blocs cliquables : hero net/brut/passifs, trajectoire +1/+5/+10 ans (moteur mémoïsé 1 passe), flux mensuels + taux d'épargne, répartition (barres teintées perf), prochain jalon/événement, CTA état vide. **Pas de mini-courbe** (choix : chiffres d'horizon labellisés plutôt qu'un graphe sans échelle — cf. retour Sparkline). |
| 5 — Refonte pages (Patrimoine → Flux → Projection) | ✅ | **Projection FAIT** (habillage, moteur/4 vues intacts) : header horizons + onglets de vue + mode du graphe → `Segment` ; purge styles inline → utilitaires `.txt-*` + variante `.fi-banner.warn` + `.proj-net`. Légende des glyphes & panneau d'hypothèses (`.assum`) **déjà présents**. **Optionnel restant :** titre sur le panneau hypothèses, relecture modale « détail d'année », styles inline structurels (padding/width) non purgés (non sémantiques). **Flux** (compta inchangée) : purge styles inline → utilitaires `.txt-*`/`.tag-brass` ; toggles + select via `Segment`/`Select` ; hiérarchie sous-groupes (totaux alignés à droite + séparateurs) ; **onglets Tout/Entrants/Sortants**. **Patrimoine** : familles (`ASSET_FAMILIES`/`assetFamily` → Immobilier / Épargne & liquidités / Autres) ; liste **groupée par famille** + sous-totaux (valeur, net/an, **badge de rentabilité agrégée**) ; tri Valeur/Rendement/Nom ; `AssetRow`. **Overview page** : 2 camemberts (`ui/Donut` SVG interactif) Actifs + Passifs, **survol bidirectionnel** donut↔légende (grossit + s'illumine), **palette catégorielle** `--cat-1..5` (hues distincts). **Onglets** Tout/Immobilier/Épargne/Autres/**Passifs** pilotant les 2 sections. **Perf par actif clarifiée** : badge % à côté du nom, meta = croissance €/revenu €/charges €, chiffre à droite = **gain total/an €** (cohérent avec le %). Build + 129 tests verts. **Reste :** lien visuel actif↔emprunt, purge styles inline ; puis **Flux**, **Projection**. |
| 6 — Onboarding + mode démo complet | ⬜ | `lib/demo.ts` + backup/restore |
| 7 — Graphes (SVG poli) | ✅ | **Palette catégorielle validée (CVD ΔE 13,4) + unifiée** (`--cat-1..5`, `SERIES_COLORS` alignées) via `validate_palette.js`. **Composition** : Épargne passée en or (levait 2 verts trop proches). **Tooltips unifiés** : les 3 graphes partageaient déjà `.chart-tip*` ; ajout pastille d'identité + texte en encre (série / P90-P10), plus de texte coloré. **Transitions d'entrée** : path-draw des courbes + fondu des aires (NetWorth, Compare). **Responsive** : `min-width` + `overflow-x` sur `.chart-wrap`/`.sankey-wrap`, légende `flex-wrap`. Sankey relu (couleurs sémantiques cohérentes). |
| 8 — Responsive · a11y · print | ⬜ | — |

**Décisions prises en cours de route** (à compléter au fil de l'eau)
- **Horizon de projection = GLOBAL** (`settings.horizon`), pas par plan : c'est une préférence
  de vue (les plans se comparent sur le même horizon). `ProjectionPage` fusionne
  `{ ...plan.projection, horizon: settings.horizon }`. Migration : hissé depuis le plan actif.
- **Vue de projection conservée au changement de plan** : `Sidebar.selectPlan/addPlan` ne
  navigue vers `/projection` que si on n'y est pas déjà (sinon la vue courante — portée par
  l'URL `/projection/:vue` — est préservée).
- **Modales portées vers `document.body`** (`createPortal`). Un ancêtre avec
  `backdrop-filter`/`transform` (ex. sidebar) devient le bloc conteneur d'un `position: fixed`
  et enferme la modale. Ne pas rendre de scrim plein écran sous un tel ancêtre sans portail.
- **Pas de page pour un réglage simple.** Nom/date de naissance + inflation par défaut vivent
  dans le panneau **Paramètres** (modale, ouverte depuis la sidebar), pas une page dédiée.
  L'inflation par défaut (`settings.defaultInflation`) alimente la trajectoire de l'Accueil.
- **Accueil = trajectoire de BASE, sans plan.** Les plans sont **hypothétiques** et vivent sur
  la page Projection. Le Dashboard projette les finances courantes sans événements/jalons ni
  hypothèses de plan (`DEFAULT_PROJECTION`), et « À venir » ne liste que des faits de base (flux
  datés, emprunts soldés). Ne jamais réintroduire `plan.*` dans `DashboardPage`.
- **⚠️ Perf de scroll (macOS) — 2 pièges à bannir :** (1) `backdrop-filter: blur` sur un
  overlay derrière un conteneur qui scrolle (ex. `.scrim` de la modale) → re-rasterisation
  plein écran par frame ; retiré, remplacé par un assombrissement opaque. (2)
  `background-attachment: fixed` → repeint le fond à chaque frame ; remplacé par un calque
  `body::before { position: fixed }` (même rendu, composité une fois). **Ne pas réintroduire
  ces deux patterns** dans les phases design/responsive.
- **Accents de catégorie = identité neutre, jamais perf.** Un actif d'une catégorie « à
  risque » n'est pas mauvais par nature (voiture de collection qui s'apprécie, immo qui se
  déprécie). `--gain`/`--drain` sont réservés au **langage de performance par actif** (phase 3).
- **`normalizeAsset` à l'enregistrement** : garantit que le moteur ne voit pas de champ
  caché (loyer d'un immo « non loué », croissance d'un compte courant…). Invariant testé.
- **Routeur = `BrowserRouter`** (URLs propres `/patrimoine`). Vite (dev + preview) fournit
  le fallback SPA. ⚠️ Si un jour on sert le build en statique (GitHub Pages…) sans fallback,
  basculer en `HashRouter` (1 ligne dans `App.tsx`) pour éviter les 404 au refresh.
- Refactor `store.tsx` : extraction de **`migrateState(input)`** (partagée par `loadState`
  et l'import) — utile pour tester le round-trip export/import.
- Transition de page (`AnimatePresence`) **clée sur le 1er segment d'URL** : changer d'onglet
  dans Projection ne rejoue pas la transition de page.

**Journal de session** (dernière en haut)
- **2026-07-21 — Phase 7 · Graphes (SVG poli).** Palette `--cat-1..5` reréglée et **validée**
  (skill dataviz `validate_palette.js` : CVD pire paire ΔE 13,4 ≥ 12, chroma + contraste OK ;
  lightness hors bande = choix marque documenté) ; `SERIES_COLORS` (comparaison de plans)
  alignées sur `--cat-*`. Composition : Épargne en or (`--brass`) pour séparer des Actifs
  (sage) — 2 verts trop proches. Tooltips : déjà classes `.chart-tip*` communes ; ajout
  `.tip-dot` (pastille) + texte en encre pour série/P90/P10 (skill : identité par la couleur
  d'une pastille, pas du texte). Transitions d'entrée : `motion.path` path-draw des courbes +
  fondu des aires/bandes (NetWorth, Compare). Responsive : `.chart-svg { min-width: 520px }` +
  `.chart-wrap`/`.sankey-wrap { overflow-x: auto }` + légende `flex-wrap`. Build + 130 verts.
- **2026-07-21 — Phase 5 · Patrimoine.** Familles d'actifs + liste groupée + sous-totaux
  (valeur/net/badge de rentabilité agrégée) ; tri Valeur/Rendement/Nom ; `AssetRow`. Overview
  page : 2 camemberts `ui/Donut` (SVG interactif, contrôlé via `activeIndex`) Actifs/Passifs,
  survol **bidirectionnel** donut↔légende (part grossit `GROW` + s'éclaircit, rayon réduit
  pour ne pas rogner ; ligne de légende active surlignée). Palette catégorielle `--cat-1..5`
  (contraste — sage/ink-mute/drain-deep étaient trop proches). Onglets Tout/…/**Passifs**
  pilotant les deux sections. **Perf actif — retour utilisateur :** le badge total incluait la
  croissance mais le € ne montrait que le cash (piège immo ; PEA « pas de revenu » malgré
  +7 %). Choix (option minimale) : croissance en € ajoutée dans la meta, puis **chiffre de
  droite = gain TOTAL/an** (`perf.netEur`), badge % déplacé **à côté du nom**. Build + 129 verts.
- **2026-07-21 — Paramètres + suppression page Profil (hors-phase, retour utilisateur).**
  Page Profil supprimée (overkill pour nom + date) : route `profil` retirée
  (`routes.tsx`/`App.tsx`), `pages/ProfilPage.tsx` supprimé, eyebrows renumérotés
  (Patrimoine 01, Flux 02, Projection 03 ; nav 0-indexée avec Accueil 00). Nouveau panneau
  **Paramètres** (`components/SettingsModal.tsx`) ouvert depuis le bloc profil de la sidebar
  (devenu bouton + `IconSettings`) : édite nom, date de naissance ET **inflation par défaut**.
  Modèle : `AppSettings { defaultInflation }` + `AppState.settings` + `DEFAULT_SETTINGS`
  (= `DEFAULT_PROJECTION.inflation`, 2 %) ; migration store backfill (settings absents/partiels)
  + 2 tests. **`DashboardPage`** utilise `state.settings.defaultInflation` pour la trajectoire
  de base. **Fix modale (important) :** `Modal` est désormais **porté vers `document.body`**
  (`createPortal`) — sinon le `backdrop-filter` de la sidebar en faisait le bloc conteneur du
  `position: fixed`, enfermant la modale en petit dans la sidebar. Corrige toutes les modales.
  Build + **129 tests** verts.
- **2026-07-21 — Phase 4 (Dashboard).** `routes.tsx` : route `accueil` (`/`) en tête,
  `DEFAULT_PATH = "/"` ; `App.tsx` : `/` → `DashboardPage` ; `Sidebar` : numérotation nav
  0-indexée (`00 Accueil` … `04 Projection`, aligne les eyebrows des pages). Nouveau
  `pages/DashboardPage.tsx` : hero (net/brut/passifs, réutilise `.wealth-hero`) + 4 cartes
  cliquables (`DashCard` → navigate) : **Trajectoire** (net à +1/+5/+10 ans), **Flux mensuels**
  (revenus/sorties/épargne + barre de taux d'épargne), **Répartition** (top 6 actifs, part du
  brut, barre teintée par `perfColor(assetPerformance)`), **À venir**. État vide → CTA vers
  Patrimoine. CSS `.dash-*` (grille 2 col. → 1 col. < 900px). **Décision (retour utilisateur) :
  l'Accueil ignore les PLANS** (hypothétiques → page Projection) → il montre la trajectoire de
  BASE : `project(simInput(state, {…plan vide}), { …DEFAULT_PROJECTION, horizon 10 })` (aucun
  événement/jalon, hypothèses par défaut) ; et « À venir » liste les changements de la base
  (flux datés en dur qui démarrent/s'arrêtent + emprunts soldés via `termMonths`), pas les
  jalons/événements de plan. `plan` n'est plus lu par la page. **Choix :** pas de mini-graphe
  (chiffres d'horizon labellisés = scalés, cohérent avec l'abandon de la Sparkline). Build + 127 verts.
- **2026-07-21 — Phase 3 (Langage couleur de perf).** `selectors.ts` : `assetPerformance(a)`
  → `{ pct, latentPct, cashPct, latentEur, cashEur, netEur }` (total = growthRate + revenu
  net/valeur, garde value=0) ; `assetValueSeries(a, years)` (compose + plancher, pour la
  Sparkline). `tokens.css` : `--perf-neutral` + `--perf-gain-1..3` / `--perf-drain-1..3`
  dérivés de `--gain`/`--drain` via `color-mix(oklab)` (sobre, 3 paliers d'amplitude).
  Primitive : `ui/PerformanceBadge` (flèche ↗/↘/→ + valeur signée, + `perfColor(pct)`
  partagé). PatrimoinePage : barre d'accent de perf à gauche (absolute, hors grille .row) +
  `PerformanceBadge` dans la meta ; tri de vue Ordre/Rendement/Valeur (Segment, ne mute pas
  le store). Tests `assetPerformance` → 127 verts. **Sparkline abandonnée** en cours de route
  (retour utilisateur : sans échelle elle n'apporte rien, et colorer une trajectoire de
  valeur par la perf TOTALE crée un contresens — RP qui s'apprécie mais coûte net → ligne
  qui monte en rouge). Helper `assetValueSeries` + primitive `Sparkline` supprimés.
  **Décision utilisateur (en parallèle) :**
  `compte_courant` **supprimé** du modèle, fusionné dans `liquidites` (migration store
  `compte_courant → liquidites`) ; `DEPOSIT_ELIGIBLE = ["epargne"]` (seule l'épargne reçoit
  les versements). Registre/tests adaptés.
- **2026-07-20 — Phase 2 (Taxonomie d'actifs).** Modèle (`types.ts`) : `AssetCategory`
  refondu (`epargne` = fusion `livret_epargne`+`placement` ; `liquidites` neuf), flag
  `rented?` sur `Asset`, `DEPOSIT_ELIGIBLE = [compte_courant, epargne]`. Registre
  `lib/assets.ts` : par catégorie → label, icône, **accent d'IDENTITÉ (neutre)**, champs
  affichés, `canDeposit`, `presets` (Livret A/LDDS/PEL/PEA/CTO/AV/PER/ETF ; RP/Locatif ;
  Voiture/Voiture de collection), `defaultVolatility`, + `normalizeAsset()` (coupe les
  champs comportementaux non exposés → pas de loyer fantôme). `AssetModal` (PatrimoinePage)
  piloté par le registre : select+presets, bascule **loué**, blocs conditionnels par
  `hasField`, normalisation à l'enregistrement. Migration store `normalizeAssets` (remap
  catégorie, plafonds préservés). Consommateurs reliés au registre : `eventHelpers`
  (`assetLabel`), `EventModal` (select achat), `MonteCarloView` (`DEFAULT_VOLATILITY`).
  Tests : `assets.test.ts` (invariants) + migration store + littéraux de test migrés →
  **125 verts**. **Correction suite retour utilisateur :** les accents de catégorie
  n'utilisent PLUS `--gain`/`--drain` (un véhicule peut s'apprécier, un immo se déprécier) ;
  `--gain`/`--drain` restent réservés à la perf réelle par actif (phase 3).
- **2026-07-20 — Phase 1 (structurel).** `index.css` (1665 l.) éclaté en 5 modules
  `styles/*` par **découpage contigu** (ranges 1–54 / 55–143 / 144–311 / 312–918 / 919–fin)
  importés dans l'ordre par `main.tsx` → cascade **identique** (concat == original vérifié
  par `diff`, et bundle Vite au même hash). Primitives `ui/` : `Button`, `Input`, `Field`,
  `Select`, `Segment`, `Card` (polymorphe via `as`), `Tag`, **`MoneyInput`** (groupage
  milliers + suffixe €, brut à l'édition), + barrel `ui/index.ts` + CSS `.money-field`.
  `ProfilPage` migré vers `Card`/`Field`/`Input` (pilote validant l'API). Build + 118 tests
  verts, boot OK. **Choix assumés :** split **contigu** (pas sémantique) pour garantir
  l'iso-visuel sans risque de cascade — une redistribution sémantique des règles pourra se
  faire plus tard derrière des contrôles visuels ; `Modal` **non** déplacé et `Stat`/`Tooltip`
  **non** créés (pas de consommateur à valider → phase 5) pour éviter du code mort.
- **2026-07-20 — Phase 0.** Ajout `react-router-dom` ; `src/routes.tsx` (métadonnées nav +
  slugs des vues de Projection) ; `App.tsx` → shell `BrowserRouter` + `<Routes>` animées ;
  `Sidebar` réécrite (hooks routeur) + **`DataControls`** (export/import/reset + indicateur
  « Enregistré ») ; `ProjectionPage` : vue portée par `/projection/:vue`. `store.tsx` :
  `migrateState` / `serializeState` / `importState`. Tests : +3 cas round-trip/tolérance
  (118 verts). CSS : bloc `.side-data*`. Build + dev OK. **Reste :** rien pour Phase 0.
  Piège rencontré : `timeout` absent sur macOS (pour lancer le dev en CI local) — sans impact.

---

## 12. Directions de design (rafraîchissement — tu es ouvert, voici 3 pistes)

Base commune : on garde l'ADN **serif éditorial (Fraunces) + grotesque (Hanken) + mono
tabulaire (Spline)** et les chiffres tabulaires. Le rafraîchissement se fait **au niveau des
tokens** (Phase 1) : les primitives héritent sans changement de code. Une seule direction à
retenir (ou un mix).

- **D1 — « Maison de patrimoine », affinée (évolution douce, recommandée pour démarrer).**
  On garde l'encre vert-forêt + laiton + ivoire, mais on **calme** : moins de dégradés
  radiaux, plus d'air, filets laiton **plus fins**, hiérarchie typographique plus tranchée,
  cartes plus mates. Risque nul, gain immédiat de « sérieux ».

- **D2 — « Parchemin » (mode clair chaud) + bascule thème.**
  Ajouter un **thème clair papier/ivoire** (fond crème, encre forêt, accents laiton) en plus
  du sombre, avec un **toggle** (et respect `prefers-color-scheme`). Original vs la plupart
  des apps finance (souvent bleu/blanc froid) : ça donne un côté « rapport annuel de banque
  privée ». Coût : discipliner les tokens pour tenir en clair **et** sombre.

- **D3 — « Éditorial / almanach » (le plus distinctif).**
  Pousser le côté magazine : grands titres Fraunces, **numérotation de sections** (déjà
  présente : « 01 — Profil »), filets et petites capitales, graphes traités comme des
  **planches** avec légendes éditoriales. Les chiffres deviennent le héros. Plus ambitieux,
  très identitaire, mais demande plus de soin de mise en page (Phase 5/7).

> Reco : **démarrer en D1** (sans risque) en Phase 1, garder **D2 (thème clair)** comme
> option activable plus tard, et piocher des éléments **D3** dans le Dashboard (Phase 4) et
> les graphes (Phase 7) là où ça brille. À trancher au moment de la Phase 1.

---

## 13. Idées additionnelles (optionnelles, low-risk, « just good to use »)

Non engageantes — à piocher si l'envie vient. Aucune ne viole les non-objectifs (local, pas
de feature « complexe » type fiscalité/foyer/banque/société).

- **Saisie monétaire soignée** (`MoneyInput`, déjà dans Phase 1) : séparateurs de milliers,
  `€`, pas de zéro fantôme. Petit détail, gros confort. **Recommandé.**
- **Undo / Redo** léger sur l'état (pile d'historique en mémoire + raccourcis ⌘Z/⌘⇧Z).
  Filet de sécurité à l'édition. Se glisse dans le store (Phase 1). **Recommandé.**
- **Palette de commandes** (⌘K) : aller à une page, ajouter un actif, changer de plan,
  lancer la démo. Très « pro », faible coût. (Phase 8.)
- **Panneau « Santé du plan »** : regrouper joliment les warnings du moteur (épargne
  négative, jalon orphelin, plafond dépassé…) déjà émis — aujourd'hui en bannière. (Phase 5.)
- **Duplication rapide d'un actif / d'un événement** (bouton « dupliquer »). (Phase 5.)
- **Feuille `print`** pour sortir un PDF propre du Dashboard (déjà notée en Phase 8).
- **Raccourcis clavier** de base (échap ferme les modales — déjà ? à vérifier ; `n` = nouveau).

---

### Prochaine étape

Le plan intègre toutes tes réponses. Quand tu veux, on démarre **Phase 0** (socle invisible,
zéro risque : routeur + export/import JSON) — puis on enchaîne phase par phase, chacune
buildant + testée, en tenant le **§11** à jour pour ne rien perdre entre les sessions.

Reste 1 micro-choix quand on attaquera la Phase 1 : la **direction de design (§12)** — mais
rien ne presse, D1 est le défaut sans risque.
