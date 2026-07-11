import { motion } from "motion/react";
import { useStore } from "../lib/store";
import { ageFrom } from "../lib/format";
import PageHeader from "../components/PageHeader";

export default function ProfilPage() {
  const { state, update } = useStore();
  const { profile } = state;
  const age = ageFrom(profile.birthDate);

  const setProfile = (patch: Partial<typeof profile>) =>
    update((s) => ({ ...s, profile: { ...s.profile, ...patch } }));

  return (
    <>
      <PageHeader
        eyebrow="01 — Profil"
        title={
          <>
            Qui es-<em>tu</em> ?
          </>
        }
        lede="Ton identité, socle des finances courantes. Les jalons de vie (retraite…) se gèrent dans chaque plan, sur la page Projection."
      />

      <motion.div
        className="card"
        style={{ padding: 28, maxWidth: 560 }}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
      >
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="fn">Prénom</label>
            <input
              id="fn"
              className="input"
              placeholder="ex. Aymane"
              value={profile.firstName}
              onChange={(e) => setProfile({ firstName: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="bd">Date de naissance</label>
            <input
              id="bd"
              type="date"
              className="input mono"
              value={profile.birthDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setProfile({ birthDate: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Âge</label>
            <div
              className="input mono"
              style={{ display: "flex", alignItems: "center", color: age === null ? "var(--ink-faint)" : "var(--ink)" }}
            >
              {age !== null ? `${age} ans` : "—"}
            </div>
          </div>
        </div>

        <div className="divider" />
        <div className="hint">
          <span className="dot brass" /> Tout est enregistré localement sur cet appareil. Aucune donnée ne quitte ton navigateur.
        </div>
      </motion.div>
    </>
  );
}
