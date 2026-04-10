export type CellSize = "xs" | "sm" | "md" | "lg" | "xl";

export const CELL_SIZE_OPTIONS: { value: CellSize; label: string }[] = [
  { value: "xs", label: "매우좁게" },
  { value: "sm", label: "좁게" },
  { value: "md", label: "보통" },
  { value: "lg", label: "넓게" },
  { value: "xl", label: "매우넓게" },
];

export const CELL_WIDTH: Record<CellSize, number> = {
  xs: 28,
  sm: 34,
  md: 40,
  lg: 48,
  xl: 60,
};

export const CELL_HEIGHT: Record<CellSize, number> = {
  xs: 26,
  sm: 32,
  md: 36,
  lg: 44,
  xl: 54,
};
