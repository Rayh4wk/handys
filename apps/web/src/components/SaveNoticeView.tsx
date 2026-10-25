import type { SaveNotice } from '../lib/reservation';

export default function SaveNoticeView({ notice }: { notice: SaveNotice | null }) {
  if (!notice) return null;
  if (notice.kind === 'conflict') {
    return (
      <p className="inline-notice notice-conflict" role="alert" data-testid="conflict-notice">
        다른 사용자가 먼저 수정했습니다. 최신 상태를 불러왔습니다.
      </p>
    );
  }
  return (
    <p className="inline-notice notice-error" role="alert" data-testid="error-notice">
      {notice.message}
    </p>
  );
}
