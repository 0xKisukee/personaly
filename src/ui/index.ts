/* Design system — primitives réutilisables. Import unique : `from "../ui"`.
   Enrobent les classes CSS existantes (styles/primitives.css) ; l'API est
   validée par la page Profil (pilote) avant migration des autres pages. */
export { default as Donut, type DonutSegment } from "./Donut";
export { default as Field } from "./Field";
export { default as Input } from "./Input";
export { default as PerformanceBadge } from "./PerformanceBadge";
export { perfColor } from "./perfColor";
export { default as Segment } from "./Segment";
export { default as Select } from "./Select";
