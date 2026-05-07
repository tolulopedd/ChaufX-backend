"use client";

import { useMemo, useState } from "react";
import { AdminShell, Panel } from "../../components/admin-shell";
import { EmptyState, StatCard, StatusPill } from "../../components/admin-primitives";
import { useAdminResource } from "../../lib/api";

type ReportRow = {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  dateLabel: string;
  dateValue?: string | null;
  status: string;
  provinces: string[];
};

const reportsFallback = {
  approvedDrivers: [],
  pendingApplications: [],
  activeCustomers: [],
  completedTrips: [],
  scheduledTrips: [],
  payments: [],
  ratings: []
};

const reportOptions = [
  { value: "approvedDrivers", label: "Approved drivers" },
  { value: "pendingApplications", label: "Pending onboarding drivers" },
  { value: "activeCustomers", label: "Active customers" },
  { value: "pendingPayments", label: "Payment pending to driver" },
  { value: "completedTrips", label: "Trips completed" },
  { value: "scheduledTrips", label: "Booked or scheduled trips" }
] as const;

function formatDateLabel(dateValue?: string | Date | null) {
  if (!dateValue) {
    return "Not recorded";
  }

  return new Date(dateValue).toLocaleDateString();
}

function normalizeForSearch(value: string) {
  return value.toLowerCase().trim();
}

