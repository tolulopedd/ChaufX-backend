import type { Metadata } from "next";
import Link from "next/link";
import { PublicPageShell } from "../components/public-page-shell";

export const metadata: Metadata = {
  title: "ChaufX",
  description: "ChaufX Canada public website."
};

const services = [
  {
    title: "Personal driving",
    body: "Book a professional chauffeur for errands, social outings, shopping days, and everyday schedules."
  },
  {
    title: "Senior and assisted trips",
    body: "Use your own vehicle for hospital visits, therapy sessions, medical appointments, and family support."
  },
  {
    title: "Business and long trips",
    body: "Travel comfortably in your own car for business meetings, airport runs, and out-of-town journeys."
  },
  {
    title: "Drink & Dial",
    body: "Get a professional chauffeur to drive your car after parties, clubs, events, and other nights out that may involve alcohol."
  },
  {
    title: "Corporate chauffeur",
    body: "Use ChaufX for fleet movement, executive transport, and vehicle transfer services for businesses."
  },
  {
    title: "Business meetings",
    body: "Stay focused on your day while a professional chauffeur handles your driving between meetings and work commitments."
  }
];

const policies = [
  {
    title: "Privacy policy",
    body: "ChaufX handles personal information through controlled access, secure processing, and limited operational use."
  },
  {
    title: "Information collection",
    body: "We collect only the information required for bookings, onboarding, communication, and platform operations."
  },
  {
    title: "Cookies policy",
    body: "Cookies and related technologies may be used to support website sessions, performance, and analytics."
  },
  {
    title: "Data retention & sharing",
    body: "Information is retained only as needed for service, legal, and compliance purposes and is shared on a controlled basis."
  }
];

const flow = [
  "Confirm your pickup and destination.",
  "Request a driver now or schedule for later.",
  "An approved nearby chauffeur accepts the trip."
];

const highlights = [
  {
    title: "Travel in your own car",
    body: "Customers travel in their own cars, not a rideshare vehicle.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 14l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 9l2 5" />
        <path d="M5 14h14v4a1 1 0 0 1-1 1h-1" />
        <path d="M5 14v4a1 1 0 0 0 1 1h1" />
        <circle cx="7.5" cy="17.5" r="1.5" />
        <circle cx="16.5" cy="17.5" r="1.5" />
      </svg>
    )
  },
  {
    title: "Approved chauffeurs",
    body: "Approved chauffeurs arrive on schedule and operate the customer's vehicle.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="3" />
        <path d="M6 19c0-3 2.7-5 6-5s6 2 6 5" />
        <path d="M18.5 6.5l1 1 2-2" />
      </svg>
    )
  },
  {
    title: "Simple Canadian pricing",
    body: "Pricing stays simple, inclusive, and billed in Canadian dollars.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v18" />
        <path d="M16.5 7.5c0-1.7-1.8-3-4.5-3S7.5 5.8 7.5 7.5 9.3 10 12 10s4.5 1.3 4.5 3-1.8 3-4.5 3-4.5-1.3-4.5-3" />
      </svg>
    )
  }
];

const portals = [
  {
    eyebrow: "Driver onboarding",
    title: "Join the chauffeur network",
    body: "Create your application, upload your documents, and track your review status.",
    href: "/driver/apply",
    cta: "Get started"
  },
  {
    eyebrow: "Login",
    title: "Access your account",
    body: "Use one login page for approved driver and admin accounts. ChaufX routes you by role after sign-in.",
    href: "/login",
    cta: "Login"
  }
];

export default function HomePage() {
  return (
    <PublicPageShell
      heroTitle="Driver Services on demand"
      heroCopy="ChaufX is a Canadian personal chauffeur service that lets customers book professional drivers for their own vehicles, while giving chauffeurs and operators a simple platform to work from."
      heroTagline="Your Car, Your Convenience, Your Safety"
    >
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-6 md:px-8">
          <div className="grid gap-4 lg:grid-cols-3">
            {highlights.map((item) => (
              <div
                key={item.title}
                className="rounded-[28px] border border-[#E5E7EB] bg-white p-6 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#EEF2FF] text-[#2563EB]">
                  {item.icon}
                </div>
                <div className="mt-4 text-lg font-semibold tracking-[-0.04em] text-[#0F172A]">{item.title}</div>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="services" className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-12 md:px-8">
          <div className="max-w-3xl">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Services</div>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-[#0F172A]">
              Simple chauffeur service in your own vehicle.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-600">
              ChaufX is built for customers who want a professional driver without giving up the comfort, privacy, and convenience of their own car.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {services.map((item) => (
              <div
                key={item.title}
                className="rounded-[28px] border border-[#E5E7EB] bg-white p-6 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.24)]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#EEF2FF] text-[#2563EB]">
                    <div className="h-2.5 w-2.5 rounded-full bg-current" />
                  </div>
                  <div className="text-lg font-semibold tracking-[-0.04em] text-[#0F172A]">{item.title}</div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-6 md:px-8">
          <div className="rounded-[30px] border border-[#E5E7EB] bg-white p-7 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">About ChaufX</div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">
              Professional driving for your everyday plans and important journeys.
            </h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
              Whether it is a personal errand, a night out, a medical appointment, a busy workday, or a longer trip, ChaufX helps you reclaim your time while a vetted chauffeur drives your vehicle.
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              We focus on simple booking, reliable arrival, senior-friendly service, and a clean operating system for approved chauffeurs and admins.
            </p>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-6 md:px-8">
          <div className="rounded-[30px] border border-[#E5E7EB] bg-white p-7 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">How It Works</div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">A short, clear customer flow.</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {flow.map((item, index) => (
                <div key={item} className="rounded-[24px] border border-[#E5E7EB] bg-[#F8FAFC] p-5">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#4338CA]">
                    Step {index + 1}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="portals" className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-6 md:px-8">
          <div className="max-w-3xl">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Access</div>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-[#0F172A]">
              Use the path that fits your role.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-600">
              Once you know what ChaufX is about, use the right entry point for onboarding, login, or platform control.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {portals.map((item) => (
              <div
                key={item.title}
                className="rounded-[28px] border border-[#E5E7EB] bg-white p-6 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]"
              >
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">{item.eyebrow}</div>
                <h3 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-[#0F172A]">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.body}</p>
                <Link
                  href={item.href}
                  className="mt-6 inline-flex rounded-full border border-[#D7DEEF] px-5 py-2.5 text-sm font-semibold text-[#2563EB] transition hover:border-[#2563EB]"
                >
                  {item.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="policies" className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-6 md:px-8">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {policies.map((item) => (
              <div
                key={item.title}
                className="rounded-[28px] border border-[#E5E7EB] bg-white p-6 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.14)]"
              >
                <h3 className="text-xl font-semibold tracking-[-0.04em] text-[#0F172A]">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
