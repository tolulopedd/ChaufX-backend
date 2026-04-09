"use client";

import { useEffect, useMemo, useState } from "react";
import { appConfig, toCurrency } from "@driveme/config";
import { AdminShell, Panel } from "../../components/admin-shell";
import { EmptyState, StatCard, StatusPill } from "../../components/admin-primitives";
import { adminFetch, useAdminResource } from "../../lib/api";

const statusToneMap: Record<string, "violet" | "amber" | "emerald" | "rose" | "navy" | "neutral"> = {
  PENDING: "amber",
  ACCEPTED: "violet",
  ENROUTE: "navy",
  ACTIVE: "emerald",
  COMPLETED: "emerald",
  CANCELLED: "rose"
};

function getLifecycleActions(status: string) {
  switch (status) {
    case "PENDING":
      return [{ label: "Cancel booking", status: "CANCELLED" }];
    case "ACCEPTED":
      return [
        { label: "Mark enroute", status: "ENROUTE" },
        { label: "Cancel booking", status: "CANCELLED" }
      ];
    case "ENROUTE":
      return [
        { label: "Start trip", status: "ACTIVE" },
        { label: "Cancel booking", status: "CANCELLED" }
      ];
    case "ACTIVE":
      return [{ label: "Complete trip", status: "COMPLETED" }];
    case "COMPLETED":
    case "CANCELLED":
      return [{ label: "Reopen as pending", status: "PENDING" }];
    default:
      return [];
  }
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white px-4 py-4">
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className="mt-2 text-sm font-medium leading-6 text-slate-950">{value}</div>
    </div>
  );
}

function DetailSection({
  title,
  fields
}: {
  title: string;
  fields: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="rounded-2xl border border-white bg-white px-4 py-4">
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">{title}</div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {fields.map((field) => (
          <DetailField key={field.label} label={field.label} value={field.value} />
        ))}
      </div>
    </div>
  );
}

