import type { ElementType } from "react";

interface Props {
  /** Élément/handler de rendu (ex. `motion.div` pour animer la carte). Défaut : `div`. */
  as?: ElementType;
  className?: string;
  [key: string]: unknown;
}

/** Surface du design system — enrobe `.card`. Polymorphe via `as`. */
export default function Card({ as: As = "div", className, ...rest }: Props) {
  return <As className={`card${className ? " " + className : ""}`} {...rest} />;
}
