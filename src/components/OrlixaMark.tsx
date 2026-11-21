interface OrlixaMarkProps {
  size?: number;
}

export function OrlixaMark({ size = 26 }: OrlixaMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="2" y="2" width="24" height="24" rx="7" stroke="#38BDF8" strokeWidth="2" />
      <circle cx="14" cy="14" r="5" fill="#38BDF8" />
    </svg>
  );
}
