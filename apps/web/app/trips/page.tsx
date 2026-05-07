"use client";

import { useMemo, useState } from "react";
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
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Date(value).toLocaleString();
}

function formatDateInputValue(value?: string | null) {
  if (!value) {
    return "";
  }

  return new Date(value).toISOString().slice(0, 10);
}

function requestTypeLabel(value?: string) {
  return value === "LATER" ? "Schedule later" : "ChaufX now";
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white px-4 py-4">
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className="mt-2 text-sm font-medium leading-6 text-slate-950">{value}</div>
    </div>
  );
}

export default function TripsPage() {
  const { data, loading, error } = useAdminResource("/admin/dashboard", dashboardFallback);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [requestTypeFilter, setRequestTypeFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState("");

  const filteredTrips = useMemo(() => {
    const query = search.trim().toLowerCase();

    return data.activeTrips.filter((trip: any) => {
      if (dateFilter && formatDateInputValue(trip.scheduledStartAt) !== dateFilter) {
        return false;
      }

      if (requestTypeFilter !== "ALL" && trip.requestType !== requestTypeFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        trip.assignedDriver?.user?.fullName,
        trip.customer?.user?.fullName,
        trip.pickupLocation,
        trip.destinationLocation,
        trip.status
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [data.activeTrips, dateFilter, requestTypeFilter, search]);

  const selectedTrip = useMemo<any | null>(
    () => filteredTrips.find((trip: any) => trip.id === selectedId) ?? data.activeTrips.find((trip: any) => trip.id === selectedId) ?? null,
    [data.activeTrips, filteredTrips, selectedId]
  );

  return (
    <AdminShell
      title="Active trips"
      description="Simple monitoring view for trips currently in motion, with filters and details only when you choose to open a trip."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <StatCard title="Active trips" value={data.activeTrips.length} detail="Trips currently visible to operations monitoring." />
        <StatCard title="Map visibility" value="Window-gated" detail="Live trip surfaces remain locked until the accepted trip reaches its activation window." />
        <StatCard title="Monitoring mode" value="Overview only" detail="Admin sees active trip monitoring while driver navigation remains trip-window based." tone="dark" />
      </div>

      <Panel title="Active trips list" subtitle="Filter active trips by driver, customer, route, or date and open only the trip you want to inspect.">
        {loading ? <p className="text-sm text-slate-500">Loading active trips...</p> : null}
        {error ? <p className="text-sm text-amber-600">{error}</p> : null}

        <div className="mb-4 grid gap-3 md:grid-cols-[1.3fr_0.8fr_0.8fr]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by driver, customer, pickup, destination"
            className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#4F46E5]"
          />
          <select
            value={requestTypeFilter}
            onChange={(event) => setRequestTypeFilter(event.target.value)}
            className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#4F46E5]"
          >
            <option value="ALL">All request types</option>
            <option value="NOW">ChaufX now</option>
            <option value="LATER">Schedule later</option>
          </select>
          <input
            type="date"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
            className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#4F46E5]"
          />
        </div>

        {filteredTrips.length ? (
          <div className="space-y-3">
            {filteredTrips.map((trip: any) => (
              <button
                key={trip.id}
                type="button"
                onClick={() => setSelectedId(trip.id)}
                className="w-full rounded-[24px] border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-4 text-left transition hover:border-[#D6DCEF] hover:bg-white"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold tracking-[-0.03em] text-slate-950">
                      {trip.pickupLocation} to {trip.destinationLocation}
                    </div>
                    <div className="mt-1 truncate text-sm text-slate-500">
                      {trip.assignedDriver?.user?.fullName ?? "Assigned driver"} · {formatDate(trip.scheduledStartAt)}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                      <span>{trip.customer?.user?.fullName ?? "Customer not available"}</span>
                      <span>{requestTypeLabel(trip.requestType)}</span>
                      <span>{trip.status}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill label={trip.status} tone="violet" />
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4338CA]">Open</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="No active trips to monitor" description="Adjust your filters or wait for a trip to enter the active window." />
        )}
      </Panel>

      {selectedTrip ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0F172A]/70 px-5 py-8">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[32px] bg-white p-5 shadow-[0_40px_100px_-45px_rgba(15,23,42,0.5)]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">
                    {selectedTrip.pickupLocation} to {selectedTrip.destinationLocation}
                  </h2>
                  <StatusPill label={selectedTrip.status} tone="violet" />
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  {selectedTrip.assignedDriver?.user?.fullName ?? "Assigned driver"} · {formatDate(selectedTrip.scheduledStartAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedId("")}
                className="rounded-2xl border border-[#E5E7EB] px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <TripMap trip={selectedTrip} />

              <div className="grid gap-3 md:grid-cols-2">
                <DetailField label="Driver" value={selectedTrip.assignedDriver?.user?.fullName ?? "Assigned driver"} />
                <DetailField label="Customer" value={selectedTrip.customer?.user?.fullName ?? "Customer not available"} />
                <DetailField label="Request type" value={requestTypeLabel(selectedTrip.requestType)} />
                <DetailField label="Pickup" value={selectedTrip.pickupLocation} />
                <DetailField label="Destination" value={selectedTrip.destinationLocation} />
                <DetailField label="Trip status" value={selectedTrip.status} />
                <DetailField label="Scheduled start" value={formatDate(selectedTrip.scheduledStartAt)} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
