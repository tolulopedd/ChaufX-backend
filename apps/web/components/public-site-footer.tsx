export function PublicSiteFooter() {
  return (
    <footer className="border-t border-[#E5E7EB] bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-8 md:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <p className="text-sm text-slate-500">Copyright 2026 ChaufX. All rights reserved.</p>
          <div className="flex flex-col gap-1 text-sm text-slate-600 md:flex-row md:gap-4">
            <a href="tel:+16479197237" className="transition hover:text-[#2563EB]">
              +1 (647) 919-7237
            </a>
            <a href="mailto:info@chaufx.ca" className="transition hover:text-[#2563EB]">
              info@chaufx.ca
            </a>
          </div>
        </div>

        <div className="flex flex-wrap gap-5 text-sm font-semibold text-slate-600">
          <a href="https://instagram.com" target="_blank" rel="noreferrer" className="transition hover:text-[#2563EB]">
            Instagram
          </a>
          <a href="https://facebook.com" target="_blank" rel="noreferrer" className="transition hover:text-[#2563EB]">
            Facebook
          </a>
          <a href="https://linkedin.com" target="_blank" rel="noreferrer" className="transition hover:text-[#2563EB]">
            LinkedIn
          </a>
        </div>
      </div>
    </footer>
  );
}
