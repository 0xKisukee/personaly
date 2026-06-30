interface P {
  size?: number;
}
const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IconPlus = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconEdit = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
export const IconTrash = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </svg>
);
export const IconHome = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 11l9-7 9 7" />
    <path d="M5 10v10h14V10" />
  </svg>
);
export const IconCar = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13" />
    <path d="M4 13h16v5H4zM7 18v2M17 18v2" />
    <circle cx="7.5" cy="15.5" r="0.6" />
    <circle cx="16.5" cy="15.5" r="0.6" />
  </svg>
);
export const IconBank = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 9l9-5 9 5M4 9v9M20 9v9M3 21h18M8 12v5M12 12v5M16 12v5" />
  </svg>
);
export const IconSavings = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M19 11a7 7 0 0 0-7-5C8 6 5 8.5 5 12c0 2 1 3.5 2 4.5V20h3v-2h4v2h3v-4l1-1v-3z" />
    <circle cx="9" cy="11" r="0.6" />
  </svg>
);
export const IconChart = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6" />
  </svg>
);
export const IconBox = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 8l9-4 9 4v8l-9 4-9-4z" />
    <path d="M3 8l9 4 9-4M12 12v8" />
  </svg>
);
export const IconDebt = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);
export const IconBuilding = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M4 21V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v17M13 9h6a1 1 0 0 1 1 1v11" />
    <path d="M7 7h2M7 11h2M7 15h2M16 13h1M16 17h1M3 21h18" />
  </svg>
);
export const IconUser = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5" />
  </svg>
);
export const IconClose = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
