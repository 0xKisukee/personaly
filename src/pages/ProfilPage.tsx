import { motion } from "motion/react";
import { useStore } from "../lib/store";
import { ageFrom } from "../lib/format";
import PageHeader from "../components/PageHeader";
import { Card, Field, Input } from "../ui";

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

      <Card
        as={motion.div}
        style={{ padding: 28, maxWidth: 560 }}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
      >
        <div className="form-grid">
          <Field span2 label="Prénom" htmlFor="fn">
            <Input
              id="fn"
              placeholder="ex. Aymane"
              value={profile.firstName}
              onChange={(e) => setProfile({ firstName: e.target.value })}
            />
          </Field>
          <Field label="Date de naissance" htmlFor="bd">
            <Input
              id="bd"
              type="date"
              mono
              value={profile.birthDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setProfile({ birthDate: e.target.value })}
            />
          </Field>
          <Field label="Âge">
            <div
              className="input mono"
              style={{ display: "flex", alignItems: "center", color: age === null ? "var(--ink-faint)" : "var(--ink)" }}
            >
              {age !== null ? `${age} ans` : "—"}
            </div>
          </Field>
        </div>

        <div className="divider" />
        <div className="hint">
          <span className="dot brass" /> Tout est enregistré localement sur cet appareil. Aucune donnée ne quitte ton navigateur.
        </div>
      </Card>
    </>
  );
}
