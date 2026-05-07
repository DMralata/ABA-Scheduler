import type { ReactNode } from "react";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <a href="/" className="text-sm text-slate-500 hover:text-slate-900">← Home</a>
        <article className="prose prose-slate mt-6 max-w-none">
          {children}
        </article>
      </div>
    </div>
  );
}
