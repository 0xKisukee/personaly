import type { SelectHTMLAttributes } from "react";

/** Liste déroulante du design system — enrobe `.select`. */
export default function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`select${className ? " " + className : ""}`} {...rest} />;
}