export default function BookingsPage() {
  const { data: bookings, error, loading, reload } = useAdminResource<any[]>("/admin/bookings", []);
  const { data: drivers } = useAdminResource<any[]>("/admin/drivers", []);
  const [selectedId, setSelectedId] = useState("");
  const [selectedDriver, setSelectedDriver] = useState<Record<string, string>>({});
  const [busyBookingId, setBusyBookingId] = useState("");

  const assignedCount = bookings.filter((booking) => booking.assignedDriverId).length;
  const unassignedCount = bookings.length - assignedCount;
  const activeCount = bookings.filter((booking) => ["ACCEPTED", "ENROUTE", "ACTIVE"].includes(String(booking.status))).length;

  useEffect(() => {
    const defaults: Record<string, string> = {};
    for (const booking of bookings) {
      defaults[booking.id] = booking.assignedDriverId ?? drivers[0]?.id ?? "";
    }
    setSelectedDriver(defaults);
  }, [bookings, drivers]);

  useEffect(() => {
    if (!bookings.length) {
      setSelectedId("");
      return;
    }

    if (!selectedId || !bookings.some((booking) => booking.id === selectedId)) {
      setSelectedId(bookings[0].id);
    }
  }, [bookings, selectedId]);

  const selectedBooking = useMemo(
    () => bookings.find((booking) => booking.id === selectedId) ?? null,
    [bookings, selectedId]
  );

  async function updateBookingStatus(bookingId: string, status: string) {
    setBusyBookingId(bookingId);

    try {
      await adminFetch(`/admin/bookings/${bookingId}/status`, {
        method: "POST",
        body: JSON.stringify({ status })
      });
      await reload();
    } finally {
      setBusyBookingId("");
    }
  }

  async function assignDriver(bookingId: string) {
    const driverId = selectedDriver[bookingId];
    if (!driverId) {
      return;
    }

    setBusyBookingId(bookingId);

    try {
      await adminFetch(`/bookings/${bookingId}/assign-driver`, {
        method: "POST",
        body: JSON.stringify({ driverId })
      });
      await reload();
    } finally {
      setBusyBookingId("");
    }
  }

  return (
    <AdminShell
      title="Bookings"
      description="Monitor driver-led acceptance, review trip details, and use manual assignment only when operations needs to override the normal flow."
    >
      <div className="grid gap-4 lg:grid-cols-4">
        <StatCard title="Total bookings" value={bookings.length} detail="Every booking currently available to operations." />
        <StatCard title="Assigned" value={assignedCount} detail="Bookings already matched to a driver." />
        <StatCard title="Needs assignment" value={unassignedCount} detail="Trips still waiting on manual or automatic assignment." />
        <StatCard title="Live lifecycle" value={activeCount} detail="Trips in accepted, enroute, or active operation states." tone="dark" />
      </div>

      <Panel title="Bookings queue" subtitle="Select any booking row to review the full trip details and lifecycle actions.">
        {loading ? <p className="text-sm text-slate-500">Loading bookings...</p> : null}
        {error ? <p className="text-sm text-amber-600">{error}</p> : null}

        {bookings.length ? (
          <div className="space-y-4">
            <div className="space-y-3">
              {bookings.map((booking) => {
                const active = booking.id === selectedId;

                return (
                  <button
                    key={booking.id}
                    type="button"
                    onClick={() => setSelectedId(booking.id)}
                    className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
                      active
                        ? "border-[#C7D2FE] bg-[#EEF2FF]"
                        : "border-[#E5E7EB] bg-[#F8FAFC] hover:border-[#D6DCEF] hover:bg-white"
                    }`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-base font-semibold tracking-[-0.03em] text-slate-950">
                          {booking.pickupLocation} to {booking.destinationLocation}
                        </div>
                        <div className="mt-1 truncate text-sm text-slate-500">
                          {booking.customer.user.fullName} · {new Date(booking.scheduledStartAt).toLocaleString()}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                          <span>{booking.assignedDriver?.user.fullName ?? "Unassigned"}</span>
                          <span>{toCurrency(Number(booking.fareEstimate), "CAD")}</span>
                          <span>{booking.dispatches?.length ?? 0} routed driver{booking.dispatches?.length === 1 ? "" : "s"}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusPill label={booking.status} tone={statusToneMap[String(booking.status)] ?? "neutral"} />
                        {active ? <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4338CA]">Selected</span> : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedBooking ? (
              <div className="rounded-[28px] border border-[#E5E7EB] bg-[#F8FAFC] p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">
                        {selectedBooking.pickupLocation} to {selectedBooking.destinationLocation}
                      </h2>
                      <StatusPill label={selectedBooking.status} tone={statusToneMap[String(selectedBooking.status)] ?? "neutral"} />
                    </div>
                    <p className="mt-2 text-sm text-slate-500">
                      {selectedBooking.customer.user.fullName} · {new Date(selectedBooking.scheduledStartAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {getLifecycleActions(String(selectedBooking.status)).map((action) => (
                      <button
                        key={action.status}
                        type="button"
                        className={`rounded-2xl px-4 py-2.5 text-sm font-semibold ${
                          action.status === "CANCELLED"
                            ? "border border-rose-200 bg-rose-50 text-rose-700"
                            : action.status === "COMPLETED"
                              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border border-[#DCDDFF] bg-[#EEF0FF] text-[#4338CA]"
                        }`}
                        onClick={() => updateBookingStatus(selectedBooking.id, action.status)}
                        disabled={busyBookingId === selectedBooking.id}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-5 space-y-4">
                  <DetailSection
                    title="Booking overview"
                    fields={[
                      { label: "Customer", value: selectedBooking.customer.user.fullName },
                      { label: "Assigned driver", value: selectedBooking.assignedDriver?.user.fullName ?? "Unassigned" },
                      { label: "Estimated fare", value: toCurrency(Number(selectedBooking.fareEstimate), "CAD") },
                      { label: "Vehicle", value: selectedBooking.vehicleDetails ?? "Customer vehicle" },
                      { label: "Scheduled start", value: new Date(selectedBooking.scheduledStartAt).toLocaleString() },
                      { label: "Map unlock", value: new Date(selectedBooking.activationWindowStartAt).toLocaleString() }
                    ]}
                  />

                  <DetailSection
                    title="Routing & operations"
                    fields={[
                      { label: "Routed drivers", value: `${selectedBooking.dispatches?.length ?? 0}` },
                      {
                        label: "Nearest-driver routing",
                        value:
                          "DriveMe routes this booking to the nearest eligible online drivers first. Admin steps in only when an override is needed."
                      },
                      {
                        label: "Trip tool activation",
                        value: `Driver navigation unlocks ${appConfig.tripActivationMinutesBeforeStart} minutes before start and remains available until completion or cancellation.`
                      },
                      { label: "Payment status", value: selectedBooking.payment?.status ?? "Not recorded" }
                    ]}
                  />

                  {selectedBooking.dispatches?.length ? (
                    <div className="rounded-2xl border border-white bg-white px-4 py-4">
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Routed drivers</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedBooking.dispatches.map((dispatch: any) => (
                          <div key={dispatch.id} className="rounded-full border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2 text-xs font-medium text-slate-600">
                            {dispatch.driver.user.fullName}
                            {typeof dispatch.distanceKm === "number" ? ` · ${dispatch.distanceKm} km` : ""}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selectedBooking.specialNotes ? (
                    <div className="rounded-2xl border border-white bg-white px-4 py-4">
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Trip notes</div>
                      <div className="mt-3 text-sm leading-6 text-slate-600">{selectedBooking.specialNotes}</div>
                    </div>
                  ) : null}

                  {!selectedBooking.assignedDriverId ? (
                    <div className="rounded-2xl border border-white bg-white px-4 py-4">
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Admin override</div>
                      <div className="mt-2 text-sm leading-6 text-slate-600">
                        Manually assign a driver only if dispatch needs to override the normal driver-led acceptance flow.
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                        <select
                          value={selectedDriver[selectedBooking.id] ?? ""}
                          onChange={(event) =>
                            setSelectedDriver((current) => ({
                              ...current,
                              [selectedBooking.id]: event.target.value
                            }))
                          }
                          className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3"
                        >
                          <option value="">Select driver</option>
                          {drivers.map((driver) => (
                            <option key={driver.id} value={driver.id}>
                              {driver.user.fullName}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="rounded-2xl bg-[#4F46E5] px-4 py-3 text-sm font-semibold text-white"
                          onClick={() => assignDriver(selectedBooking.id)}
                          disabled={busyBookingId === selectedBooking.id}
                        >
                          {busyBookingId === selectedBooking.id ? "Working..." : "Assign override"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <EmptyState title="Select a booking" description="Pick any row from the bookings queue to review the trip lifecycle and actions." />
            )}
          </div>
        ) : (
          <EmptyState title="No bookings found" description="Bookings will appear here once owners begin requesting drivers." />
        )}
      </Panel>
    </AdminShell>
  );
}
