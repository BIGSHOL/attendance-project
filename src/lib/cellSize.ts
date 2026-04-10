export type CellSize = "xs" | "sm" | "md" | "lg" | "xl";

export const CELL_SIZE_OPTIONS: { value: CellSize; label: string }[] = [
  { value: "xs", label: "매우좁게" },
  { value: "sm", label: "좁게" },
  { value: "md", label: "보통" },
  { value: "lg", label: "넓게" },
  { value: "xl", label: "매우넓게" },
];

export const CELL_WIDTH: Record<CellSize, number> = {
  xs: 32,
  sm: 40,
  md: 50,
  lg: 62,
  xl: 76,
};

export const CELL_HEIGHT: Record<CellSize, number> = {
  xs: 30,
  sm: 38,
  md: 46,
  lg: 56,
  xl: 66,
};
