import { useStore } from "../lib/store";
import { netWealth } from "../lib/selectors";
import { ageFrom, money, uid } from "../lib/format";
import { IconPlus } from "./icons";

export type RouteId = "profil" | "patrimoine" | "flux" | "projection";

export const ROUTES: { id: RouteId; label: string; soon?: boolean }[] = [
  { id: "profil", label: "Profil" },
  { id: "patrimoine", label: "Patrimoine" },
  { id: "flux", label: "Flux" },
  { id: "projection", label: "Projection" },
];

export default function Sidebar({
  active,
  onNavigate,
}: {
  active: RouteId;
  onNavigate: (r: RouteId) => void;
}) {
  const { state, update } = useStore();
  const net = netWealth(state);
  const name = state.profile.firstName.trim();
  const age = ageFrom(state.profile.birthDate);

  const selectPlan = (id: string) => {
    update({ activePlanId: id });
    onNavigate("projection");
  };

  // nouveau plan = DUPLICATION du plan actif (jalons copiés avec les mêmes ids :
  // les ancrages des flux se résolvent aussi dans le nouveau plan)
  const addPlan = () => {
    update((s) => {
      const src = s.plans.find((pl) => pl.id === s.activePlanId) ?? s.plans[0];
      const copy = {
        ...structuredClone(src),
        id: uid(),
        name: `Plan ${s.plans.length + 1}`,
      };
      return { ...s, plans: [...s.plans, copy], activePlanId: copy.id };
    });
    onNavigate("projection");
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
            data-active={active === r.id}
            onClick={() => onNavigate(r.id)}
          >
            <span className="nav-idx">{String(i + 1).padStart(2, "0")}</span>
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
              data-active={pl.id === state.activePlanId && active === "projection"}
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
        <div className="who">
          <div className="avatar">{name ? name[0].toUpperCase() : "?"}</div>
          <div>
            {name || "Profil à compléter"}
            {age !== null && <span style={{ color: "var(--ink-faint)" }}> · {age} ans</span>}
          </div>
        </div>
      </div>
    </aside>
  );
}
