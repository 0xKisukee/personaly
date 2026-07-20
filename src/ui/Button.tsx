import type { ButtonHTMLAttributes } from "react";

type Variant = "default" | "brass" | "ghost";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `brass` = action principale, `ghost` = discret, `default` = neutre. */
  variant?: Variant;
}

/** Bouton du design system — enrobe les classes `.btn` / `.btn-brass` / `.btn-ghost`. */
export default function Button({ variant = "default", className, ...rest }: Props) {
  const v = variant === "brass" ? " btn-brass" : variant === "ghost" ? " btn-ghost" : "";
  return <button className={`btn${v}${className ? " " + className : ""}`} {...rest} />;
}
