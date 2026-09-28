"use client";

import { useRouter } from "next/navigation";

export default function Hunt() {
  const router = useRouter();

  return (
    <div style={s.screen}>
      <div style={s.grain} />
      <div style={s.content}>
        {/* En-tête marque */}
        <header style={s.header}>
          <div style={s.wordmark}>YVES&nbsp;SAINT&nbsp;LAURENT</div>
          <div style={s.rule} />
          <div style={s.beauty}>B E A U T Y</div>
        </header>

        {/* Hero */}
        <section style={s.hero}>
          <h1 style={s.title}>
            La Chasse
            <br />
            <span style={s.titleItalic}>aux Trésors</span>
          </h1>
          <p style={s.subtitle}>Découvrez la collection en réalité augmentée</p>
        </section>

        {/* CTA */}
        <button style={s.cta} onClick={() => router.push("/scan")}>
          <ScanIcon />
          <span>BASCULER EN AR</span>
        </button>

        <p style={s.hint}>Édition limitée · En boutique uniquement</p>
      </div>
    </div>
  );
}

function ScanIcon() {
  const c = "#0a0a0a";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ marginRight: 12 }}>
      <path
        d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"
        stroke={c}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M3 12h18" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const GOLD = "#C9A45C";
const GOLD_SOFT = "#D8BE86";
const CREAM = "#EFE9DC";

const s = {
  screen: {
    position: "fixed",
    inset: 0,
    overflowY: "auto",
    background:
      "radial-gradient(120% 80% at 50% -10%, #1a1710 0%, #0a0a0a 45%, #000 100%)",
    color: CREAM,
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
  },
  grain: {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    opacity: 0.4,
    background:
      "radial-gradient(1px 1px at 20% 30%, rgba(201,164,92,0.12), transparent), radial-gradient(1px 1px at 70% 60%, rgba(201,164,92,0.10), transparent)",
  },
  content: {
    position: "relative",
    maxWidth: 460,
    margin: "0 auto",
    minHeight: "100%",
    padding: "40px 26px 48px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    gap: 4,
  },
  header: { textAlign: "center", marginBottom: 40 },
  wordmark: {
    fontSize: 15,
    letterSpacing: "0.42em",
    fontWeight: 600,
    color: CREAM,
    paddingLeft: "0.42em",
  },
  rule: { width: 46, height: 1, background: GOLD, margin: "12px auto", opacity: 0.8 },
  beauty: { fontSize: 10, letterSpacing: "0.55em", color: GOLD, paddingLeft: "0.55em" },
  hero: { textAlign: "center", marginBottom: 44 },
  title: {
    fontFamily: "'Didot', 'Bodoni MT', 'Playfair Display', Georgia, serif",
    fontSize: 52,
    lineHeight: 1.02,
    fontWeight: 400,
    margin: 0,
    color: CREAM,
    letterSpacing: "0.01em",
  },
  titleItalic: { fontStyle: "italic", color: GOLD_SOFT },
  subtitle: {
    marginTop: 20,
    fontSize: 12,
    letterSpacing: "0.24em",
    textTransform: "uppercase",
    color: "rgba(239,233,220,0.6)",
  },
  cta: {
    width: "100%",
    maxWidth: 360,
    padding: "18px 20px",
    background: `linear-gradient(180deg, ${GOLD_SOFT}, ${GOLD})`,
    color: "#0a0a0a",
    border: "none",
    borderRadius: 2,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.22em",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 10px 30px rgba(201,164,92,0.25)",
  },
  hint: {
    marginTop: 22,
    fontSize: 10,
    letterSpacing: "0.28em",
    textTransform: "uppercase",
    color: "rgba(239,233,220,0.4)",
  },
};
