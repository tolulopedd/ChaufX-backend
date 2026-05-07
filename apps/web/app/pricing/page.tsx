import Link from "next/link";
import { PublicPageShell } from "../../components/public-page-shell";

export default function PricingPage() {
  return (
    <PublicPageShell
      heroTitle="Pricing"
      heroCopy="ChaufX pricing is designed to stay simple, inclusive, and billed in Canadian dollars."
    >
      <section className="bg-white">
        <div className="mx-auto max-w-5xl px-5 py-12 md:px-8">
          <div className="rounded-[30px] border border-[#D7DEEF] bg-[#EEF2FF] p-7 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Public pricing</div>
            <div className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-[#0F172A]">Starting at $29 CAD/hour</div>
            <p className="mt-3 text-base leading-7 text-slate-700">
              Minimum booking is 2 hours. No hidden fees.
            </p>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-[28px] border border-[#E5E7EB] bg-white p-6 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#0F172A]">Simple pricing model</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Pricing starts at $29 CAD per hour, stays simple, and is billed in Canadian dollars. Once your booking is confirmed, there is no surge repricing.
              </p>
            </div>
            <div className="rounded-[28px] border border-[#E5E7EB] bg-white p-6 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#0F172A]">Booking terms</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Customers can review an estimate before submitting a request. Minimum booking is 2 hours and pricing is shown without hidden fees.
              </p>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/booking" className="rounded-full bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white">
              Book online
            </Link>
            <Link href="/services" className="rounded-full border border-[#D7DEEF] px-5 py-3 text-sm font-semibold text-[#2563EB]">
              View services
            </Link>
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
