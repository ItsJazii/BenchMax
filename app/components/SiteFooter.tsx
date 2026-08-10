import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner section-wrap">
        <div>
          <Link className="brand footer-brand" href="/">
            <span className="brand-mark">B/</span>
            <span>BENCHMAX</span>
          </Link>
          <p>Public AI Tests with inspectable prompts, setup, and evidence.</p>
        </div>
        <div className="footer-links">
          <div>
            <span>PRODUCT</span>
            <Link href="/tests">All Tests</Link>
            <Link href="/models">Models</Link>
            <Link href="/leaderboards">Leaderboards</Link>
            <Link href="/submit">Submit Test</Link>
          </div>
          <div>
            <span>TRUST</span>
            <Link href="/methodology">Methodology</Link>
            <Link href="/security">Security</Link>
            <Link href="/report">Report abuse</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </div>
        </div>
      </div>
      <div className="footer-base section-wrap">
        <span>© 2026 Benchmax</span>
        <span>Community Tests · declared setup · inspectable evidence</span>
      </div>
    </footer>
  );
}
