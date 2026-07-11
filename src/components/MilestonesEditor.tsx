import { motion } from "motion/react";
import type { Milestone } from "../lib/types";
import { uid } from "../lib/format";
import { IconPlus, IconTrash } from "./icons";

/** Suggestions de jalons courants : année proposée d'après l'âge (si connu). */
const SUGGESTIONS: { label: string; atAge: number }[] = [
  { label: "Retraite", atAge: 64 },
  { label: "Espérance de vie", atAge: 85 },
];

/**
 * Éditeur des jalons DU PLAN ACTIF : chaque plan a les siens (copiés à la
 * création du plan, mêmes ids — un « plan retraite à 60 » ne déplace que sa
 * propre Retraite). Les flux et événements ancrés dessus suivent.
 */
export default function MilestonesEditor({ milestones, birthYear, onChange }: {
  milestones: Milestone[];
  birthYear: number | null;
  onChange: (ms: Milestone[]) => void;
}) {
  const currentYear = new Date().getFullYear();

  const setMilestone = (id: string, patch: Partial<Milestone>) =>
    onChange(milestones.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const addMilestone = (label = "", atAge?: number) =>
    onChange([
      ...milestones,
      { id: uid(), label, year: birthYear && atAge ? birthYear + atAge : currentYear + 10 },
    ]);
  const delMilestone = (id: string) => onChange(milestones.filter((m) => m.id !== id));

  const missingSuggestions = SUGGESTIONS.filter(
    (sg) => !milestones.some((m) => m.label.toLowerCase() === sg.label.toLowerCase())
  );

  return (
    <div className="ms-editor">
      <div className="section-head" style={{ marginBottom: milestones.length ? 12 : 12 }}>
        <h2 style={{ fontSize: 19 }}>Jalons du plan</h2>
        <span className="count">{milestones.length}</span>
        <span className="spacer" />
        {missingSuggestions.map((sg) => (
          <button key={sg.label} className="btn btn-ghost" onClick={() => addMilestone(sg.label, sg.atAge)}>
            + {sg.label}{birthYear ? ` (${birthYear + sg.atAge})` : ""}
          </button>
        ))}
        <button className="btn" onClick={() => addMilestone()}>
          <IconPlus size={16} /> Ajouter
        </button>
      </div>

      {milestones.length === 0 ? (
        <p className="help" style={{ marginBottom: 8 }}>
          Un jalon est une <b>année nommée</b> (Retraite, Achat maison…) propre à ce plan : ancre un flux ou un
          événement dessus, et déplacer le jalon recale tout d'un coup.
        </p>
      ) : (
        <div className="rows" style={{ maxWidth: 560 }}>
          {milestones
            .slice()
            .sort((a, b) => a.year - b.year)
            .map((m, i) => (
              <motion.div
                key={m.id}
                className="row ms-row"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.03 * i, duration: 0.3 }}
              >
                <div className="row-ic" style={{ color: "var(--brass-bright)", fontFamily: "var(--font-display)", fontSize: 18 }}>◇</div>
                <input
                  className="input"
                  placeholder="ex. Retraite, Achat maison…"
                  value={m.label}
                  onChange={(e) => setMilestone(m.id, { label: e.target.value })}
                />
                <input
                  className="input mono ms-year"
                  type="number"
                  value={m.year || ""}
                  onChange={(e) => setMilestone(m.id, { year: Number(e.target.value) })}
                />
                <span className="ms-age mono">
                  {birthYear ? `${m.year - birthYear} ans` : ""}
                </span>
                <button className="icon-btn danger" onClick={() => delMilestone(m.id)} aria-label="Supprimer">
                  <IconTrash size={16} />
                </button>
              </motion.div>
            ))}
        </div>
      )}
    </div>
  );
}
