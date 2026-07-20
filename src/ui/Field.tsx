import type { ReactNode } from "react";

interface Props {
  label?: ReactNode;
  /** Texte d'aide sous le champ (`.help`). */
  help?: ReactNode;
  /** Occupe les 2 colonnes de la `.form-grid`. */
  span2?: boolean;
  /** Associe le `<label>` à l'input (accessibilité). */
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

/** Groupe label + contrôle + aide — enrobe `.field` (+ `.span-2`, `.help`). */
export default function Field({ label, help, span2, htmlFor, className, children }: Props) {
  return (
    <div className={`field${span2 ? " span-2" : ""}${className ? " " + className : ""}`}>
      {label != null && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {help != null && <span className="help">{help}</span>}
    </div>
  );
}