export default function ReportsPage() {
  const { data, loading, error } = useAdminResource<any>("/admin/reports", reportsFallback);
  const [reportType, setReportType] = useState<(typeof reportOptions)[number]["value"]>("approvedDrivers");
  const [province, setProvince] = useState("all");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  const pendingPayments = useMemo(
    () => data.payments.filter((payment: any) => String(payment.status).toUpperCase() === "PENDING"),
    [data.payments]
  );

  const summaryCards = useMemo(
    () => [
      {
        title: "Approved drivers",
        value: data.approvedDrivers.length,
        detail: "Drivers approved with review dates ready for export."
      },
      {
        title: "Pending onboarding",
        value: data.pendingApplications.length,
        detail: "Driver applications waiting for review or follow-up."
      },
      {
        title: "Active customers",
        value: data.activeCustomers.filter((customer: any) => customer.bookings.length > 0).length,
        detail: "Customers with booking activity already on the platform."
      },
      {
        title: "Pending driver payments",
        value: pendingPayments.length,
        detail: "Payment records still waiting for settlement handling."
      },
      {
        title: "Trips completed",
        value: data.completedTrips.length,
        detail: "Completed bookings ready for reporting and reconciliation."
      },
      {
        title: "Booked or scheduled",
        value: data.scheduledTrips.length,
        detail: "Upcoming or in-progress bookings that still need monitoring."
      }
    ],
    [data.activeCustomers, data.approvedDrivers.length, data.completedTrips.length, data.pendingApplications.length, data.scheduledTrips.length, pendingPayments.length]
  );

  const rows = useMemo<ReportRow[]>(() => {
    switch (reportType) {
      case "approvedDrivers":
        return data.approvedDrivers.map((driver: any) => ({
          id: driver.id,
          title: driver.user?.fullName ?? "Approved driver",
          subtitle: [driver.user?.email, driver.user?.phone].filter(Boolean).join(" · "),
          meta: driver.serviceAreas?.length ? driver.serviceAreas.join(", ") : "No service province listed",
          dateLabel: "Approved",
          dateValue: driver.approvedAt,
          status: driver.user?.status ?? "ACTIVE",
          provinces: driver.serviceAreas ?? []
        }));

      case "pendingApplications":
        return data.pendingApplications.map((application: any) => ({
          id: application.id,
          title: application.fullName,
          subtitle: [application.email, application.phone].filter(Boolean).join(" · "),
          meta: application.preferredServiceAreas?.length ? application.preferredServiceAreas.join(", ") : "No province selected",
          dateLabel: "Submitted",
          dateValue: application.createdAt,
          status: application.status,
          provinces: application.preferredServiceAreas ?? []
        }));

      case "activeCustomers":
        return data.activeCustomers
          .filter((customer: any) => customer.bookings.length > 0)
          .map((customer: any) => ({
            id: customer.id,
            title: customer.user?.fullName ?? "Customer",
            subtitle: [customer.user?.email, customer.user?.phone].filter(Boolean).join(" · "),
            meta: `${customer.bookings.length} booking${customer.bookings.length === 1 ? "" : "s"} on record`,
            dateLabel: "Last booking",
            dateValue: customer.bookings[0]?.createdAt ?? customer.createdAt,
            status: customer.user?.status ?? "ACTIVE",
            provinces: []
          }));

      case "pendingPayments":
        return pendingPayments.map((payment: any) => ({
          id: payment.id,
          title: payment.booking?.assignedDriver?.user?.fullName ?? "Assigned driver pending",
          subtitle: `${payment.booking?.customer?.user?.fullName ?? "Customer"} · CAD ${Number(payment.amount).toFixed(2)}`,
          meta: payment.booking ? `${payment.booking.pickupLocation} to ${payment.booking.destinationLocation}` : "Booking payment",
          dateLabel: "Recorded",
          dateValue: payment.recordedAt ?? payment.createdAt,
          status: payment.status,
          provinces: []
        }));

      case "completedTrips":
        return data.completedTrips.map((booking: any) => ({
          id: booking.id,
          title: `${booking.pickupLocation} to ${booking.destinationLocation}`,
          subtitle: `${booking.customer?.user?.fullName ?? "Customer"} · ${booking.assignedDriver?.user?.fullName ?? "Driver not assigned"}`,
          meta: `CAD ${Number(booking.fareEstimate).toFixed(2)}`,
          dateLabel: "Completed",
          dateValue: booking.completedAt,
          status: booking.status,
          provinces: booking.assignedDriver?.serviceAreas ?? []
        }));

      case "scheduledTrips":
        return data.scheduledTrips.map((booking: any) => ({
          id: booking.id,
          title: `${booking.pickupLocation} to ${booking.destinationLocation}`,
          subtitle: `${booking.customer?.user?.fullName ?? "Customer"} · ${booking.assignedDriver?.user?.fullName ?? "Awaiting driver"}`,
          meta: `Scheduled ${new Date(booking.scheduledStartAt).toLocaleString()}`,
          dateLabel: "Booking date",
          dateValue: booking.createdAt,
          status: booking.status,
          provinces: booking.assignedDriver?.serviceAreas ?? []
        }));

      default:
        return [];
    }
  }, [data.activeCustomers, data.approvedDrivers, data.completedTrips, data.pendingApplications, data.scheduledTrips, pendingPayments, reportType]);

  const provinceOptions = useMemo(() => {
    const unique = Array.from(new Set(rows.flatMap((row) => row.provinces).filter(Boolean)));
    return unique.sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const statusOptions = useMemo(() => {
    const unique = Array.from(new Set(rows.map((row) => row.status).filter(Boolean)));
    return unique.sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const searchTerm = normalizeForSearch(search);

    return rows.filter((row) => {
      const rowDate = row.dateValue ? new Date(row.dateValue) : null;
      const afterStart = dateFrom ? (rowDate ? rowDate >= new Date(`${dateFrom}T00:00:00`) : false) : true;
      const beforeEnd = dateTo ? (rowDate ? rowDate <= new Date(`${dateTo}T23:59:59`) : false) : true;
      const matchesProvince = province === "all" ? true : row.provinces.includes(province);
      const matchesStatus = status === "all" ? true : row.status === status;
      const haystack = normalizeForSearch(`${row.title} ${row.subtitle} ${row.meta} ${row.status}`);
      const matchesSearch = searchTerm ? haystack.includes(searchTerm) : true;

      return afterStart && beforeEnd && matchesProvince && matchesStatus && matchesSearch;
    });
  }, [dateFrom, dateTo, province, rows, search, status]);

  const selectedReportLabel = reportOptions.find((option) => option.value === reportType)?.label ?? "Report";

  function downloadPdf() {
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=960,height=720");

    if (!printWindow) {
      return;
    }

    const filterSummary = [
      province !== "all" ? `Province/Territory: ${province}` : null,
      status !== "all" ? `Status: ${status}` : null,
      dateFrom ? `From: ${dateFrom}` : null,
      dateTo ? `To: ${dateTo}` : null,
      search ? `Search: ${search}` : null
    ]
      .filter(Boolean)
      .join(" | ");

    const rowsMarkup = filteredRows
      .map(
        (row) => `
          <div style="border:1px solid #e5e7eb;border-radius:18px;padding:16px;margin-bottom:12px;">
            <div style="font-size:18px;font-weight:700;color:#0f172a;">${row.title}</div>
            <div style="margin-top:6px;font-size:13px;color:#475569;">${row.subtitle}</div>
            <div style="margin-top:8px;font-size:13px;color:#64748b;">${row.meta}</div>
            <div style="margin-top:8px;font-size:12px;color:#334155;">${row.dateLabel}: ${formatDateLabel(row.dateValue)}</div>
            <div style="margin-top:8px;font-size:12px;font-weight:700;color:#4338ca;text-transform:uppercase;letter-spacing:0.14em;">${row.status}</div>
          </div>
        `
      )
      .join("");

    printWindow.document.write(`
      <html>
        <head>
          <title>${selectedReportLabel} - ChaufX Reports</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 32px; color: #0f172a; }
            h1 { margin: 0 0 8px; font-size: 28px; }
            p { margin: 0 0 18px; color: #475569; }
          </style>
        </head>
        <body>
          <h1>${selectedReportLabel}</h1>
          <p>ChaufX admin report export${filterSummary ? ` | ${filterSummary}` : ""}</p>
          ${rowsMarkup || "<p>No records match the selected filters.</p>"}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  return (
    <AdminShell title="Reports" description="Reports for onboarding, completed trips, payment records, and customer rating data.">
      <div className="grid gap-4 xl:grid-cols-3">
        {summaryCards.map((card, index) => (
          <StatCard key={card.title} title={card.title} value={card.value} detail={card.detail} tone={index === 3 ? "dark" : "light"} />
        ))}
      </div>

      <Panel
        title="Report filters"
        subtitle="Spool the exact report you need, then download the current result view as a PDF."
        aside={
          <button
            type="button"
            onClick={downloadPdf}
            className="rounded-2xl bg-[#2563EB] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_16px_32px_-18px_rgba(37,99,235,0.55)]"
          >
            Download PDF
          </button>
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Report type</span>
            <select className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#2563EB]" value={reportType} onChange={(event) => setReportType(event.target.value as typeof reportType)}>
              {reportOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Province/Territory</span>
            <select className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#2563EB]" value={province} onChange={(event) => setProvince(event.target.value)}>
              <option value="all">All provinces</option>
              {provinceOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Status</span>
            <select className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#2563EB]" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All statuses</option>
              {statusOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">From date</span>
            <input type="date" className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 text-sm outline-none transition focus:border-[#2563EB]" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">To date</span>
            <input type="date" className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 text-sm outline-none transition focus:border-[#2563EB]" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
        </div>

        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Search</span>
          <input
            className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 text-sm outline-none transition focus:border-[#2563EB]"
            placeholder="Search names, emails, routes, or booking notes"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </Panel>

      <Panel
        title={selectedReportLabel}
        subtitle={`${filteredRows.length} record${filteredRows.length === 1 ? "" : "s"} match the current filters.`}
      >
        {loading ? <p className="text-sm text-slate-500">Loading reports...</p> : null}
        {error ? <p className="text-sm text-amber-600">{error}</p> : null}
        {filteredRows.length ? (
          <div className="space-y-3">
            {filteredRows.map((row) => (
              <div key={row.id} className="flex flex-col gap-4 rounded-[24px] border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-base font-semibold tracking-[-0.03em] text-slate-950">{row.title}</div>
                  <div className="mt-1 text-sm text-slate-500">{row.subtitle}</div>
                  <div className="mt-2 text-sm text-slate-600">{row.meta}</div>
                </div>
                <div className="flex flex-col items-start gap-2 lg:items-end">
                  <StatusPill
                    label={row.status}
                    tone={
                      row.status === "APPROVED" || row.status === "ACTIVE" || row.status === "RECORDED"
                        ? "emerald"
                        : row.status === "PENDING" || row.status === "SUBMITTED" || row.status === "UNDER_REVIEW"
                          ? "amber"
                          : row.status === "REJECTED" || row.status === "FAILED" || row.status === "CANCELLED"
                            ? "rose"
                            : "violet"
                    }
                  />
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    {row.dateLabel}: {formatDateLabel(row.dateValue)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No records match the current filters" description="Adjust the report type, date range, province, or status filter to find the report you need." />
        )}
      </Panel>

      <Panel title="Customer ratings" subtitle="Recent customer feedback attached to completed trips.">
        {data.ratings.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.ratings.slice(0, 6).map((rating: any) => (
              <div key={rating.id} className="rounded-[24px] border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-950">{rating.reviewed?.fullName ?? "Reviewed driver"}</div>
                  <StatusPill label={`${rating.score}/5`} tone="violet" />
                </div>
                <div className="mt-2 text-sm text-slate-500">
                  From {rating.reviewer?.fullName ?? "Customer"} · Booking {rating.bookingId}
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-700">{rating.comment || "No comment provided."}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No rating records yet" description="Customer rating feedback will appear here once completed trips are reviewed." />
        )}
      </Panel>
    </AdminShell>
  );
}
