"use client";

import { ReactNode } from "react";

const toneStyles = {
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
  violet: "bg-[#EEF0FF] text-[#4338CA] border-[#DCDDFF]",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
  amber: "bg-amber-50 text-amber-700 border-amber-100",
  rose: "bg-rose-50 text-rose-700 border-rose-100",
  navy: "bg-[#0F172A] text-white border-[#0F172A]"
} as const;

type Tone = keyof typeof toneStyles;

export function StatusPill({
  label,
  tone = "neutral"
}: {
  label: string;
  tone?: Tone;
}) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] ${toneStyles[tone]}`}>
      {label}
    </span>
  );
}

export function StatCard({
  title,
  value,
  detail,
  tone = "light"
}: {
  title: string;
  value: ReactNode;
  detail?: string;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";

  return (
    <div
      className={`rounded-[28px] border p-6 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.26)] ${
        dark
          ? "border-[#1f2954] bg-[linear-gradient(155deg,#0F172A,#1a2147_56%,#4338CA)] text-white"
          : "border-[#E5E7EB] bg-white text-[#0F172A]"
      }`}
    >
      <div className={`text-[0.68rem] font-semibold uppercase tracking-[0.22em] ${dark ? "text-white/58" : "text-[#4338CA]"}`}>{title}</div>
      <div className={`mt-3 text-4xl font-semibold tracking-[-0.06em] ${dark ? "text-white" : "text-slate-950"}`}>{value}</div>
      {detail ? <p className={`mt-3 text-sm leading-6 ${dark ? "text-white/78" : "text-slate-600"}`}>{detail}</p> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[26px] border border-[#E5E7EB] bg-[#F8FAFC] px-5 py-6">
      <div className="text-base font-semibold tracking-[-0.03em] text-slate-950">{title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}
