"use client";

import { AdminShell, Panel } from "../../components/admin-shell";
import { EmptyState, StatCard, StatusPill } from "../../components/admin-primitives";
import { useAdminResource } from "../../lib/api";

export default function DriversPage() {
  const { data, error, loading } = useAdminResource<any[]>("/admin/drivers", []);
  const availableCount = data.filter((driver) => driver.availabilityStatus).length;
  const assignedCount = data.reduce((sum, driver) => sum + driver.bookings.length, 0);

  return (
    <AdminShell title="Drivers" description="Review approved driver accounts, current availability, and active assignment load.">
      <div className="grid gap-4 lg:grid-cols-3">
        <StatCard title="Approved drivers" value={data.length} detail="Drivers already activated for trip assignment." />
        <StatCard title="Available now" value={availableCount} detail="Drivers currently toggled online to receive requests." />
        <StatCard title="Open assignments" value={assignedCount} detail="Active bookings currently attached to the roster." />
      </div>

      <Panel title="Driver roster" subtitle="A live view of approved operators, service coverage, and assignment load.">
        {loading ? <p className="text-sm text-slate-500">Loading drivers...</p> : null}
        {error ? <p className="text-sm text-amber-600">{error}</p> : null}
        {data.length ? (
          <div className="space-y-4">
            {data.map((driver) => (
              <div key={driver.id} className="rounded-[28px] border border-[#E5E7EB] bg-[#F8FAFC] p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-lg font-semibold tracking-[-0.04em] text-slate-950">{driver.user.fullName}</div>
                    <div className="mt-1 text-sm text-slate-500">{driver.user.email}</div>
                  </div>
                  <StatusPill label={driver.availabilityStatus ? "Available" : "Offline"} tone={driver.availabilityStatus ? "emerald" : "neutral"} />
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-white bg-white px-4 py-3">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Service areas</div>
                    <div className="mt-2 text-sm font-semibold text-slate-950">{driver.serviceAreas.join(", ")}</div>
                  </div>
                  <div className="rounded-2xl border border-white bg-white px-4 py-3">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Assignments</div>
                    <div className="mt-2 text-sm font-semibold text-slate-950">{driver.bookings.length} active assignment(s)</div>
                  </div>
                  <div className="rounded-2xl border border-white bg-white px-4 py-3">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Coverage status</div>
                    <div className="mt-2 text-sm font-semibold text-slate-950">
                      {driver.availabilityStatus ? "Receiving nearby booking requests" : "Hidden from new demand"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No approved drivers yet" description="Approved operators will appear here once onboarding decisions are completed." />
        )}
      </Panel>
    </AdminShell>
  );
}
