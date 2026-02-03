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
        </div>
        <RunPanel />
      </div>
    </div>
  );
}
