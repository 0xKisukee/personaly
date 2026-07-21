import { useStore } from "../lib/store";
import { ageFrom } from "../lib/format";
import Modal from "./Modal";
import { Field, Input } from "../ui";

/** Panneau Paramètres : identité (nom, date de naissance). */
export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { state, update } = useStore();
  const { profile } = state;
  const age = ageFrom(profile.birthDate);

  const setProfile = (patch: Partial<typeof profile>) =>
    update((s) => ({ ...s, profile: { ...s.profile, ...patch } }));

  return (
    <Modal
      open
      title="Paramètres"
      subtitle="Ton identité. Tout reste local sur cet appareil."
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
      </div>

      <div className="modal-foot">
        <button className="btn btn-brass" onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}
