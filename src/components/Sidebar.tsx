import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { downloadStateJson, migrateState } from "../lib/persistence";
import { useStore } from "../lib/useStore";
import { DEFAULT_PLAN, type Plan } from "../lib/types";
import { netWealth } from "../lib/selectors";
import { ageFrom, money, uid } from "../lib/format";
import { ROUTES } from "../routes";
import { IconPlus, IconSettings } from "./icons";
import SettingsModal from "./SettingsModal";

export default function Sidebar() {
  const { state, update } = useStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const net = netWealth(state);
  const name = state.profile.firstName.trim();
  const age = ageFrom(state.profile.birthDate);

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");
  const onProjection = isActive("/projection");

  const selectPlan = (id: string) => {
    update({ activePlanId: id });
    // déjà sur la Projection → on garde la vue courante (Événements, Cash-flow…) ;
    // sinon on ouvre la Projection (vue par défaut).
    if (!onProjection) navigate("/projection");
  };

  // nouveau plan = plan VIDE (hypothèses par défaut, ni jalons ni événements propres).
  // Les jalons sont GLOBAUX : le plan hérite de ceux de la racine (dont « Espérance de vie »
  // au premier lancement). Pour repartir d'un plan existant, utiliser « Dupliquer ».
  const addPlan = () => {
    update((s) => {
      const plan: Plan = { ...structuredClone(DEFAULT_PLAN), id: uid(), name: `Plan ${s.plans.length + 1}` };
      return { ...s, plans: [...s.plans, plan], activePlanId: plan.id };
    });
    if (!onProjection) navigate("/projection");
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">p</div>
        <div className="brand-name">
          person<b>aly</b>
        </div>
      </div>

      <nav className="nav">
        {ROUTES.map((r, i) => (
          <button
            key={r.id}
            className="nav-item"
            data-active={isActive(r.path)}
            onClick={() => navigate(r.path)}
          >
            <span className="nav-idx">{String(i).padStart(2, "0")}</span>
            <span className="nav-label">{r.label}</span>
            {r.soon && <span className="nav-soon">bientôt</span>}
          </button>
        ))}

        {/* plans de simulation — les finances courantes au-dessus ne bougent jamais */}
        <div className="side-plans">
          <div className="eyebrow">Plans</div>
          {state.plans.map((pl) => (
            <button
              key={pl.id}
              className="plan-item"
              data-active={pl.id === state.activePlanId && onProjection}
              data-current={pl.id === state.activePlanId}
              onClick={() => selectPlan(pl.id)}
              title={`Ouvrir « ${pl.name} »`}
            >
              <span className="plan-dot" />
              <span className="plan-name">{pl.name}</span>
            </button>
          ))}
          <button className="plan-item plan-add" onClick={addPlan}>
            <IconPlus size={13} /> Nouveau plan
          </button>
        </div>
      </nav>

      <div className="side-foot">
        <div className="eyebrow">Patrimoine net</div>
        <div className="net" style={{ color: net < 0 ? "var(--drain)" : "var(--ink)" }}>
          {money(net)}
        </div>
        <button className="who" onClick={() => setSettingsOpen(true)} title="Paramètres">
          <div className="avatar">{name ? name[0].toUpperCase() : "?"}</div>
          <div className="who-name">
            {name || "Profil à compléter"}
            {age !== null && <span style={{ color: "var(--ink-faint)" }}> · {age} ans</span>}
          </div>
          <IconSettings size={16} />
        </button>
        <DataControls />
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </aside>
  );
}

/** Sauvegarde locale : export/import JSON + réinitialisation + indicateur d'enregistrement. */
function DataControls() {
  const { state, importState, reset } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);

  // indicateur « Enregistré » : il écoute `state` (le CHANGEMENT), pas l'écriture
  // effective — que le store DIFFÈRE de ~300 ms (regroupement des frappes) et garantit
  // à la fermeture de l'onglet. Acceptable : l'écart est imperceptible et le sens pour
  // l'utilisateur est « c'est pris en compte », pas « l'octet est sur le disque ».
  const [flash, setFlash] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1400);
    return () => clearTimeout(t);
  }, [state]);

  const exportJSON = () => downloadStateJson(state); // logique partagée avec la page de secours (ErrorBoundary)

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de re-sélectionner le même fichier
    if (!file) return;
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      window.alert("Fichier invalide : ce n'est pas un JSON lisible.");
      return;
    }
    // validation À BLANC avant de demander confirmation : un fichier inexploitable (pas un
    // objet, version plus récente de l'app) est refusé avec son motif, les données restent.
    try {
      migrateState(parsed);
    } catch (err) {
      window.alert(`Import refusé : ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (!window.confirm("Remplacer TOUTES tes données actuelles par le contenu de ce fichier ?")) return;
    try {
      importState(text);
    } catch (err) {
      window.alert(`Import refusé : ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onReset = () => {
    if (!window.confirm("Effacer toutes tes données et repartir de zéro ? Cette action est irréversible.")) return;
    reset();
  };

  return (
    <div className="side-data">
      <div className="side-data-status">
        <span className="side-data-dot" data-on={flash} />
        {flash ? "Enregistré" : "Sauvegarde locale auto"}
      </div>
      <div className="side-data-actions">
        <button className="side-data-btn" onClick={exportJSON} title="Télécharger une sauvegarde JSON">
          Exporter
        </button>
        <button className="side-data-btn" onClick={() => fileRef.current?.click()} title="Restaurer depuis un fichier JSON">
          Importer
        </button>
        <button className="side-data-btn danger" onClick={onReset} title="Effacer toutes les données">
          Réinitialiser
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={onImportFile}
      />
    </div>
  );
}
