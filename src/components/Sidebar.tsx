import { useStore } from "../lib/store";
import { netWealth } from "../lib/selectors";
import { ageFrom, money } from "../lib/format";

export type RouteId = "profil" | "patrimoine" | "flux" | "projection";

export const ROUTES: { id: RouteId; label: string; soon?: boolean }[] = [
  { id: "profil", label: "Profil" },
  { id: "patrimoine", label: "Patrimoine" },
  { id: "flux", label: "Flux", soon: true },
  { id: "projection", label: "Projection", soon: true },
];

export default function Sidebar({
  active,
  onNavigate,
}: {
  active: RouteId;
  onNavigate: (r: RouteId) => void;
}) {
  const { state } = useStore();
  const net = netWealth(state);
  const name = state.profile.firstName.trim();
  const age = ageFrom(state.profile.birthDate);

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
