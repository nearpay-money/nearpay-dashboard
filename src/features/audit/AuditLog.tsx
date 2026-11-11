/**
 * Audit log (`/settings/audit`; lld/dashboard-and-console.md §1 "audit log + CSV export"): the account's
 * append-only audit events with action / actor / date filters, a cursor pager, and a client-side CSV
 * export that walks the list with the same filters (spec description of `listAccountAuditEvents`).
 */

import {
  Button,
  Callout,
  EmptyState,
  Field,
  Input,
  LiveRegion,
  PageHeader,
  Pager,
  Table,
  type TableColumn,
} from "@nearpay-internal/ui";
import { listAccountAuditEvents } from "@nearpay-money/spec";
import { useRef, useState } from "react";
import { useApp } from "../../app/context";
import { roleAllows } from "../../lib/permissions";
import { exportEvents, PAGE_SIZE, useAuditList, useMemberEmails } from "./api";
import {
  type AuditEvent,
  type AuditFilter,
  actionLabel,
  actorLabel,
  EMPTY_FILTER,
  EXPORT_LIMIT,
  filterError,
  toCsv,
} from "./logic";
import { ActionError, ErrorState, RoleNotice } from "./parts";
import { fmtDate, isoOf } from "./ui";
import "./audit.css";

const COMMON_ACTIONS = [
  "member.invited",
  "member.role_changed",
  "member.removed",
  "api_key.created",
  "api_key.rolled",
  "api_key.revoked",
  "destination.created",
  "destination.approved",
  "account.updated",
  "kyb.submitted",
];

export function AuditLog() {
  const app = useApp();
  const [draft, setDraft] = useState<AuditFilter>(EMPTY_FILTER);
  const [filter, setFilter] = useState<AuditFilter>(EMPTY_FILTER);
  const list = useAuditList(filter);
  const emails = useMemberEmails().data ?? new Map<string, string>();
  const [exporting, setExporting] = useState<number | null>(null);
  const [exportError, setExportError] = useState<unknown>();
  const [announce, setAnnounce] = useState("");
  const cancel = useRef({ canceled: false });
  const draftError = filterError(draft);
  const filtered = JSON.stringify(filter) !== JSON.stringify(EMPTY_FILTER);

  const header = (
    <PageHeader
      title="Audit log"
      subtitle="Every change to your account, who made it and when."
      actions={
        roleAllows(listAccountAuditEvents, app.session?.role) ? (
          exporting !== null ? (
            <Button
              variant="secondary"
              onClick={() => {
                cancel.current.canceled = true;
              }}
            >
              Cancel export ({exporting})
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void runExport()} data-testid="export-csv">
              Export CSV
            </Button>
          )
        ) : undefined
      }
    />
  );
  if (!roleAllows(listAccountAuditEvents, app.session?.role))
    return (
      <div className="np-stack np-stack--lg">
        {header}
        <RoleNotice>Only owners and admins can view the audit log.</RoleNotice>
      </div>
    );

  async function runExport() {
    cancel.current = { canceled: false };
    setExporting(0);
    setExportError(undefined);
    setAnnounce("Preparing the export…");
    try {
      const { events, truncated } = await exportEvents(app.api, filter, setExporting, cancel.current);
      const blob = new Blob([toCsv(events)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nearpay-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setAnnounce(
        truncated
          ? `Exported the newest ${events.length} events. Narrow the dates to export the rest.`
          : `Exported ${events.length} events.`,
      );
    } catch (e) {
      setExportError(e);
      setAnnounce("");
    } finally {
      setExporting(null);
    }
  }

  const columns: TableColumn<AuditEvent>[] = [
    {
      key: "time",
      header: "Time",
      numeric: true,
      cell: (e) => <time dateTime={isoOf(e.created)}>{fmtDate(e.created)}</time>,
    },
    {
      key: "action",
      header: "Action",
      primary: true,
      cell: (e) => (
        <span className="npf-audit__action">
          <span>{actionLabel(e.action)}</span>
          <code className="npf-audit__mono">{e.action}</code>
        </span>
      ),
    },
    { key: "actor", header: "Actor", cell: (e) => actorLabel(e.actor, emails) },
    {
      key: "target",
      header: "Target",
      hideOnNarrow: true,
      cell: (e) => (e.target ? <code className="npf-audit__mono">{e.target.id}</code> : "—"),
    },
  ];
  const rows = list.data?.data ?? [];
  const first = list.page * PAGE_SIZE + 1;

  return (
    <div className="np-stack np-stack--lg">
      <LiveRegion>{announce}</LiveRegion>
      {header}
      <search>
        <form
          className="npf-audit__filters"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draftError) setFilter(draft);
          }}
        >
          <Field label="Action" hint="Exact action name">
            <Input
              value={draft.action}
              list="npf-audit-actions"
              autoComplete="off"
              onChange={(e) => setDraft({ ...draft, action: e.target.value })}
              data-testid="filter-action"
            />
          </Field>
          <datalist id="npf-audit-actions">
            {COMMON_ACTIONS.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
          <Field label="Actor id" hint="usr_…, key_… or a service">
            <Input
              value={draft.actor}
              autoComplete="off"
              onChange={(e) => setDraft({ ...draft, actor: e.target.value })}
            />
          </Field>
          <Field label="From">
            <Input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </Field>
          <Field label="To" error={draftError}>
            <Input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </Field>
          <div className="npf-audit__filter-actions">
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={Boolean(draftError)}
              data-testid="apply-filters"
            >
              Apply
            </Button>
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(EMPTY_FILTER);
                  setFilter(EMPTY_FILTER);
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </form>
      </search>
      <ActionError error={exportError} />
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} title="We couldn't load the audit log" />
      ) : !list.loading && rows.length === 0 && list.page === 0 && !filtered ? (
        <EmptyState title="No audit events yet">
          Changes to your team, keys, destinations and settings appear here.
        </EmptyState>
      ) : (
        <Table
          caption="Audit events"
          columns={columns}
          rows={rows}
          rowKey={(e) => e.id}
          loading={list.loading}
          empty="No events match these filters."
          footer={
            list.data && (list.data.has_more || list.page > 0) ? (
              <Pager
                summary={rows.length ? `Showing ${first}–${first + rows.length - 1} events` : undefined}
                hasPrevious={list.page > 0}
                hasNext={list.data.has_more}
                onPrevious={list.previous}
                onNext={list.next}
              />
            ) : undefined
          }
        />
      )}
      <Callout tone="neutral" title="About exports">
        The CSV is built in your browser from the filtered list (up to {EXPORT_LIMIT.toLocaleString()} newest events).
        It contains ids, not personal data.
      </Callout>
    </div>
  );
}
