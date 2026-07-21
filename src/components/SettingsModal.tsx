import { useStore } from "../lib/store";
import { ageFrom } from "../lib/format";
import Modal from "./Modal";
import { Field, Input } from "../ui";

/** Panneau Paramètres : identité (nom, date de naissance) + réglages globaux (inflation). */
export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { state, update } = useStore();
  const { profile, settings } = state;
  const age = ageFrom(profile.birthDate);

  const setProfile = (patch: Partial<typeof profile>) =>
    update((s) => ({ ...s, profile: { ...s.profile, ...patch } }));
  const setSettings = (patch: Partial<typeof settings>) =>
    update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));

  return (
    <Modal
      open
      title="Paramètres"
      subtitle="Ton identité et les réglages par défaut de l'application. Tout reste local sur cet appareil."
      onClose={onClose}
    >
      <div className="form-grid">
        <Field span2 label="Prénom" htmlFor="set-fn">
          <Input
            id="set-fn"
            placeholder="ex. Aymane"
            value={profile.firstName}
            onChange={(e) => setProfile({ firstName: e.target.value })}
          />
        </Field>
        <Field label="Date de naissance" htmlFor="set-bd">
          <Input
            id="set-bd"
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

        <div className="span-2 form-block">
          <div className="block-title">
            <span className="dot brass" /> Hypothèses par défaut
          </div>
          <Field
            className="span-2"
            label="Inflation par défaut (%/an)"
            help="Sert de base à la trajectoire de l'Accueil (finances actuelles projetées sans plan). Chaque plan de la page Projection garde sa propre inflation."
          >
            <Input
              mono
              type="number"
              step="0.1"
              style={{ maxWidth: 160 }}
              value={settings.defaultInflation}
              onChange={(e) => setSettings({ defaultInflation: Number(e.target.value) })}
            />
          </Field>
        </div>
      </div>

      <div className="modal-foot">
        <button className="btn btn-brass" onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}
