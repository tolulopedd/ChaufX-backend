"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell, Panel } from "../../components/admin-shell";
import { EmptyState, StatCard, StatusPill } from "../../components/admin-primitives";
import { adminFetch, fetchAdminDocumentLink, useAdminResource } from "../../lib/api";

function formatApplicationStatus(status?: string) {
  return (status ?? "SUBMITTED").replaceAll("_", " ");
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Date(value).toLocaleDateString();
}

function parseApplicationDetails(rawText?: string | null) {
  if (!rawText) {
    return {};
  }

  return Object.fromEntries(
    rawText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(":");
        if (separator === -1) {
          return [line, ""];
        }

        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
  ) as Record<string, string>;
}

function DetailField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white px-4 py-4">
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className="mt-2 text-sm font-medium leading-6 text-slate-950">{value && value.length ? value : "Not provided"}</div>
    </div>
  );
}

function DetailSection({
  title,
  fields
}: {
  title: string;
  fields: Array<{ label: string; value?: string | null }>;
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

export default function ApplicationsPage() {
  const { data, error, loading, reload } = useAdminResource<any[]>("/admin/applications", []);
  const [selectedId, setSelectedId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewAction, setReviewAction] = useState<{
    applicationId: string;
    decision: "approved" | "rejected" | "additional_info";
    title: string;
    prompt: string;
  } | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [preview, setPreview] = useState<{
    title: string;
    fileName: string;
    src: string;
    mimeType: string;
  } | null>(null);

  useEffect(() => {
    if (!data.length || !selectedId) {
      setSelectedId("");
      return;
    }

    if (!data.some((application) => application.id === selectedId)) {
      setSelectedId("");
    }
  }, [data, selectedId]);

  const selectedApplication = useMemo(
    () => data.find((application) => application.id === selectedId) ?? null,
    [data, selectedId]
  );
  const selectedApplicationDetails = useMemo(
    () => parseApplicationDetails(selectedApplication?.availabilitySchedule),
    [selectedApplication?.availabilitySchedule]
  );
  const reviewLocked =
    selectedApplication?.status === "APPROVED" || selectedApplication?.status === "REJECTED";

  const submittedCount = data.filter((application) => application.status === "SUBMITTED").length;
  const underReviewCount = data.filter((application) => application.status === "UNDER_REVIEW").length;

  async function review(applicationId: string, decision: "approved" | "rejected" | "additional_info", note: string) {
    setBusyId(applicationId);

    try {
      await adminFetch(`/admin/applications/${applicationId}/review`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          note
        })
      });
      await reload();
      setNotice(
        decision === "approved"
          ? "Application approved successfully."
          : decision === "rejected"
            ? "Application rejected successfully."
            : "Additional information request sent successfully."
      );
    } finally {
      setBusyId("");
    }
  }

  async function previewDocument(documentId: string, fileName: string) {
    setBusyId(documentId);

    try {
      const result = await fetchAdminDocumentLink(documentId);
      setPreview({
        title: fileName,
        fileName,
        src: result.url,
        mimeType: result.mimeType || "application/octet-stream"
      });
    } finally {
      setBusyId("");
    }
  }

  return (
    <AdminShell
      title="Driver applications"
      description="Review each onboarding submission, inspect uploaded documents, and approve or reject without leaving the application details."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <StatCard title="Applications" value={data.length} detail="Total onboarding files currently available for admin review." />
        <StatCard title="Submitted" value={submittedCount} detail="New driver applications waiting for the first review pass." />
        <StatCard title="Under review" value={underReviewCount} detail="Applications already opened and currently being verified." />
      </div>

      <Panel title="Drivers Applications" subtitle="Select any application row to open the full submitted details and document set.">
        {loading ? <p className="text-sm text-slate-500">Loading applications...</p> : null}
        {error ? <p className="text-sm text-amber-600">{error}</p> : null}
        {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}

        {data.length ? (
          <div className="space-y-4">
            <div className="space-y-3">
              {data.map((application) => {
                return (
                  <button
                    key={application.id}
                    type="button"
                    onClick={() => setSelectedId(application.id)}
                    className="w-full rounded-[24px] border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-4 text-left transition hover:border-[#D6DCEF] hover:bg-white"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-base font-semibold tracking-[-0.03em] text-slate-950">{application.fullName}</div>
                        <div className="mt-1 truncate text-sm text-slate-500">{application.email}</div>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                          <span>{application.phone}</span>
                          <span>{application.preferredServiceAreas?.[0] ?? "No province selected"}</span>
                          <span>{application.documents.length} document{application.documents.length === 1 ? "" : "s"}</span>
                          <span>Submitted {formatDate(application.createdAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusPill
                          label={formatApplicationStatus(application.status)}
                          tone={application.status === "APPROVED" ? "emerald" : application.status === "REJECTED" ? "rose" : "amber"}
                        />
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4338CA]">Open</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <EmptyState title="No pending applications" description="New driver onboarding files will appear here once candidates submit their details." />
        )}
      </Panel>

      {selectedApplication ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0F172A]/70 px-5 py-8">
          <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-[32px] bg-white p-5 shadow-[0_40px_100px_-45px_rgba(15,23,42,0.5)]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">{selectedApplication.fullName}</h2>
                  <StatusPill
                    label={formatApplicationStatus(selectedApplication.status)}
                    tone={selectedApplication.status === "APPROVED" ? "emerald" : selectedApplication.status === "REJECTED" ? "rose" : "amber"}
                  />
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  {selectedApplication.email} · {selectedApplication.phone}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyId === selectedApplication.id || reviewLocked}
                  onClick={() => {
                    setReviewAction({
                      applicationId: selectedApplication.id,
                      decision: "approved",
                      title: "Approve application",
                      prompt: "Add a personal note to the driver for this approval."
                    });
                    setReviewNote("Your application has been approved. Welcome to ChaufX.");
                    setNotice("");
                  }}
                  className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busyId === selectedApplication.id || reviewLocked}
                  onClick={() => {
                    setReviewAction({
                      applicationId: selectedApplication.id,
                      decision: "rejected",
                      title: "Reject application",
                      prompt: "Add a rejection note to the driver. This message will be sent to the driver."
                    });
                    setReviewNote("");
                    setNotice("");
                  }}
                  className="rounded-2xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={busyId === selectedApplication.id || reviewLocked}
                  onClick={() => {
                    setReviewAction({
                      applicationId: selectedApplication.id,
                      decision: "additional_info",
                      title: "Request for additional information",
                      prompt: "Tell the driver extra details or documents are needed to proceed with this application"
                    });
                    setReviewNote("");
                    setNotice("");
                  }}
                  className="rounded-2xl border border-[#DCDDFF] bg-[#EEF0FF] px-4 py-2.5 text-sm font-semibold text-[#4338CA] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Ask for info
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedId("")}
                  className="rounded-2xl border border-[#E5E7EB] px-4 py-2.5 text-sm font-semibold text-slate-700"
                >
                  Close
                </button>
              </div>
            </div>

            {reviewLocked ? (
              <div className="mt-4 rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3 text-sm text-slate-500">
                This application has already been {String(selectedApplication.status).toLowerCase()}. No further review action is required.
              </div>
            ) : null}

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-4">
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Experience</div>
                <div className="mt-2 text-sm font-semibold text-slate-950">{selectedApplication.yearsOfExperience} years</div>
              </div>
              <div className="rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-4">
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Service areas</div>
                <div className="mt-2 text-sm font-semibold text-slate-950">
                  {selectedApplication.preferredServiceAreas.length ? selectedApplication.preferredServiceAreas.join(", ") : "Not provided"}
                </div>
              </div>
              <div className="rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-4">
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Submitted</div>
                <div className="mt-2 text-sm font-semibold text-slate-950">{formatDate(selectedApplication.createdAt)}</div>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              <DetailSection
                title="Personal information"
                fields={[
                  { label: "Full name", value: selectedApplication.fullName },
                  { label: "Email", value: selectedApplication.email },
                  { label: "Phone number", value: selectedApplication.phone },
                  { label: "Home address", value: selectedApplication.address },
                  { label: "Date of birth", value: selectedApplicationDetails["Date of birth"] },
                  { label: "Authorized to work in Canada", value: selectedApplicationDetails["Legally authorized to work in Canada"] }
                ]}
              />

              <DetailSection
                title="License & driving history"
                fields={[
                  { label: "License number", value: selectedApplication.licenseNumber },
                  { label: "Province of issue", value: selectedApplicationDetails["Province of issue"] },
                  { label: "License class", value: selectedApplicationDetails["License class"] },
                  { label: "License expiry date", value: selectedApplicationDetails["License expiry date"] },
                  { label: "Traffic violations", value: selectedApplicationDetails["Traffic violations"] },
                  { label: "License suspensions", value: selectedApplicationDetails["License suspensions"] },
                  { label: "At-fault accidents", value: selectedApplicationDetails["At-fault accidents"] },
                  { label: "DUI / impaired driving", value: selectedApplicationDetails["DUI / impaired driving"] }
                ]}
              />

              <DetailSection
                title="Experience & availability"
                fields={[
                  { label: "Professional experience", value: selectedApplicationDetails["Professional experience"] },
                  { label: "Previous employer", value: selectedApplicationDetails["Previous employer"] },
                  { label: "Preferred working hours", value: selectedApplicationDetails["Preferred working hours"] },
                  { label: "Availability per week", value: selectedApplicationDetails["Availability per week"] },
                  { label: "Service capability", value: selectedApplicationDetails["Service capability"] },
                  { label: "Health / emergency training", value: selectedApplicationDetails["Health / emergency training"] },
                  { label: "Owns a vehicle", value: selectedApplicationDetails["Owns a vehicle"] }
                ]}
              />

              <DetailSection
                title="Consent & signature"
                fields={[
                  { label: "Emergency contact", value: selectedApplication.emergencyContact },
                  { label: "Consent checks", value: selectedApplicationDetails["Consents - criminal"] },
                  { label: "Professional standards", value: selectedApplicationDetails["Professional standards acknowledged"] },
                  { label: "Proof of work authorization", value: selectedApplicationDetails["Proof of work authorization"] },
                  { label: "Signature", value: selectedApplicationDetails["Signature"] },
                  { label: "Application date", value: selectedApplicationDetails["Application date"] }
                ]}
              />

              <div className="rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-4">
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Uploaded documents</div>
                {selectedApplication.documents.length ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {selectedApplication.documents.map((document: any) => (
                      <div key={document.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-950">{document.fileName}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">{document.type.replaceAll("_", " ")}</div>
                        </div>
                        <button
                          type="button"
                          disabled={busyId === document.id}
                          onClick={() => previewDocument(document.id, document.fileName)}
                          className="rounded-2xl border border-[#C7D2FE] bg-[#EEF2FF] px-3 py-2 text-xs font-semibold text-[#4338CA] disabled:opacity-60"
                        >
                          View
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-slate-500">No uploaded documents yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/72 px-5 py-8">
          <div className="relative w-full max-w-5xl rounded-[32px] bg-white p-5 shadow-[0_40px_100px_-45px_rgba(15,23,42,0.5)]">
            <div className="flex items-center justify-between gap-4 border-b border-[#E5E7EB] pb-4">
              <div>
                <div className="text-sm font-semibold text-slate-950">{preview.title}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">{preview.mimeType || "Document preview"}</div>
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-full border border-[#E5E7EB] px-3 py-2 text-sm font-semibold text-slate-700"
              >
                Close
              </button>
            </div>

            <div className="mt-5 h-[75vh] overflow-hidden rounded-[24px] border border-[#E5E7EB] bg-[#F8FAFC]">
              {preview.mimeType.startsWith("image/") ? (
                <img src={preview.src} alt={preview.fileName} className="h-full w-full object-contain bg-white" />
              ) : (
                <iframe src={preview.src} title={preview.fileName} className="h-full w-full bg-white" />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {reviewAction ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/70 px-5 py-8">
          <div className="w-full max-w-2xl rounded-[32px] bg-white p-6 shadow-[0_40px_100px_-45px_rgba(15,23,42,0.5)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#4338CA]">Review action</div>
                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-slate-950">{reviewAction.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{reviewAction.prompt}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setReviewAction(null);
                  setReviewNote("");
                }}
                className="rounded-full border border-[#E5E7EB] px-3 py-2 text-sm font-semibold text-slate-700"
              >
                Close
              </button>
            </div>

            <textarea
              className="mt-5 min-h-40 w-full rounded-[24px] border border-[#E5E7EB] px-4 py-4 text-sm leading-6 outline-none transition focus:border-[#2563EB]"
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              placeholder="Write your message here"
            />

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setReviewAction(null);
                  setReviewNote("");
                }}
                className="rounded-2xl border border-[#E5E7EB] px-4 py-3 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!reviewNote.trim() || busyId === reviewAction.applicationId}
                onClick={async () => {
                  try {
                    await review(reviewAction.applicationId, reviewAction.decision, reviewNote.trim());
                    setReviewAction(null);
                    setReviewNote("");
                  } catch (reason) {
                    setNotice(reason instanceof Error ? reason.message : "Unable to complete review action.");
                  }
                }}
                className="rounded-2xl bg-[#2563EB] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyId === reviewAction.applicationId ? "Sending..." : "Send update"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
