import { RunPanel } from "@/components/run-panel";

export default function Home() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#fef3c7,_transparent_45%),radial-gradient(circle_at_80%_20%,_#dbeafe,_transparent_40%),radial-gradient(circle_at_20%_70%,_#fae8ff,_transparent_35%)]">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-10 flex flex-col gap-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground shadow-sm">
            Fallback Lab · Demo
          </div>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Try providers until one works.
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground">
              A visual playground for the tiny @khalidsaidi/fallback-chain-js library.
              Fetch a page, summarize it with Vertex AI, and inspect every
              attempt in the chain.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="https://www.npmjs.com/package/@khalidsaidi/fallback-chain-js"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-white/80 px-4 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-white"
            >
              npm · @khalidsaidi/fallback-chain-js
            </a>
            <a
              href="https://github.com/khalidsaidi/fallback-chain-js"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-white/80 px-4 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-white"
            >
              GitHub · khalidsaidi/fallback-chain-js
            </a>
          </div>
          <div className="max-w-2xl overflow-x-auto rounded-2xl border border-border/60 bg-slate-950 p-5 shadow-sm">
            <pre className="text-sm leading-relaxed text-slate-100">
              <code>{`import { fallback } from "@khalidsaidi/fallback-chain-js";

const summary = await fallback([
  { name: "vertex", run: ({ signal }) => summarizeWithVertex(url, signal) },
  { name: "fallback", run: () => extractFirstParagraph(url) }
], {
  timeoutMs: 10_000,
  onAttempt: ({ name, outcome }) => console.log(name, outcome)
});`}</code>
            </pre>
          </div>
        </div>
        <RunPanel />
      </div>
    </div>
  );
}
