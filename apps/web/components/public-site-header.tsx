import Link from "next/link";
import { AdminBrand } from "./admin-brand";

const menus = [
  {
    label: "Services",
    items: [
      { label: "All services", href: "/services" },
      { label: "Personal driving", href: "/services#personal-driving" },
      { label: "Senior & assisted trips", href: "/services#senior-assisted" },
      { label: "Business & long trips", href: "/services#business-travel" }
    ]
  },
  {
    label: "About",
    items: [
      { label: "About ChaufX", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "Become a driver", href: "/driver/apply" },
      { label: "Feedback", href: "/feedback" },
      { label: "Inquiry", href: "/inquiry" }
    ]
  },
  {
    label: "How It Works",
    items: [
      { label: "Customer journey", href: "/how-it-works#customer-journey" },
      { label: "Driver onboarding", href: "/how-it-works#driver-onboarding" },
      { label: "Application status", href: "/driver/status" },
      { label: "Login", href: "/login" }
    ]
  },
  {
    label: "Policies",
    items: [
      { label: "Privacy policy", href: "/policies#privacy-policy" },
      { label: "Information collection", href: "/policies#information-collection" },
      { label: "Cookies policy", href: "/policies#cookies-policy" },
      { label: "Data retention & sharing", href: "/policies#data-retention-sharing" }
    ]
  },
  {
    label: "Pricing & Booking",
    items: [
      { label: "Pricing", href: "/pricing" },
      { label: "Book online", href: "/booking" },
      { label: "Drive now", href: "/booking#drive-now" },
      { label: "Schedule a drive", href: "/booking#schedule-drive" }
    ]
  }
] as const;

export function PublicSiteHeader() {
  return (
    <header className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-[#081120]/84 px-6 py-5 backdrop-blur md:flex-row md:items-center md:justify-between">
      <AdminBrand href="/" theme="dark" />
      <nav className="flex flex-wrap gap-5 text-sm font-semibold text-white/70">
        {menus.map((menu) => (
          <div key={menu.label} className="group relative">
            <button type="button" className="cursor-default transition hover:text-white">
              {menu.label}
            </button>
            <div className="pointer-events-none absolute left-0 top-full z-20 pt-3 opacity-0 transition duration-150 group-hover:pointer-events-auto group-hover:opacity-100">
              <div className="min-w-[220px] rounded-[22px] border border-white/10 bg-[#081120]/95 p-3 shadow-[0_28px_70px_-48px_rgba(15,23,42,0.85)] backdrop-blur">
                {menu.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block rounded-2xl px-3 py-2.5 text-sm font-medium text-white/78 transition hover:bg-white/8 hover:text-white"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        ))}
      </nav>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/driver/apply"
          className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/88"
        >
          Become a driver
        </Link>
        <Link
          href="/login"
          className="rounded-full bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_16px_36px_-18px_rgba(37,99,235,0.65)]"
        >
          Login
        </Link>
      </div>
    </header>
  );
}
