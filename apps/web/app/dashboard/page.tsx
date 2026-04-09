"use client";

import { AdminShell, Panel } from "../../components/admin-shell";
import { EmptyState, StatCard, StatusPill } from "../../components/admin-primitives";
import { dashboardFallback, useAdminResource } from "../../lib/api";

export default function DashboardPage() {
  const { data, loading, error } = useAdminResource("/admin/dashboard", dashboardFallback);

  const metrics = [
    {
      title: "Total users",
      value: data.metrics.totalUsers,
      detail: "Combined owner, driver, and admin accounts currently in the platform."
    },
    {
      title: "Approved drivers",
      value: data.metrics.totalDrivers,
      detail: "Drivers eligible for assignment after onboarding and review clearance."
    },
    {
      title: "Pending review",
      value: data.metrics.pendingApplications,
      detail: "Applications still waiting on document or identity decisions."
    },
    {
      title: "Active bookings",
      value: data.metrics.activeBookings,
      detail: "Trips currently accepted, en route, or in progress."
    }
  ];

  return (
    <AdminShell
      title="Dashboard"
      description="Overview of current active users, approved drivers, pending drivers onboardings, and active bookings."
    >
      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-4 md:grid-cols-2">
          {metrics.map((metric) => (
            <StatCard key={metric.title} title={metric.title} value={metric.value} detail={metric.detail} />
          ))}
        </div>

        <StatCard
          title="Recorded revenue"
          value={`$${Number(data.metrics.revenue).toFixed(2)}`}
          detail="Recorded payments only. Gateway settlement and payout reconciliation can plug into this model later."
          tone="dark"
        />
      </div>

      <Panel title="Active trips" subtitle="Monitor the trips that currently require operational visibility.">
        {loading ? <p className="text-sm text-slate-500">Loading dashboard...</p> : null}
        {error ? <p className="text-sm text-amber-600">{error}</p> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {data.activeTrips.length ? (
            data.activeTrips.map((trip: any) => (
              <div key={trip.id} className="rounded-[28px] border border-[#E5E7EB] bg-[#F8FAFC] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#4338CA]">Active route</div>
                    <div className="mt-2 text-lg font-semibold tracking-[-0.04em] text-slate-950">{trip.pickupLocation}</div>
                    <div className="text-sm text-slate-500">to {trip.destinationLocation}</div>
                  </div>
                  <StatusPill label={trip.status} tone="violet" />
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white bg-white px-4 py-3">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Assigned driver</div>
                    <div className="mt-2 text-sm font-semibold text-slate-950">{trip.assignedDriver?.user.fullName ?? "Awaiting driver"}</div>
                  </div>
                  <div className="rounded-2xl border border-white bg-white px-4 py-3">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Trip state</div>
                    <div className="mt-2 text-sm font-semibold text-slate-950">{trip.status}</div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <EmptyState title="No active trips" description="Once a booking is accepted and enters the operating window, it will appear here for operations monitoring." />
          )}
        </div>
      </Panel>
    </AdminShell>
  );
}
