export default function SoonPage({
  eyebrow,
  glyph,
  title,
  desc,
}: {
  eyebrow: string;
  glyph: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="soon-wrap">
      <div className="card soon-card">
        <div className="eyebrow" style={{ marginBottom: 18 }}>{eyebrow}</div>
        <div className="glyph">{glyph}</div>
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
    </div>
  );
}
