import Link from "next/link";
import { PublicPageShell } from "../../components/public-page-shell";

export default function BookingPage() {
  return (
    <PublicPageShell
      heroTitle="Book Online"
      heroCopy="ChaufX keeps online booking short and simple, whether you need a driver now or want to schedule ahead."
    >
      <section className="bg-white">
        <div className="mx-auto max-w-5xl px-5 py-12 md:px-8">
          <div className="grid gap-4 md:grid-cols-2">
            <div id="drive-now" className="rounded-[28px] border border-[#E5E7EB] bg-white p-6 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#0F172A]">Drive now</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Confirm pickup, enter your destination, and request a chauffeur for the nearest approved operating window.
              </p>
            </div>
            <div id="schedule-drive" className="rounded-[28px] border border-[#E5E7EB] bg-white p-6 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#0F172A]">Schedule a drive</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Choose a later date and time for appointments, business travel, evening plans, and longer personal journeys.
              </p>
            </div>
          </div>

          <div className="mt-8 rounded-[28px] border border-[#E5E7EB] bg-[#F8FAFC] p-6">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Customer access</div>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Customer booking is completed through the ChaufX mobile experience. Use this website to understand the service, pricing, and booking flow before using the app.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/how-it-works" className="rounded-full bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white">
                See how it works
              </Link>
              <Link href="/pricing" className="rounded-full border border-[#D7DEEF] px-5 py-3 text-sm font-semibold text-[#2563EB]">
                View pricing
              </Link>
            </div>
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
