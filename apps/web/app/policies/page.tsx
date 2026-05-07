import { PublicPageShell } from "../../components/public-page-shell";

const policies = [
  {
    id: "privacy-policy",
    title: "Privacy policy",
    body: "ChaufX handles personal information through controlled access, secure processing, and limited operational use."
  },
  {
    id: "information-collection",
    title: "Information collection",
    body: "We collect only the information required for bookings, onboarding, communication, and platform operations."
  },
  {
    id: "cookies-policy",
    title: "Cookies policy",
    body: "Cookies and related technologies may be used to support website sessions, performance, and analytics."
  },
  {
    id: "data-retention-sharing",
    title: "Data retention & sharing",
    body: "Information is retained only as needed for service, legal, and compliance purposes and is shared on a controlled basis."
  }
];

export default function PoliciesPage() {
  return (
    <PublicPageShell
      heroTitle="Policies"
      heroCopy="ChaufX keeps public policy information simple, clear, and easy to review."
    >
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-12 md:px-8">
          <div className="grid gap-4 md:grid-cols-2">
            {policies.map((policy) => (
              <div
                key={policy.id}
                id={policy.id}
                className="rounded-[28px] border border-[#E5E7EB] bg-white p-6 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]"
              >
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#0F172A]">{policy.title}</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">{policy.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
