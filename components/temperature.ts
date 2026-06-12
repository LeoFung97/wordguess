import type { GuessTemperature } from "@/lib/game/types";

export const temperatureCopy: Record<GuessTemperature, string> = {
  ice: "冰冷",
  cold: "偏远",
  warm: "接近",
  hot: "很热",
  burning: "烫手",
  solved: "命中",
};

export const temperatureClass: Record<GuessTemperature, string> = {
  ice: "border-sky-300/25 bg-sky-300/10 text-sky-100",
  cold: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  warm: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  hot: "border-orange-300/35 bg-orange-300/15 text-orange-100",
  burning: "border-rose-300/40 bg-rose-300/15 text-rose-100",
  solved: "border-emerald-300/45 bg-emerald-300/15 text-emerald-100",
};
