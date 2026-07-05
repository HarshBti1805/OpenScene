const ITEMS = [
  "Fountain native",
  "FDX round-trip",
  "Production-grade PDF",
  "Live pagination",
  "Dual dialogue",
  "(MORE) / (CONT'D)",
  "SmartType",
  "Command palette",
  "Snapshots & backups",
  "Index cards",
  "Scene navigator",
  "Distraction-free",
];

export function Marquee() {
  const row = ITEMS.map((item) => (
    <span key={item} className="marquee-item">
      {item}
    </span>
  ));
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        {row}
        {ITEMS.map((item) => (
          <span key={`${item}-dup`} className="marquee-item">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
