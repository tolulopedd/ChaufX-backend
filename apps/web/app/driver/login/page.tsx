"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminBrand } from "../../../components/admin-brand";
import { clearStoredDriverToken, fetchDriverProfile, getStoredDriverToken } from "../../../lib/api";

export default function DriverLoginPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getStoredDriverToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    fetchDriverProfile(token)
      .then((result) => {
        setProfile(result);
      })
      .catch(() => {
        clearStoredDriverToken();
        router.replace("/login");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [router]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#F6F8FC] px-5 py-10">
        <div className="mx-auto max-w-xl">
          <section className="rounded-[36px] border border-[#E5E7EB] bg-white p-8 shadow-[0_30px_90px_-55px_rgba(15,23,42,0.24)] md:p-10">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Driver access</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[#0F172A]">Loading...</h1>
          </section>
        </div>
      </main>
    );
  }

  if (!profile) {
    return null;
  }

  return (
    <main className="min-h-screen bg-[#F6F8FC] px-5 py-10">
      <div className="mx-auto max-w-xl">
        <section className="rounded-[36px] border border-[#E5E7EB] bg-white p-8 shadow-[0_30px_90px_-55px_rgba(15,23,42,0.24)] md:p-10">
          <AdminBrand href="/" compact variant="login" />

          <div className="mt-6 flex items-center justify-between gap-4">
            <div>
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Access confirmed</div>
              <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[#0F172A]">Driver account active.</h1>
            </div>
            <button
              type="button"
              className="rounded-2xl border border-[#E5E7EB] px-4 py-3 text-sm font-semibold text-slate-700"
              onClick={() => {
                clearStoredDriverToken();
                router.push("/login");
              }}
            >
              Sign out
            </button>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-[24px] border border-[#E5E7EB] bg-[#F8FAFC] p-5">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Driver</div>
              <div className="mt-3 text-base font-semibold text-[#0F172A]">{profile.user.fullName}</div>
            </div>
            <div className="rounded-[24px] border border-[#E5E7EB] bg-[#F8FAFC] p-5">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Service areas</div>
              <div className="mt-3 text-base font-semibold text-[#0F172A]">{profile.serviceAreas.join(", ")}</div>
            </div>
            <div className="rounded-[24px] border border-[#E5E7EB] bg-[#F8FAFC] p-5">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Availability</div>
              <div className="mt-3 text-base font-semibold text-[#0F172A]">
                {profile.availabilityStatus ? "Online" : "Offline"}
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/driver/status" className="rounded-full border border-[#E5E7EB] px-5 py-3 text-sm font-semibold text-slate-700">
              Check status
            </Link>
            <Link href="/driver/apply" className="rounded-full bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white">
              View onboarding
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
