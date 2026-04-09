"use client";

import { AdminShell, Panel } from "../../components/admin-shell";
import { EmptyState, StatCard, StatusPill } from "../../components/admin-primitives";
import { dashboardFallback, useAdminResource } from "../../lib/api";

function TripMap({ trip }: { trip: any }) {
  const originX = 40;
  const originY = 60;
  const destinationX = 250;
  const destinationY = 150;

  return (
    <div className="rounded-[28px] border border-[#E5E7EB] bg-[#F8FAFC] p-4">
      <svg viewBox="0 0 320 200" className="h-48 w-full rounded-3xl bg-[linear-gradient(145deg,#EEF0FF,#ffffff)]">
        <defs>
          <linearGradient id={`route-${trip.id}`} x1="0%" x2="100%">
            <stop offset="0%" stopColor="#4F46E5" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <circle cx={originX} cy={originY} r="12" fill="#4F46E5" opacity="0.9" />
        <circle cx={destinationX} cy={destinationY} r="12" fill="#10b981" opacity="0.9" />
        <path d={`M ${originX} ${originY} Q 160 20 ${destinationX} ${destinationY}`} stroke={`url(#route-${trip.id})`} strokeWidth="6" fill="none" strokeLinecap="round" />
      </svg>
      <div className="mt-3 text-sm font-semibold text-slate-950">{trip.assignedDriver?.user.fullName ?? "Assigned driver"}</div>
      <div className="mt-1 text-sm text-slate-500">
        {trip.pickupLocation} to {trip.destinationLocation}
      </div>
    </div>
  );
}

export default function TripsPage() {
  const { data, loading, error } = useAdminResource("/admin/dashboard", dashboardFallback);

  return (
    <AdminShell
      title="Active trips map"
      description="Operations view of currently active trips. The admin overview shows live trip surfaces while the underlying live tracking remains window-gated."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <StatCard title="Active trips" value={data.activeTrips.length} detail="Trips currently visible to operations monitoring." />
        <StatCard title="Map visibility" value="Window-gated" detail="Live trip surfaces remain locked until the accepted trip reaches its activation window." />
        <StatCard title="Routing model" value="Overview only" detail="Admin sees monitoring surfaces while driver navigation stays bound to the trip lifecycle." tone="dark" />
      </div>

      <Panel title="Monitoring surface" subtitle="A simplified map view for trips currently active in the system.">
        {loading ? <p className="text-sm text-slate-500">Loading active trips...</p> : null}
        {error ? <p className="text-sm text-amber-600">{error}</p> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {data.activeTrips.length ? (
            data.activeTrips.map((trip: any) => (
              <div key={trip.id} className="space-y-3">
                <TripMap trip={trip} />
                <div className="flex items-center justify-between rounded-[24px] border border-[#E5E7EB] bg-white px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-950">{trip.assignedDriver?.user.fullName ?? "Awaiting driver"}</div>
                    <div className="text-sm text-slate-500">
                      {trip.pickupLocation} to {trip.destinationLocation}
                    </div>
                  </div>
                  <StatusPill label={trip.status} tone="violet" />
                </div>
              </div>
            ))
          ) : (
            <EmptyState title="No active trips to monitor" description="Once a trip is accepted and enters the active window, it will appear here." />
          )}
        </div>
      </Panel>
    </AdminShell>
  );
}
