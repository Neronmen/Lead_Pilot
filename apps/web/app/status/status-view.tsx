'use client';

import type { HealthResponse } from '@leadpilot/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { API_URL, fetchHealth, NetworkError } from '@/lib/api';

const REFRESH_MS = 10_000;

const PROBES = [
  { probe: 'live', title: 'Liveness', description: 'The API process is running.' },
  { probe: 'ready', title: 'Readiness', description: 'Every dependency the API needs answers.' },
] as const;

export function StatusView() {
  return (
    <div className="flex flex-col gap-4">
      {PROBES.map((p) => (
        <ProbeCard key={p.probe} {...p} />
      ))}
      <p className="text-xs text-muted-foreground">
        API: <code className="font-mono">{API_URL}</code>
      </p>
    </div>
  );
}

function ProbeCard({
  probe,
  title,
  description,
}: {
  probe: 'live' | 'ready';
  title: string;
  description: string;
}) {
  const query = useQuery({
    queryKey: ['health', probe],
    queryFn: () => fetchHealth(probe),
    refetchInterval: REFRESH_MS,
    staleTime: 0,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          {query.data && <OverallBadge status={query.data.status} />}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Refresh ${title.toLowerCase()}`}
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={query.isFetching ? 'animate-spin' : undefined} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState error={query.error} />
        ) : (
          <Checks data={query.data} checkedAt={query.dataUpdatedAt} />
        )}
      </CardContent>
    </Card>
  );
}

function OverallBadge({ status }: { status: HealthResponse['status'] }) {
  return status === 'ok' ? (
    <Badge className="bg-emerald-600 text-white dark:bg-emerald-500">Healthy</Badge>
  ) : (
    <Badge variant="destructive">Degraded</Badge>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-5 w-32" />
    </div>
  );
}

function ErrorState({ error }: { error: Error }) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>
        {error instanceof NetworkError ? 'API unreachable' : 'Unexpected response'}
      </AlertTitle>
      <AlertDescription>
        {error instanceof NetworkError ? (
          <p>
            Start the stack with <code className="font-mono">docker compose up -d</code> and{' '}
            <code className="font-mono">pnpm dev</code>, then refresh.
          </p>
        ) : (
          <p>{error.message}</p>
        )}
      </AlertDescription>
    </Alert>
  );
}

function Checks({ data, checkedAt }: { data: HealthResponse; checkedAt: number }) {
  const entries = Object.entries(data.checks);
  return (
    <div className="flex flex-col gap-3">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No dependency checks for this probe.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {entries.map(([name, check]) => (
            <li key={name} className="flex items-center justify-between py-2 text-sm">
              <span className="font-medium capitalize">{name}</span>
              <span className="flex items-center gap-2">
                {check.message && <span className="text-muted-foreground">{check.message}</span>}
                <Badge variant={check.status === 'up' ? 'secondary' : 'destructive'}>
                  {check.status}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Checked {new Date(checkedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}
