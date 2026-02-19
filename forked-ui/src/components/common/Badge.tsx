import { STREAM_CONFIG, DEFAULT_STREAM_CONFIG, EVENT_TYPE_CONFIG } from "../../lib/constants";

type Props = {
  stream: string;
  eventType?: string;
};

export function Badge({ stream, eventType }: Props) {
  const config = (eventType && EVENT_TYPE_CONFIG[eventType])
    || STREAM_CONFIG[stream]
    || DEFAULT_STREAM_CONFIG;
  return (
    <span
      className={`retro-badge ${config.bg} ${config.color} ${config.border}`}
    >
      {config.label}
    </span>
  );
}
