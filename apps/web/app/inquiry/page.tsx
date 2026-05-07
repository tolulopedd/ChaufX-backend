import { DriverContactForm } from "../../components/driver-contact-form";
import { PublicPageShell } from "../../components/public-page-shell";

export default function InquiryPage() {
  return (
    <PublicPageShell
      heroTitle="Inquiry"
      heroCopy="Submit a general inquiry to the ChaufX team for booking, partnership, or service questions."
    >
      <section className="bg-white">
        <div className="mx-auto max-w-5xl px-5 py-12 md:px-8">
          <div className="rounded-[30px] border border-[#E5E7EB] bg-white p-7 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
            <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">Send an inquiry.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">
              Use this page for general questions about ChaufX services, onboarding, availability, or future opportunities.
            </p>
            <DriverContactForm defaultSubject="General inquiry" buttonLabel="Send inquiry" />
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
