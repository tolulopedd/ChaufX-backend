import { ReactNode } from "react";
import { PublicSiteFooter } from "./public-site-footer";
import { PublicSiteHeader } from "./public-site-header";

type PublicPageShellProps = {
  children: ReactNode;
  heroTitle: string;
  heroCopy: string;
  heroTagline?: string;
};

export function PublicPageShell({ children, heroTitle, heroCopy, heroTagline }: PublicPageShellProps) {
  return (
    <main className="min-h-screen bg-[#F6F8FC]">
      <section
        className="relative overflow-hidden bg-[#050B15] text-white"
        style={{
          backgroundImage: "url('/admin-hero-bg.jpg')",
          backgroundPosition: "center 42%",
          backgroundSize: "cover"
        }}
      >
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,11,21,0.54)_0%,rgba(5,11,21,0.24)_38%,rgba(5,11,21,0.68)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,11,21,0.76)_0%,rgba(5,11,21,0.5)_34%,rgba(5,11,21,0.14)_68%,rgba(5,11,21,0.42)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.14),transparent_36%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_26%)]" />

        <div className="relative mx-auto max-w-7xl px-5 py-6 md:px-8">
          <PublicSiteHeader />

          <div className="px-1 py-10 md:px-2 md:py-12 lg:py-16">
            <div className="max-w-3xl rounded-[28px] bg-[linear-gradient(135deg,rgba(5,11,21,0.36),rgba(5,11,21,0.08))] p-2 md:p-4">
              <div className="text-base font-semibold uppercase tracking-[0.38em] text-white/78 [text-shadow:0_2px_18px_rgba(5,11,21,0.75)] md:text-lg">
                ChaufX Canada
              </div>
              <h1 className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-white [text-shadow:0_6px_28px_rgba(5,11,21,0.85)] md:text-6xl">
                {heroTitle}
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-white/80 [text-shadow:0_3px_18px_rgba(5,11,21,0.8)]">
                {heroCopy}
              </p>
              {heroTagline ? (
                <div className="mt-6 text-lg italic tracking-[0.02em] text-[#F6D28B] [font-family:Georgia,'Times New Roman',serif] [text-shadow:0_3px_18px_rgba(5,11,21,0.86)] md:text-[1.3rem]">
                  {heroTagline}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {children}

      <PublicSiteFooter />
    </main>
  );
}
