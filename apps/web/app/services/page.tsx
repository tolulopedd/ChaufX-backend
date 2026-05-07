import { PublicPageShell } from "../../components/public-page-shell";

const services = [
  {
    id: "personal-driving",
    title: "Personal driving",
    body: "Book a professional chauffeur for errands, shopping days, family visits, evening plans, and everyday schedules."
  },
  {
    id: "senior-assisted",
    title: "Senior & assisted trips",
    body: "Use your own vehicle for medical appointments, therapy sessions, family support, and assisted daily transport."
  },
  {
    id: "business-travel",
    title: "Business & long trips",
    body: "Travel in your own car for business meetings, airport runs, out-of-town journeys, and longer scheduled driving."
  },
  {
    id: "drink-drive",
    title: "Drink & Dial",
    body: "Book a professional chauffeur to drive your vehicle when attending parties, clubs, events, and other nights out that may involve alcohol."
  },
  {
    id: "corporate-chauffeur",
    title: "Corporate chauffeur",
    body: "Use ChaufX for fleet movement, executive transport, and vehicle transfer services for business operations."
  },
  {
    id: "business-meetings",
    title: "Business meetings",
    body: "Arrive on time and stay focused while a professional chauffeur handles your driving between meetings and work commitments."
  }
];

export default function ServicesPage() {
  return (
    <PublicPageShell
      heroTitle="Services"
      heroCopy="ChaufX provides simple chauffeur service in your own vehicle for personal, assisted, and business travel."
    >
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-5 py-12 md:px-8">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {services.map((service) => (
              <div
                key={service.id}
                id={service.id}
                className="rounded-[28px] border border-[#E5E7EB] bg-white p-6 shadow-[0_24px_70px_-50px_rgba(15,23,42,0.18)]"
              >
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#0F172A]">{service.title}</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">{service.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
