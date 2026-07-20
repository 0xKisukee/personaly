import type { HTMLAttributes } from "react";

/** Étiquette compacte (méta, statut) — enrobe `.tag`. */
export default function Tag({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={`tag${className ? " " + className : ""}`} {...rest} />;
}
