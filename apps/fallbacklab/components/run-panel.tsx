"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { getFirebaseAuth, getGoogleProvider, hasFirebaseConfig } from "@/lib/firebase-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

type AttemptLog = {
  attempt: number;
  name?: string;
  outcome: "success" | "rejected" | "unacceptable" | "timeout" | "aborted";
  durationMs: number;
  error?: string;
};

type RunResponse = {
  runId?: string | null;
  page: { text: string; source: string; attempts: AttemptLog[] };
  summary: { answer: string; provider: string; bullets?: string[]; attempts: AttemptLog[] };
};

const outcomeStyles: Record<AttemptLog["outcome"], string> = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  rejected: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  unacceptable: "border-purple-500/30 bg-purple-500/10 text-purple-700",
  timeout: "border-rose-500/30 bg-rose-500/10 text-rose-700",
  aborted: "border-slate-500/30 bg-slate-500/10 text-slate-700"
};

export function RunPanel() {
  const [url, setUrl] = useState("https://example.com");
  const [question, setQuestion] = useState("What is this page about?");
  const [demoMode, setDemoMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResponse | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!hasFirebaseConfig) return;
    const auth = getFirebaseAuth();
    if (!auth) return;
    return onAuthStateChanged(auth, (next) => setUser(next));
  }, []);

  const authReady = useMemo(() => hasFirebaseConfig, []);

  const handleAuth = async () => {
    const auth = getFirebaseAuth();
    const provider = getGoogleProvider();
    if (!auth || !provider) return;
    if (user) {
      await signOut(auth);
      return;
    }
    await signInWithPopup(auth, provider);
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const headers: Record<string, string> = {
        "content-type": "application/json"
      };

      if (!demoMode && user) {
        const token = await user.getIdToken();
        headers.authorization = `Bearer ${token}`;
      }

      const res = await fetch("/api/run", {
        method: "POST",
        headers,
        body: JSON.stringify({
          url,
          question,
          options: { timeoutMs: 8000 },
          demo: demoMode
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "Run failed");
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <Card className="border-border/60 bg-white/80 backdrop-blur">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl">Run a fallback chain</CardTitle>
          <CardDescription>
            Try providers in order. Watch each attempt and see why a fallback
            happened.
          </CardDescription>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="border-border/60">
              {demoMode ? "Demo Mode" : "Authenticated"}
            </Badge>
            {authReady ? (
              <Button size="sm" variant="outline" onClick={handleAuth}>
                {user ? `Sign out ${user.displayName ?? "user"}` : "Sign in with Google"}
              </Button>
            ) : (
              <Badge variant="outline" className="border-amber-500/30 text-amber-700">
                Firebase not configured
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">URL</label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Question</label>
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask anything about the page"
              rows={4}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={demoMode}
                onChange={(e) => setDemoMode(e.target.checked)}
                className="size-4 rounded border-border text-foreground"
              />
              Demo Mode (skip auth + storage)
            </label>
            <Button onClick={run} disabled={loading}>
              {loading ? "Running…" : "Run"}
            </Button>
          </div>
          {error ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-white/80 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-xl">Result</CardTitle>
          <CardDescription>Answer plus attempt timeline.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!result ? (
            <div className="text-sm text-muted-foreground">
              Run a query to see the fallback timeline.
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-border/60">
                    Source: {result.page.source}
                  </Badge>
                  <Badge variant="outline" className="border-border/60">
                    Provider: {result.summary.provider}
                  </Badge>
                  {result.runId ? (
                    <Badge variant="outline" className="border-emerald-500/30 text-emerald-700">
                      Saved
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm leading-relaxed text-foreground/90">
                  {result.summary.answer}
                </p>
                {result.summary.bullets?.length ? (
                  <ul className="list-disc pl-5 text-sm text-muted-foreground">
                    {result.summary.bullets.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <Separator />
              <Tabs defaultValue="fetch">
                <TabsList>
                  <TabsTrigger value="fetch">Fetch chain</TabsTrigger>
                  <TabsTrigger value="summary">Summarize chain</TabsTrigger>
                </TabsList>
                <TabsContent value="fetch">
                  <ScrollArea className="h-52 rounded-lg border border-border/60 p-3">
                    <div className="space-y-3">
                      {result.page.attempts.map((attempt) => (
                        <div key={attempt.attempt} className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className={`border text-xs ${outcomeStyles[attempt.outcome]}`}
                            >
                              {attempt.outcome}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              #{attempt.attempt + 1} {attempt.name ?? "candidate"} · {attempt.durationMs}ms
                            </span>
                          </div>
                          {attempt.error ? (
                            <p className="text-xs text-muted-foreground">{attempt.error}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="summary">
                  <ScrollArea className="h-52 rounded-lg border border-border/60 p-3">
                    <div className="space-y-3">
                      {result.summary.attempts.map((attempt) => (
                        <div key={attempt.attempt} className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className={`border text-xs ${outcomeStyles[attempt.outcome]}`}
                            >
                              {attempt.outcome}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              #{attempt.attempt + 1} {attempt.name ?? "candidate"} · {attempt.durationMs}ms
                            </span>
                          </div>
                          {attempt.error ? (
                            <p className="text-xs text-muted-foreground">{attempt.error}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
