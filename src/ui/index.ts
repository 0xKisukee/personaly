/* Design system — primitives réutilisables. Import unique : `from "../ui"`.
   Enrobent les classes CSS existantes (styles/primitives.css) ; l'API est
   validée par la page Profil (pilote) avant migration des autres pages. */
export { default as Button } from "./Button";
export { default as Card } from "./Card";
export { default as Field } from "./Field";
export { default as Input } from "./Input";
export { default as MoneyInput } from "./MoneyInput";
export { default as PerformanceBadge, perfColor } from "./PerformanceBadge";
export { default as Segment } from "./Segment";
export { default as Select } from "./Select";
export { default as Tag } from "./Tag";
