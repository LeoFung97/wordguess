import type { SimilarityCalibration } from "@/lib/game/types";

type SimilarityCalibrationCardProps = {
  calibration: SimilarityCalibration;
};

function formatHeat(value: number) {
  return value.toFixed(2);
}

export function SimilarityCalibrationCard({ calibration }: SimilarityCalibrationCardProps) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
      <p className="text-sm font-medium text-teal-100">参考刻度</p>
      <p className="mt-2 text-sm leading-6 text-white/55">
        本局中，最近词的热度为 {formatHeat(calibration.nearest)}，第 10 近为{" "}
        {formatHeat(calibration.tenth)}，第 1000 近为 {formatHeat(calibration.thousandth)}。
      </p>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-2xl bg-white/[0.05] px-2 py-3">
          <dt className="text-[10px] text-white/45">最近词</dt>
          <dd className="mt-1 text-lg font-semibold text-teal-200">{formatHeat(calibration.nearest)}</dd>
        </div>
        <div className="rounded-2xl bg-white/[0.05] px-2 py-3">
          <dt className="text-[10px] text-white/45">第 10 近</dt>
          <dd className="mt-1 text-lg font-semibold text-teal-200">{formatHeat(calibration.tenth)}</dd>
        </div>
        <div className="rounded-2xl bg-white/[0.05] px-2 py-3">
          <dt className="text-[10px] text-white/45">第 1000 近</dt>
          <dd className="mt-1 text-lg font-semibold text-teal-200">{formatHeat(calibration.thousandth)}</dd>
        </div>
      </dl>
    </div>
  );
}
