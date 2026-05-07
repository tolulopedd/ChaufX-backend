import Link from "next/link";
import { PublicPageShell } from "../../components/public-page-shell";

export default function AboutPage() {
  return (
    <PublicPageShell
      heroTitle="About ChaufX"
      heroCopy="ChaufX is a Canadian chauffeur service built around one simple idea: professional driving in the comfort of your own vehicle."
    >
      <section className="bg-white">
        <div className="mx-auto max-w-5xl px-5 py-12 md:px-8">
          <div className="rounded-[30px] border border-[#E5E7EB] bg-white p-7 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
            <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">
              Professional driving for daily life, important appointments, and longer journeys.
            </h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
              Whether it is a personal errand, a night out, a hospital appointment, or a busy workday, ChaufX helps customers save time while a vetted chauffeur drives their vehicle.
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              We focus on simple booking, reliable arrival, senior-friendly support, and a clean operating system for approved chauffeurs and admins.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/contact" className="rounded-full bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white">
                Contact us
              </Link>
              <Link href="/driver/apply" className="rounded-full border border-[#D7DEEF] px-5 py-3 text-sm font-semibold text-[#2563EB]">
                Become a driver
              </Link>
            </div>
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
