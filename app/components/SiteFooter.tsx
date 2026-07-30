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
          <p>Real tests. Inspectable evidence. Rankings that earn trust.</p>
        </div>
        <div className="footer-links">
          <div>
            <span>PRODUCT</span>
            <Link href="/explore">Explore</Link>
            <Link href="/benchmarks">Benchmarks</Link>
            <Link href="/models">Models</Link>
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
        <span>Public methodology · v0.1</span>
      </div>
    </footer>
  );
}
