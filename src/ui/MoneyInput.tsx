import { useState, type InputHTMLAttributes } from "react";

interface Props
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number;
  onValueChange: (n: number) => void;
  /** Autorise les montants négatifs (ex. flux sortant). Défaut : non. */
  allowNegative?: boolean;
}

const groupFr = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/** Parse une saisie libre en nombre (tolère espaces, « , » décimale, « € »). */
function parseAmount(raw: string, allowNegative: boolean): number {
  let s = raw.replace(/[^\d.,-]/g, "").replace(",", ".");
  s = allowNegative ? s.replace(/(?!^)-/g, "") : s.replace(/-/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Saisie monétaire : groupée par milliers avec suffixe « € » au repos, brute
 * pendant l'édition (pas de saut de curseur). `value`/`onValueChange` en nombre.
 */
export default function MoneyInput({
  value,
  onValueChange,
  allowNegative = false,
  className,
  ...rest
}: Props) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");

  const display = focused ? draft : value ? groupFr(value) : "";

  return (
    <div className="money-field">
      <input
        className={`input mono money-input${className ? " " + className : ""}`}
        inputMode="decimal"
        value={display}
        onFocus={() => {
          setDraft(value ? String(value) : "");
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setDraft(e.target.value);
          onValueChange(parseAmount(e.target.value, allowNegative));
        }}
        {...rest}
      />
      <span className="money-suffix" aria-hidden>€</span>
    </div>
  );
}
