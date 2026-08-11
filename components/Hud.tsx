import { STATUS } from '@/lib/status';

// The legend's captions are its own — "Loading data" reads better on screen
// than the bare status key — but the colours come from STATUS, so a change to
// a status colour cannot leave the legend describing the old one.
const LEGEND: [keyof typeof STATUS & string, string][] = [
  ['running', 'Running'],
  ['fault', 'Fault'],
  ['init', 'Initializing'],
  ['loading', 'Loading data'],
];

export function Hud() {
  return (
    <div className="hud">
      <h4 className="eyebrow">Mainframe</h4>
      <div className="legend">
        {LEGEND.map(([key, caption]) => (
          <div key={key}>
            <i style={{ background: STATUS[key].hex }} />
            {caption}
          </div>
        ))}
      </div>
    </div>
  );
}
