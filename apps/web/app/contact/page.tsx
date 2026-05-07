import { DriverContactForm } from "../../components/driver-contact-form";
import { PublicPageShell } from "../../components/public-page-shell";

export default function ContactPage() {
  return (
    <PublicPageShell
      heroTitle="Contact"
      heroCopy="Reach the ChaufX team for onboarding, service, approval, or general platform questions."
    >
      <section className="bg-white">
        <div className="mx-auto max-w-5xl px-5 py-12 md:px-8">
          <div className="grid gap-4 lg:grid-cols-[0.42fr_0.58fr]">
            <div className="rounded-[30px] border border-[#E5E7EB] bg-[#F8FAFC] p-7 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
              <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">Contact details</h2>
              <div className="mt-6 space-y-5">
                <div>
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Phone</div>
                  <a href="tel:+16479197237" className="mt-2 block text-lg font-semibold text-[#0F172A]">
                    +1 (647) 919-7237
                  </a>
                </div>
                <div>
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#4338CA]">Email</div>
                  <a href="mailto:info@chaufx.ca" className="mt-2 block text-lg font-semibold text-[#0F172A]">
                    info@chaufx.ca
                  </a>
                </div>
              </div>
            </div>

            <div className="rounded-[30px] border border-[#E5E7EB] bg-white p-7 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]">
            <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#0F172A]">Talk to ChaufX.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">
              For service, onboarding, approval, or chauffeur opportunities in your province, send a message to the ChaufX admin team.
            </p>
            <DriverContactForm defaultSubject="Contact request" />
            </div>
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
