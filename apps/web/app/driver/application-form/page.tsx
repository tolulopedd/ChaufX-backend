"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PublicPageShell } from "../../../components/public-page-shell";
import { driverApply } from "../../../lib/api";

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

const experienceMap: Record<string, number> = {
  "1-2": 2,
  "3-5": 4,
  "5-10": 7,
  "10+": 10
};

const uploadAccept = ".pdf,.png,.jpg,.jpeg,.webp";

type DocumentUploadKey =
  | "driverLicenseFront"
  | "driverLicenseBack"
  | "driverAbstract"
  | "backgroundCheck"
  | "proofOfAddress"
  | "resume"
  | "workAuthorization"
  | "healthTrainingCertificate"
  | "signature";

const requiredUploadFields: DocumentUploadKey[] = [
  "driverLicenseFront",
  "driverLicenseBack",
  "driverAbstract",
  "backgroundCheck",
  "proofOfAddress"
];

const documentUploadFields: Array<{
  label: string;
  key: DocumentUploadKey;
  required: boolean;
}> = [
  { label: "* Valid Driver’s License (Front page)", key: "driverLicenseFront", required: true },
  { label: "* Valid Driver’s License (Back page)", key: "driverLicenseBack", required: true },
  { label: "* Driver’s Abstract (last 3 years)", key: "driverAbstract", required: true },
  { label: "* Criminal Background Check", key: "backgroundCheck", required: true },
  { label: "*Proof of Address (Utility Bill or Bank Statement)", key: "proofOfAddress", required: true },
  { label: "Resume (Optional but recommended)", key: "resume", required: false },
  { label: "Proof of Work Authorization (For Canadian temporary residents)", key: "workAuthorization", required: false },
  { label: "First Aid / CPR / PSW / Health or emergency training certificate", key: "healthTrainingCertificate", required: false }
];

async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Unable to read the selected file."));
    };

    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });
}

function DriverApplicationFormPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const verified = searchParams.get("verified") === "1";
  const [uploadedFiles, setUploadedFiles] = useState<Record<DocumentUploadKey, File | null>>({
    driverLicenseFront: null,
    driverLicenseBack: null,
    driverAbstract: null,
    backgroundCheck: null,
    proofOfAddress: null,
    resume: null,
    workAuthorization: null,
    healthTrainingCertificate: null,
    signature: null
  });
  const [form, setForm] = useState({
    verificationToken: searchParams.get("verificationToken") ?? "",
    firstName: searchParams.get("firstName") ?? "",
    lastName: searchParams.get("lastName") ?? "",
    phone: searchParams.get("phone") ?? "",
    email: searchParams.get("email") ?? "",
    dateOfBirth: "",
    address: "",
    city: "",
    postalCode: "",
    workAuthorized: "yes",
    licenseNumber: "",
    provinceOfIssue: "Manitoba",
    licenseClass: "G",
    licenseExpiryDate: "",
    experienceBand: "3-5",
    trafficViolations: "no",
    trafficViolationsNotes: "",
    licenseSuspensions: "no",
    licenseSuspensionsNotes: "",
    atFaultAccidents: "no",
    atFaultAccidentsNotes: "",
    duiHistory: "no",
    duiHistoryNotes: "",
    professionalExperience: [] as string[],
    previousEmployer: "no",
    employerName: "",
    employmentStartDate: "",
    employmentEndDate: "",
    currentlyWorkingThere: false,
    employerRole: "",
    employerProvince: "",
    employerCountry: "Canada",
    preferredWorkingHours: [] as string[],
    weeklyAvailability: "Flexible",
    serviceCapability: [] as string[],
    healthEmergencyTraining: "no",
    healthEmergencyTrainingDetails: "",
    ownVehicle: "no",
    criminalConsent: true,
    driverRecordConsent: true,
    identityConsent: true,
    professionalStandards: true,
    signatureName: "",
    applicationDate: new Date().toISOString().slice(0, 10),
    serviceProvince: "Manitoba"
  });

  const professionalExperienceOptions = useMemo(
    () => ["None", "Chauffeur Service", "Ride-share driving", "Delivery driving", "Corporate driving", "Customer service roles"],
    []
  );
  const workingHourOptions = useMemo(() => ["Weekdays", "Weekends", "Daytime", "Evening", "Late Night"], []);
  const serviceCapabilityOptions = useMemo(
    () => [
      "Drive client's personal vehicle",
      "Senior / assisted transportation",
      "Wait-and-return services",
      "Event / late-night driving",
      "Long-distance driving"
    ],
    []
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const missingDocuments = requiredUploadFields.filter((key) => !uploadedFiles[key]);

    if (missingDocuments.length > 0) {
      setError("Please upload all required documents before submitting your application.");
      setLoading(false);
      return;
    }

    if (!uploadedFiles.signature && !form.signatureName.trim()) {
      setError("Please upload your signature or type your full name as your signature before submitting.");
      setLoading(false);
      return;
    }

    if (form.healthEmergencyTraining === "yes" && !uploadedFiles.healthTrainingCertificate) {
      setError("Please upload your training certificate before submitting your application.");
      setLoading(false);
      return;
    }

    const notes = [
      `Date of birth: ${form.dateOfBirth || "Not provided"}`,
      `City / postal code: ${form.city || "Not provided"} / ${form.postalCode || "Not provided"}`,
      `Legally authorized to work in Canada: ${form.workAuthorized}`,
      `Province of issue: ${form.provinceOfIssue}`,
      `License class: ${form.licenseClass}`,
      `License expiry date: ${form.licenseExpiryDate || "Not provided"}`,
      `Traffic violations: ${form.trafficViolations === "yes" ? form.trafficViolationsNotes || "Yes" : "No"}`,
      `License suspensions: ${form.licenseSuspensions === "yes" ? form.licenseSuspensionsNotes || "Yes" : "No"}`,
      `At-fault accidents: ${form.atFaultAccidents === "yes" ? form.atFaultAccidentsNotes || "Yes" : "No"}`,
      `DUI / impaired driving: ${form.duiHistory === "yes" ? form.duiHistoryNotes || "Yes" : "No"}`,
      `Professional experience: ${form.professionalExperience.join(", ") || "Not provided"}`,
      `Previous employer: ${
        form.previousEmployer === "yes"
          ? `${form.employerName || "Not provided"} | ${form.employerRole || "Not provided"} | ${form.employerProvince || "Not provided"}, ${form.employerCountry || "Not provided"} | ${form.employmentStartDate || "Not provided"} to ${form.currentlyWorkingThere ? "Present" : form.employmentEndDate || "Not provided"}`
          : "No"
      }`,
      `Preferred working hours: ${form.preferredWorkingHours.join(", ") || "Not provided"}`,
      `Availability per week: ${form.weeklyAvailability}`,
      `Service capability: ${form.serviceCapability.join(", ") || "Not provided"}`,
      `Proof of work authorization: ${uploadedFiles.workAuthorization ? `Uploaded - ${uploadedFiles.workAuthorization.name}` : "Not provided"}`,
      `Health / emergency training: ${
        form.healthEmergencyTraining === "yes"
          ? `${form.healthEmergencyTrainingDetails || "Yes"} | Certificate: ${uploadedFiles.healthTrainingCertificate ? uploadedFiles.healthTrainingCertificate.name : "Not uploaded"}`
          : "No"
      }`,
      `Owns a vehicle: ${form.ownVehicle}`,
      `Consents - criminal: ${form.criminalConsent ? "Yes" : "No"}, driver record: ${form.driverRecordConsent ? "Yes" : "No"}, identity: ${form.identityConsent ? "Yes" : "No"}`,
      `Professional standards acknowledged: ${form.professionalStandards ? "Yes" : "No"}`,
      `Signature: ${uploadedFiles.signature ? `Uploaded - ${uploadedFiles.signature.name}` : form.signatureName || "Not provided"}`,
      `Application date: ${form.applicationDate || "Not provided"}`
    ].join("\n");

    try {
      const documents = await Promise.all(
        [
          ["DRIVER_LICENSE", "Driver license - front", uploadedFiles.driverLicenseFront],
          ["DRIVER_LICENSE", "Driver license - back", uploadedFiles.driverLicenseBack],
          ["OTHER", "Driver abstract", uploadedFiles.driverAbstract],
          ["BACKGROUND_CHECK", "Criminal background check", uploadedFiles.backgroundCheck],
          ["OTHER", "Proof of address", uploadedFiles.proofOfAddress],
          ["OTHER", "Resume", uploadedFiles.resume],
          ["OTHER", "Proof of work authorization", uploadedFiles.workAuthorization],
          ["OTHER", "Health or emergency training certificate", uploadedFiles.healthTrainingCertificate],
          ["OTHER", "Signature", uploadedFiles.signature]
        ]
          .filter(([, , file]) => file)
          .map(async ([type, label, file]) => {
            const uploadedFile = file as File;

            return {
              type,
              fileName: `${label} - ${uploadedFile.name}`,
              fileUrl: await fileToDataUrl(uploadedFile),
              mimeType: uploadedFile.type || undefined
            };
          })
      );

      await driverApply({
        verificationToken: form.verificationToken,
        fullName: `${form.firstName} ${form.lastName}`.trim(),
        phone: form.phone,
        email: form.email,
        address: `${form.address}, ${form.city}, ${form.postalCode}`,
        licenseNumber: form.licenseNumber,
        yearsOfExperience: experienceMap[form.experienceBand],
        emergencyContact: `${form.signatureName || "Applicant"} | ${form.phone}`,
        preferredServiceAreas: [form.serviceProvince],
        availabilitySchedule: notes,
        documents
      });

      router.push(`/driver/status?email=${encodeURIComponent(form.email)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to submit application");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PublicPageShell
      heroTitle="Driver application form"
      heroCopy="Complete the detailed ChaufX driver application form. Your finished submission is routed directly to the admin review module."
    >
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-5 py-12 md:px-8">
          <div className="rounded-[30px] border border-[#E5E7EB] bg-white p-7 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
            <div>
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Detailed onboarding</div>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">Complete your driver application</h1>
              {verified ? (
                <p className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  Your email has been verified. Kindly complete the onboarding application form.
                </p>
              ) : null}
              {!form.verificationToken ? (
                <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  Please verify your email from the link we sent before completing this application.
                </p>
              ) : null}
            </div>

            <form className="mt-8 space-y-8" onSubmit={onSubmit}>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">First name</span>
                  <input className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} required />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Last name</span>
                  <input className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} required />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Phone number</span>
                  <input className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} required />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
                  <input type="email" className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Date of birth</span>
                  <input type="date" className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.dateOfBirth} onChange={(event) => setForm((current) => ({ ...current, dateOfBirth: event.target.value }))} />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Legally authorized to work in Canada</span>
                  <select className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.workAuthorized} onChange={(event) => setForm((current) => ({ ...current, workAuthorized: event.target.value }))}>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Home address</span>
                  <input className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} required />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">City</span>
                  <input className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} required />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Postal code</span>
                  <input className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.postalCode} onChange={(event) => setForm((current) => ({ ...current, postalCode: event.target.value }))} required />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Driver&apos;s license number</span>
                  <input className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.licenseNumber} onChange={(event) => setForm((current) => ({ ...current, licenseNumber: event.target.value }))} required />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Province of issue</span>
                  <select className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.provinceOfIssue} onChange={(event) => setForm((current) => ({ ...current, provinceOfIssue: event.target.value }))}>
                    {provincesAndTerritories.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">License class</span>
                  <select className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.licenseClass} onChange={(event) => setForm((current) => ({ ...current, licenseClass: event.target.value }))}>
                    <option value="G">G</option>
                    <option value="G2">G2</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">License expiry date</span>
                  <input type="date" className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.licenseExpiryDate} onChange={(event) => setForm((current) => ({ ...current, licenseExpiryDate: event.target.value }))} />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Driving experience</span>
                  <select className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.experienceBand} onChange={(event) => setForm((current) => ({ ...current, experienceBand: event.target.value }))}>
                    <option value="1-2">1-2 years</option>
                    <option value="3-5">3-5 years</option>
                    <option value="5-10">5-10 years</option>
                    <option value="10+">10+ years</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Preferred service province/territory</span>
                  <select className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.serviceProvince} onChange={(event) => setForm((current) => ({ ...current, serviceProvince: event.target.value }))}>
                    {provincesAndTerritories.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {[
                  ["Traffic violations", "trafficViolations", "trafficViolationsNotes"],
                  ["License suspensions", "licenseSuspensions", "licenseSuspensionsNotes"],
                  ["At-fault accidents", "atFaultAccidents", "atFaultAccidentsNotes"],
                  ["DUI / impaired driving", "duiHistory", "duiHistoryNotes"]
                ].map(([label, key, notesKey]) => {
                  const hasIssue = form[key as keyof typeof form] === "yes";

                  return (
                    <div key={key} className="rounded-2xl border border-[#E5E7EB] p-4">
                      <span className="mb-3 block text-sm font-medium text-slate-700">{label}</span>
                      <div className="flex gap-3">
                        {[
                          ["yes", "Yes"],
                          ["no", "No"]
                        ].map(([value, text]) => (
                          <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="radio"
                              name={key}
                              value={value}
                              checked={form[key as keyof typeof form] === value}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  [key]: event.target.value,
                                  [notesKey]: event.target.value === "yes" ? current[notesKey as keyof typeof current] : ""
                                }))
                              }
                            />
                            {text}
                          </label>
                        ))}
                      </div>
                      {hasIssue ? (
                        <textarea
                          className="mt-3 min-h-24 w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]"
                          value={form[notesKey as keyof typeof form] as string}
                          onChange={(event) => setForm((current) => ({ ...current, [notesKey]: event.target.value }))}
                          placeholder="Please provide details"
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <span className="mb-2 block text-sm font-medium text-slate-700">Professional experience</span>
                  <div className="space-y-3 rounded-2xl border border-[#E5E7EB] p-4">
                    {professionalExperienceOptions.map((item) => (
                      <label key={item} className="flex items-center gap-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={form.professionalExperience.includes(item)}
                          onChange={() =>
                            setForm((current) => ({
                              ...current,
                              professionalExperience: current.professionalExperience.includes(item)
                                ? current.professionalExperience.filter((value) => value !== item)
                                : item === "None"
                                  ? ["None"]
                                  : [...current.professionalExperience.filter((value) => value !== "None"), item]
                            }))
                          }
                        />
                        {item}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="rounded-2xl border border-[#E5E7EB] p-4">
                    <span className="mb-3 block text-sm font-medium text-slate-700">Previous employer</span>
                    <div className="flex gap-3">
                      {[
                        ["yes", "Yes"],
                        ["no", "No"]
                      ].map(([value, text]) => (
                        <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="radio"
                            name="previousEmployer"
                            value={value}
                            checked={form.previousEmployer === value}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                previousEmployer: event.target.value,
                                employerName: event.target.value === "yes" ? current.employerName : "",
                                employmentStartDate: event.target.value === "yes" ? current.employmentStartDate : "",
                                employmentEndDate: event.target.value === "yes" ? current.employmentEndDate : "",
                                currentlyWorkingThere: event.target.value === "yes" ? current.currentlyWorkingThere : false,
                                employerRole: event.target.value === "yes" ? current.employerRole : "",
                                employerProvince: event.target.value === "yes" ? current.employerProvince : "",
                                employerCountry: event.target.value === "yes" ? current.employerCountry : "Canada"
                              }))
                            }
                          />
                          {text}
                        </label>
                      ))}
                    </div>
                  </div>

                  {form.previousEmployer === "yes" ? (
                    <div className="grid gap-4">
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-slate-700">Employer name</span>
                        <input className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.employerName} onChange={(event) => setForm((current) => ({ ...current, employerName: event.target.value }))} />
                      </label>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block text-sm font-medium text-slate-700">Employment start date</span>
                          <input type="date" className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.employmentStartDate} onChange={(event) => setForm((current) => ({ ...current, employmentStartDate: event.target.value }))} />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-sm font-medium text-slate-700">Employment end date</span>
                          <input type="date" disabled={form.currentlyWorkingThere} className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB] disabled:bg-slate-100" value={form.employmentEndDate} onChange={(event) => setForm((current) => ({ ...current, employmentEndDate: event.target.value }))} />
                        </label>
                      </div>
                      <label className="flex items-center gap-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={form.currentlyWorkingThere}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              currentlyWorkingThere: event.target.checked,
                              employmentEndDate: event.target.checked ? "" : current.employmentEndDate
                            }))
                          }
                        />
                        I still work there
                      </label>
                      <div className="grid gap-4 md:grid-cols-3">
                        <label className="block md:col-span-1">
                          <span className="mb-2 block text-sm font-medium text-slate-700">Role</span>
                          <input className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.employerRole} onChange={(event) => setForm((current) => ({ ...current, employerRole: event.target.value }))} />
                        </label>
                        <label className="block md:col-span-1">
                          <span className="mb-2 block text-sm font-medium text-slate-700">Province</span>
                          <select
                            className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 outline-none transition focus:border-[#2563EB]"
                            value={form.employerProvince}
                            onChange={(event) => setForm((current) => ({ ...current, employerProvince: event.target.value }))}
                          >
                            <option value="">Select province/territory</option>
                            {provincesAndTerritories.map((item) => (
                              <option key={item} value={item}>
                                {item}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block md:col-span-1">
                          <span className="mb-2 block text-sm font-medium text-slate-700">Country</span>
                          <input className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.employerCountry} onChange={(event) => setForm((current) => ({ ...current, employerCountry: event.target.value }))} />
                        </label>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <span className="mb-2 block text-sm font-medium text-slate-700">Preferred working hours</span>
                  <div className="space-y-3 rounded-2xl border border-[#E5E7EB] p-4">
                    {workingHourOptions.map((item) => (
                      <label key={item} className="flex items-center gap-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={form.preferredWorkingHours.includes(item)}
                          onChange={() =>
                            setForm((current) => ({
                              ...current,
                              preferredWorkingHours: current.preferredWorkingHours.includes(item)
                                ? current.preferredWorkingHours.filter((value) => value !== item)
                                : [...current.preferredWorkingHours, item]
                            }))
                          }
                        />
                        {item}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Availability per week</span>
                    <select className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.weeklyAvailability} onChange={(event) => setForm((current) => ({ ...current, weeklyAvailability: event.target.value }))}>
                      <option value="Part-time">Part-time</option>
                      <option value="Full-time">Full-time</option>
                      <option value="Flexible">Flexible</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Do you own a vehicle?</span>
                    <select className="w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.ownVehicle} onChange={(event) => setForm((current) => ({ ...current, ownVehicle: event.target.value }))}>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                </div>
              </div>

              <div>
                <span className="mb-2 block text-sm font-medium text-slate-700">Service capability- Are you comfortable with the following services?</span>
                <div className="grid gap-3 rounded-2xl border border-[#E5E7EB] p-4 md:grid-cols-2">
                  {serviceCapabilityOptions.map((item) => (
                    <label key={item} className="flex items-center gap-3 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.serviceCapability.includes(item)}
                        onChange={() =>
                          setForm((current) => ({
                            ...current,
                            serviceCapability: current.serviceCapability.includes(item)
                              ? current.serviceCapability.filter((value) => value !== item)
                              : [...current.serviceCapability, item]
                          }))
                        }
                      />
                      {item}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-[#E5E7EB] p-4">
                  <span className="mb-3 block text-sm font-medium text-slate-700">
                    Are you certified in First Aid &amp; CPR, PSW, or any health/emergency related training?
                  </span>
                  <div className="flex gap-3">
                    {[
                      ["yes", "Yes"],
                      ["no", "No"]
                    ].map(([value, text]) => (
                      <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="radio"
                          name="healthEmergencyTraining"
                          value={value}
                          checked={form.healthEmergencyTraining === value}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              healthEmergencyTraining: event.target.value,
                              healthEmergencyTrainingDetails:
                                event.target.value === "yes" ? current.healthEmergencyTrainingDetails : ""
                            }))
                          }
                        />
                        {text}
                      </label>
                    ))}
                  </div>

                  {form.healthEmergencyTraining === "yes" ? (
                    <label className="mt-4 block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">Training details</span>
                      <input
                        className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]"
                        value={form.healthEmergencyTrainingDetails}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, healthEmergencyTrainingDetails: event.target.value }))
                        }
                        placeholder="Example: First Aid & CPR, PSW, emergency response"
                      />
                    </label>
                  ) : null}
                </div>

                {form.healthEmergencyTraining === "yes" ? (
                  <label className="block rounded-2xl border border-[#E5E7EB] p-4">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Upload your certificate</span>
                    <input
                      type="file"
                      accept={uploadAccept}
                      className="block w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 text-sm text-slate-600 file:mr-4 file:rounded-xl file:border-0 file:bg-[#EEF2FF] file:px-4 file:py-2 file:font-medium file:text-[#4338CA]"
                      onChange={(event) =>
                        setUploadedFiles((current) => ({
                          ...current,
                          healthTrainingCertificate: event.target.files?.[0] ?? null
                        }))
                      }
                    />
                    <span className="mt-2 block text-xs text-slate-500">
                      {uploadedFiles.healthTrainingCertificate
                        ? `Selected: ${uploadedFiles.healthTrainingCertificate.name}`
                        : "Required when you select Yes."}
                    </span>
                  </label>
                ) : (
                  <div className="rounded-2xl border border-dashed border-[#D8DEEA] bg-[#F8FAFC] p-4 text-sm text-slate-500">
                    If you hold First Aid, CPR, PSW, or related emergency-care training, select Yes and upload the certificate here.
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-[#E5E7EB] p-5">
                <div className="text-sm font-medium text-slate-700">Required documents</div>
                <p className="mt-2 text-sm text-slate-500">
                  Upload the required files from your computer or mobile phone.
                </p>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {documentUploadFields.map(({ label, key, required }) => {
                    const file = uploadedFiles[key];

                    return (
                      <label key={key} className="block">
                        <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
                        <input
                          type="file"
                          accept={uploadAccept}
                          required={required as boolean}
                          className="block w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 text-sm text-slate-600 file:mr-4 file:rounded-xl file:border-0 file:bg-[#EEF2FF] file:px-4 file:py-2 file:font-medium file:text-[#4338CA]"
                          onChange={(event) =>
                            setUploadedFiles((current) => ({
                              ...current,
                              [key]: event.target.files?.[0] ?? null
                            }))
                          }
                        />
                        <span className="mt-2 block text-xs text-slate-500">
                          {file ? `Selected: ${file.name}` : required ? "Required upload" : "Optional upload"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-[#E5E7EB] p-4">
                  <div className="text-sm font-medium text-slate-700">Background & consent</div>
                  <p className="mt-4 text-sm text-slate-700">I confirm that I:</p>
                  <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">
                    <li>Will treat customers respectfully</li>
                    <li>Will maintain professional appearance and conduct</li>
                    <li>Will follow all traffic laws and safety protocols</li>
                    <li>Will not operate under the influence of drugs or alcohol</li>
                    <li>Will respect customer privacy and property</li>
                  </ul>
                  <div className="mt-5 space-y-3">
                    {[
                      ["professionalStandards", "I confirm the statements above"],
                      ["criminalConsent", "I consent to a criminal background check"],
                      ["driverRecordConsent", "I consent to driver record verification"],
                      ["identityConsent", "I consent to identity verification"]
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={form[key as keyof typeof form] as boolean}
                          onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.checked }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Signature</span>
                    <input
                      type="file"
                      accept={uploadAccept}
                      className="block w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 text-sm text-slate-600 file:mr-4 file:rounded-xl file:border-0 file:bg-[#EEF2FF] file:px-4 file:py-2 file:font-medium file:text-[#4338CA]"
                      onChange={(event) =>
                        setUploadedFiles((current) => ({
                          ...current,
                          signature: event.target.files?.[0] ?? null
                        }))
                      }
                    />
                    <span className="mt-2 block text-xs text-slate-500">
                      {uploadedFiles.signature ? `Selected: ${uploadedFiles.signature.name}` : "Upload your signature, or type your full name below."}
                    </span>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Typed signature (optional)</span>
                    <input className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.signatureName} onChange={(event) => setForm((current) => ({ ...current, signatureName: event.target.value }))} placeholder="Type your full name if you are not uploading a signature" />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Application date</span>
                    <input type="date" className="w-full rounded-2xl border border-[#E5E7EB] px-4 py-3 outline-none transition focus:border-[#2563EB]" value={form.applicationDate} onChange={(event) => setForm((current) => ({ ...current, applicationDate: event.target.value }))} />
                  </label>
                </div>
              </div>

              {error ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

              <div className="flex items-center justify-between border-t border-[#EEF0F4] pt-4">
                <p className="text-sm text-slate-500">
                  Your completed application will be submitted to ChaufX & other partners for evaluation and approval.
                </p>
                <button
                  type="submit"
                  disabled={loading || !form.verificationToken}
                  className="rounded-2xl bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_32px_-18px_rgba(37,99,235,0.55)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Submitting..." : "Submit application"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}

export default function DriverApplicationFormPage() {
  return (
    <Suspense
      fallback={
        <PublicPageShell
          heroTitle="Driver application form"
          heroCopy="Complete the detailed ChaufX driver application form. Your finished submission is routed directly to the admin review module."
        >
          <section className="bg-white">
            <div className="mx-auto max-w-6xl px-5 py-12 md:px-8">
              <div className="rounded-[30px] border border-[#E5E7EB] bg-white p-7 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Detailed onboarding</div>
                <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">Loading your application form.</h1>
                <p className="mt-4 text-sm leading-7 text-slate-600">Please wait while we prepare your onboarding details.</p>
              </div>
            </div>
          </section>
        </PublicPageShell>
      }
    >
      <DriverApplicationFormPageContent />
    </Suspense>
  );
}
