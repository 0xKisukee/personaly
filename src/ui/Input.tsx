import { forwardRef, type InputHTMLAttributes } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  /** Chiffres tabulaires (montants, dates, taux). */
  mono?: boolean;
}

/** Champ de saisie du design system — enrobe `.input` (+ `.mono`). */
const Input = forwardRef<HTMLInputElement, Props>(({ mono, className, ...rest }, ref) => (
  <input
    ref={ref}
    className={`input${mono ? " mono" : ""}${className ? " " + className : ""}`}
    {...rest}
  />
));
Input.displayName = "Input";
export default Input;
