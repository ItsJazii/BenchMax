import Link from "next/link";
import { SiteFooter } from "./components/SiteFooter";
import { SiteHeader } from "./components/SiteHeader";

export default function NotFound() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="inner-page section-wrap">
        <section className="empty-state">
          <span className="section-index">404 / NO RECORD</span>
          <h1>This test is not on the record.</h1>
          <p>
            The link may be wrong, unpublished, removed for safety, or no longer
            available.
          </p>
          <Link className="button button-primary" href="/explore">
            Explore public tests
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
