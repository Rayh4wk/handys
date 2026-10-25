import { STATUS_LABEL, type InspectionStatus } from '../api/types';

export default function StatusBadge({ status }: { status: InspectionStatus | null | undefined }) {
  const s = status ?? 'UNKNOWN';
  return (
    <span className={`badge badge-${s}`} data-testid="status-badge" data-status={s}>
      {status ? STATUS_LABEL[status] : '판정 대기'}
    </span>
  );
}
