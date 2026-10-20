import { useStore } from "../lib/useStore";
import { ESPERANCE_AGE, ESPERANCE_MILESTONE_ID } from "../lib/types";
import { ageFrom } from "../lib/format";
import Modal from "./Modal";
import { Field, Input } from "../ui";

/** Panneau Paramètres : identité (nom, date de naissance). */
export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { state, update } = useStore();
  const { profile } = state;
  const age = ageFrom(profile.birthDate);

  const setProfile = (patch: Partial<typeof profile>) =>
    update((s) => {
      const next = { ...s, profile: { ...s.profile, ...patch } };
      // changer la date de naissance recale le jalon global « Espérance de vie » sur +85 ans
      if (patch.birthDate) {
        const by = new Date(patch.birthDate).getFullYear();
        if (!Number.isNaN(by)) {
          next.milestones = s.milestones.map((m) =>
            m.id === ESPERANCE_MILESTONE_ID ? { ...m, year: by + ESPERANCE_AGE } : m
          );
        }
      }
      return next;
    });

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
