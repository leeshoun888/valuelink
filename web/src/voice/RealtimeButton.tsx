import { startRealtime, stopRealtime, useRealtime } from './realtime'
import { IcSpark } from '../ui/icons'
import './realtime.css'

export function RealtimeButton() {
  const { status, error, transcript } = useRealtime()
  const live = status === 'live'
  return (
    <div className="rtb">
      <button
        className={`btn rt-btn ${live ? 'live' : ''} ${status}`}
        onClick={() => (live || status === 'connecting' ? stopRealtime() : startRealtime())}
        title="OpenAI Realtime 음성 코파일럿 · 말로 차를 제어"
      >
        <IcSpark size={16} />
        {status === 'connecting' ? '연결 중…' : live ? '대화 종료' : '깨움이와 대화'}
      </button>
      {(live || error) && (
        <div className="rt-pop glass">
          {error && <div className="rt-err">{error}</div>}
          {live && transcript.length === 0 && <div className="rt-hint">“좀 졸린데” · “환기해 줘” · “다음 휴게소 들르자” 라고 말해 보세요</div>}
          {transcript.slice(-6).map((m, i) => (
            <div key={i} className={`rt-msg ${m.who}`}>
              {m.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
