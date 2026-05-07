"use client";

import { useState } from "react";
import { submitContactMessage } from "../lib/api";

const provincesAndTerritories = [
  "Alberta",
  "British Columbia",
  "Manitoba",
  "New Brunswick",
  "Newfoundland and Labrador",
  "Northwest Territories",
  "Nova Scotia",
  "Nunavut",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Yukon"
] as const;

type DriverContactFormProps = {
  defaultSubject?: string;
  buttonLabel?: string;
};

export function DriverContactForm({
  defaultSubject = "General inquiry",
  buttonLabel = "Send a message"
}: DriverContactFormProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    province: "",
    subject: defaultSubject,
    message: ""
  });

  return (
    <div className="mt-6">
      <button
        type="button"
        className="inline-flex rounded-full bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_32px_-18px_rgba(37,99,235,0.55)]"
        onClick={() => {
          setOpen((current) => !current);
          setStatus("");
        }}
      >
        {open ? "Close message" : buttonLabel}
      </button>

      {open ? (
        <form
          className="mt-5 space-y-4 rounded-[28px] border border-[#E5E7EB] bg-white p-6"
          onSubmit={async (event) => {
            event.preventDefault();
            setLoading(true);
            setStatus("");

            try {
              await submitContactMessage({
                fullName: form.fullName,
                email: form.email,
                province: form.province || undefined,
                subject: form.subject || undefined,
                message: form.message
              });
              setStatus("Your message has been sent to the ChaufX admin team.");
              setForm({
                fullName: "",
                email: "",
                province: "",
                subject: defaultSubject,
                message: ""
              });
              setOpen(false);
            } catch (reason) {
              setStatus(reason instanceof Error ? reason.message : "Unable to send message");
            } finally {
              setLoading(false);
            }
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Full name</span>
              <input
                className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]"
                value={form.fullName}
                onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
                required
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                required
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Province/territory</span>
              <select
                className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 outline-none transition focus:border-[#2563EB]"
                value={form.province}
                onChange={(event) => setForm((current) => ({ ...current, province: event.target.value }))}
              >
                <option value="">Select province or territory</option>
                {provincesAndTerritories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Subject</span>
              <input
                className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]"
                value={form.subject}
                onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Message</span>
            <textarea
              className="min-h-[140px] w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]"
              value={form.message}
              onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
              required
            />
          </label>

          {status ? <p className={`text-sm ${status.includes("sent") ? "text-emerald-600" : "text-rose-600"}`}>{status}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex rounded-full bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_32px_-18px_rgba(37,99,235,0.55)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Sending..." : "Send message"}
          </button>
        </form>
      ) : status ? (
        <p className="mt-4 text-sm text-emerald-600">{status}</p>
      ) : null}
    </div>
  );
}
