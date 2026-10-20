import type { InputHTMLAttributes, Ref } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  /** Chiffres tabulaires (montants, dates, taux). */
  mono?: boolean;
  /** React 19 : `ref` est une prop ordinaire (plus besoin de forwardRef). */
  ref?: Ref<HTMLInputElement>;
}

/** Champ de saisie du design system — enrobe `.input` (+ `.mono`). */
export default function Input({ mono, className, ...rest }: Props) {
  return <input className={`input${mono ? " mono" : ""}${className ? " " + className : ""}`} {...rest} />;
}
