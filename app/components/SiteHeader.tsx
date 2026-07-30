import Link from "next/link";
import { AuthControls } from "./AuthControls";
import { isClerkConfigured } from "@/lib/auth/server";

export function SiteHeader() {
  const authConfigured = isClerkConfigured();
  return (
    <header className="site-header">
      <div className="header-inner section-wrap">
        <Link className="brand" href="/" aria-label="Benchmax home">
          <span className="brand-mark" aria-hidden="true">
            B/
          </span>
          <span>BENCHMAX</span>
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          <Link href="/explore">Explore</Link>
          <Link href="/leaderboards">Leaderboards</Link>
          <Link href="/compare">Compare</Link>
          <Link href="/benchmarks">Benchmarks</Link>
          <Link href="/models">Models</Link>
          <Link href="/methodology">Methodology</Link>
        </nav>
        <div className="header-actions">
          <AuthControls configured={authConfigured} />
          <Link className="header-run" href="/run">
            Run a benchmark
          </Link>
          <Link className="header-upload" href="/upload">
            Upload a test
          </Link>
        </div>
        <details className="mobile-menu">
          <summary aria-label="Open navigation">Menu</summary>
          <nav aria-label="Mobile navigation">
            <Link href="/explore">Explore</Link>
            <Link href="/leaderboards">Leaderboards</Link>
            <Link href="/compare">Compare</Link>
            <Link href="/benchmarks">Benchmarks</Link>
            <Link href="/models">Models</Link>
            <Link href="/methodology">Methodology</Link>
            <span className="mobile-menu-divider" aria-hidden="true" />
            <Link href="/run">Run a benchmark</Link>
            <Link className="mobile-upload" href="/upload">
              Upload a test
            </Link>
            <AuthControls configured={authConfigured} />
          </nav>
        </details>
      </div>
    </header>
  );
}
