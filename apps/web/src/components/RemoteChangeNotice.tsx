import { formatKstTime } from '../lib/kst';

/** Shown while the user's unsaved input is based on a value someone else has since changed. */
export default function RemoteChangeNotice({
  latestAt,
  onReload,
}: {
  latestAt: string | null;
  onReload(): void;
}) {
  return (
    <div className="inline-notice notice-remote" role="status" data-testid="remote-change-notice">
      <span>
        {latestAt
          ? `다른 사용자가 ${formatKstTime(latestAt)}으로 변경했습니다.`
          : '다른 사용자가 값을 변경했습니다.'}
      </span>
      <button type="button" className="btn-small" data-testid="remote-change-reload" onClick={onReload}>
        최신 값 불러오기
      </button>
    </div>
  );
}
