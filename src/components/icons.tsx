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
export const IconChevron = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M9 6l6 6-6 6" />
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
export const IconSettings = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 13a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-2.87-1.2l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 13a1.7 1.7 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 6.4l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 10 3.6V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 2.87 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 20.4 10H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
  </svg>
);
export const IconClose = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconBriefcase = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" />
  </svg>
);
export const IconGift = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7S10.5 3 8.5 3 6 5 6 5s1.5 2 6 2zM12 7s1.5-4 3.5-4S18 5 18 5s-1.5 2-6 2z" />
  </svg>
);
export const IconCoins = ({ size }: P) => (
  <svg {...base(size)}>
    <ellipse cx="9" cy="7" rx="6" ry="3" />
    <path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" />
    <path d="M15 11.5c2.6.3 6 1.5 6 3.5 0 1.7-2.7 3-6 3-1.3 0-2.5-.2-3.5-.6" />
  </svg>
);
export const IconReceipt = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M5 3v18l2-1.4L9 21l2-1.4L13 21l2-1.4L17 21l2-1.4V3l-2 1.4L15 3l-2 1.4L11 3 9 4.4 7 3z" />
    <path d="M8 8h8M8 12h8" />
  </svg>
);
export const IconCart = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 4h2l2.4 12.4a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L21 8H6" />
    <circle cx="9" cy="20" r="1" />
    <circle cx="18" cy="20" r="1" />
  </svg>
);
export const IconSparkle = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
  </svg>
);
export const IconArrowUp = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);
