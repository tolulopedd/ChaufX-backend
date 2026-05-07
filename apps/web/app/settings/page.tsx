"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell, Panel } from "../../components/admin-shell";
import { EmptyState, StatCard } from "../../components/admin-primitives";
import { adminFetch, useAdminResource } from "../../lib/api";

type ProvincePricingRow = {
  province: string;
  flatFee: number;
  minHours: number;
};

type CityPricingRow = {
  province: string;
  city: string;
  flatFee: number;
  minHours: number;
};

const settingsFallback = {
  zones: [],
  pricing: [],
  provincePricing: [] as ProvincePricingRow[],
  cityPricing: [] as CityPricingRow[]
};

export default function SettingsPage() {
  const { data, loading, error, reload } = useAdminResource<any>("/admin/settings", settingsFallback);
  const [provincePricing, setProvincePricing] = useState<ProvincePricingRow[]>([]);
  const [cityPricing, setCityPricing] = useState<CityPricingRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setProvincePricing(data.provincePricing);
    setCityPricing(data.cityPricing);
  }, [data.cityPricing, data.provincePricing]);

  const provinceOptions = useMemo(
    () => provincePricing.map((row) => row.province).sort((left, right) => left.localeCompare(right)),
    [provincePricing]
  );

  async function savePricing() {
    setSaving(true);
    setNotice("");

    try {
      await adminFetch("/admin/settings/pricing", {
        method: "POST",
        body: JSON.stringify({
          provincePricing,
          cityPricing: cityPricing.filter((row) => row.province && row.city)
        })
      });
      await reload();
      setNotice("Pricing settings saved.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to save pricing settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell
      title="Settings"
      description="Provinces/territories, pricing controls, and operational defaults for the ChaufX platform."
    >
      <div className="grid gap-4 xl:grid-cols-3">
        <StatCard title="Provinces/Territories" value={provincePricing.length} detail="Coverage and pricing rows available across Canada." />
        <StatCard title="City overrides" value={cityPricing.length} detail="Optional local pricing overrides for cities that need different rules." />
        <StatCard title="Pricing model" value="Flat fee + minimum hours" detail="Admin can control hourly flat fees and minimum booking hours by province or city." tone="dark" />
      </div>

      <Panel
        title="Provinces/Territories"
        subtitle="Set the default flat fee and minimum booking hours for each province or territory."
        aside={
          <button
            type="button"
            onClick={savePricing}
            disabled={saving}
            className="rounded-2xl bg-[#2563EB] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_16px_32px_-18px_rgba(37,99,235,0.55)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save pricing"}
          </button>
        }
      >
        {loading ? <p className="text-sm text-slate-500">Loading settings...</p> : null}
        {error ? <p className="text-sm text-amber-600">{error}</p> : null}
        {notice ? <p className={`text-sm ${notice.includes("saved") ? "text-emerald-600" : "text-amber-600"}`}>{notice}</p> : null}

        {provincePricing.length ? (
          <div className="space-y-3">
            {provincePricing.map((row, index) => (
              <div key={row.province} className="grid gap-3 rounded-[24px] border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-4 lg:grid-cols-[1.5fr_1fr_1fr]">
                <div>
                  <div className="text-sm font-semibold text-slate-950">{row.province}</div>
                  <div className="mt-1 text-sm text-slate-500">Default pricing for bookings in this province or territory.</div>
                </div>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Flat fee / hour (CAD)</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 text-sm outline-none transition focus:border-[#2563EB]"
                    value={row.flatFee}
                    onChange={(event) =>
                      setProvincePricing((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, flatFee: Number(event.target.value || 0) } : item
                        )
                      )
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Minimum hours / booking</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 text-sm outline-none transition focus:border-[#2563EB]"
                    value={row.minHours}
                    onChange={(event) =>
                      setProvincePricing((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, minHours: Number(event.target.value || 1) } : item
                        )
                      )
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No province pricing yet" description="Province and territory pricing rows will appear here once the configuration is available." />
        )}
      </Panel>

      <Panel
        title="City pricing overrides"
        subtitle="Use a city override only when a local market needs a different flat fee or minimum booking hours."
        aside={
          <button
            type="button"
            onClick={() =>
              setCityPricing((current) => [...current, { province: provinceOptions[0] ?? "Ontario", city: "", flatFee: 29, minHours: 2 }])
            }
            className="rounded-2xl border border-[#DCDDFF] bg-[#EEF0FF] px-4 py-2.5 text-sm font-semibold text-[#4338CA]"
          >
            Add city override
          </button>
        }
      >
        {cityPricing.length ? (
          <div className="space-y-3">
            {cityPricing.map((row, index) => (
              <div key={`${row.province}-${row.city}-${index}`} className="grid gap-3 rounded-[24px] border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-4 xl:grid-cols-[1.1fr_1.1fr_0.8fr_0.8fr_auto]">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Province/Territory</span>
                  <select
                    className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#2563EB]"
                    value={row.province}
                    onChange={(event) =>
                      setCityPricing((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, province: event.target.value } : item
                        )
                      )
                    }
                  >
                    {provinceOptions.map((province) => (
                      <option key={province} value={province}>
                        {province}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">City</span>
                  <input
                    className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 text-sm outline-none transition focus:border-[#2563EB]"
                    value={row.city}
                    onChange={(event) =>
                      setCityPricing((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, city: event.target.value } : item
                        )
                      )
                    }
                    placeholder="Toronto"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Flat fee / hour</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 text-sm outline-none transition focus:border-[#2563EB]"
                    value={row.flatFee}
                    onChange={(event) =>
                      setCityPricing((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, flatFee: Number(event.target.value || 0) } : item
                        )
                      )
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Minimum hours</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 text-sm outline-none transition focus:border-[#2563EB]"
                    value={row.minHours}
                    onChange={(event) =>
                      setCityPricing((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, minHours: Number(event.target.value || 1) } : item
                        )
                      )
                    }
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => setCityPricing((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    className="w-full rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-700"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No city overrides yet" description="Add a city override only when one city needs pricing that differs from its province or territory default." />
        )}
      </Panel>
    </AdminShell>
  );
}
