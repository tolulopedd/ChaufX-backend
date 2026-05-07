"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode } from "react";
import { AdminBrand } from "./admin-brand";
import {
  ApplicationsIcon,
  BookingsIcon,
  DashboardIcon,
  DriversIcon,
  MessagesIcon,
  ReportsIcon,
  SettingsIcon,
  SignOutIcon,
  TripsIcon
} from "./admin-icons";
import { clearStoredToken, getStoredToken } from "../lib/api";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/drivers", label: "Drivers", icon: DriversIcon },
  { href: "/applications", label: "Applications", icon: ApplicationsIcon },
  { href: "/bookings", label: "Bookings", icon: BookingsIcon },
  { href: "/trips", label: "Active Trips", icon: TripsIcon },
  { href: "/messages", label: "Messages", icon: MessagesIcon },
  { href: "/reports", label: "Reports", icon: ReportsIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon }
];

export function AdminShell({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const token = getStoredToken();

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f7f7fb_0%,#ffffff_42%,#f3f4f6_100%)] text-[#0F172A]">
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-[30px] border border-[#E5E7EB] bg-white/95 p-5 shadow-[0_24px_52px_-36px_rgba(15,23,42,0.3)] backdrop-blur">
          <div className="rounded-[24px] bg-[linear-gradient(145deg,#0F172A,#1f2555_48%,#4338CA_100%)] p-5 text-white">
            <AdminBrand theme="dark" />
            <div className="mt-5 max-w-[12rem] rounded-full border border-white/12 bg-white/8 px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/70">
              Admin console
            </div>
            <p className="mt-4 text-sm leading-6 text-white/80">Admin view for drivers onboarding, bookings, payments, and trip monitoring.</p>
          </div>

          <nav className="mt-6 space-y-2">
            {navItems.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-medium transition ${
                    active ? "bg-[#EEF0FF] text-[#4338CA]" : "text-slate-600 hover:bg-[#F3F4F6] hover:text-[#0F172A]"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span
                      className={`inline-flex h-9 w-9 items-center justify-center rounded-2xl border transition ${
                        active
                          ? "border-[#DCDDFF] bg-white text-[#4338CA]"
                          : "border-[#E5E7EB] bg-[#F8FAFC] text-slate-500"
                      }`}
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    <span>{item.label}</span>
                  </span>
                  {active ? <span className="h-2 w-2 rounded-full bg-[#4F46E5]" /> : null}
                </Link>
              );
            })}
          </nav>

          <button
            type="button"
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-2xl border border-[#E5E7EB] px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-[#D1D5DB] hover:bg-[#F3F4F6]"
            onClick={() => {
              clearStoredToken();
              router.push("/login");
            }}
          >
            <SignOutIcon className="h-4.5 w-4.5" />
            Sign out
          </button>

          {!token ? <p className="mt-3 text-xs text-amber-600">No token stored yet. Sign in to make live admin changes.</p> : null}
        </aside>

        <main className="space-y-6">
          <section className="rounded-[32px] border border-[#E5E7EB] bg-white/90 p-6 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.22)] backdrop-blur">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-[#4F46E5]">
                  Operations
                </div>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em]">{title}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
              </div>
              <div className="rounded-2xl border border-[#DCDDFF] bg-[#EEF0FF] px-4 py-3 text-sm text-[#4338CA]">
                Demo admin login: <span className="font-semibold">admin@chaufx.com</span>
              </div>
            </div>
          </section>

          {children}
        </main>
      </div>
    </div>
  );
}

export function Panel({
  title,
  children,
  aside,
  subtitle
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
  subtitle?: string;
}) {
  return (
    <section className="rounded-[28px] border border-[#E5E7EB] bg-white p-6 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.26)]">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
