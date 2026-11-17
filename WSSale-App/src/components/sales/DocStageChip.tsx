import type { DocStage } from '../../types';
import { docStageMeta, docStageQuantities } from '../../constants/docStage';

/**
 * Which WinSpeed document a bill has reached: "ใบสั่งขาย (104) · ออกตั๋วปุ๋ยแล้ว ยังไม่ขน".
 * Renders nothing when the list did not carry a stage, so an older server or a failed read leaves the row as it was.
 */
export function DocStageChip({
  stage,
  showQuantities = false,
  className = '',
}: {
  stage?: DocStage | null;
  /** add the tonnes line under the chip: ticket, hauled, left, invoiced */
  showQuantities?: boolean;
  className?: string;
}) {
  const meta = docStageMeta(stage);
  if (!stage || !meta) return null;
  const quantities = docStageQuantities(stage);
  return (
    <span className={`inline-flex flex-col gap-0.5 ${className}`} data-doc-stage={stage.code}>
      <span
        className={`inline-flex w-fit items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold leading-tight ${meta.badgeClass}`}
        title={[meta.hint, quantities].filter(Boolean).join('\n')}
      >
        {meta.label}
      </span>
      {showQuantities && quantities && (
        <span className="text-[10px] leading-tight text-gray-500">{quantities}</span>
      )}
    </span>
  );
}
