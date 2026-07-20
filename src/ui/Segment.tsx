import type { ReactNode } from "react";

interface Option<T> {
  value: T;
  label: ReactNode;
}

interface Props<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  className?: string;
  "aria-label"?: string;
}

/** Bascule segmentée (période, horizon, onglets…) — enrobe `.segment` + `[data-on]`. */
export default function Segment<T extends string | number>({
  value,
  onChange,
  options,
  className,
  ...rest
}: Props<T>) {
  return (
    <div className={`segment${className ? " " + className : ""}`} role="tablist" {...rest}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="tab"
          aria-selected={value === o.value}
          data-on={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
