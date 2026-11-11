/**
 * Team & approvals (Figma b04): members and pending invitations (Team member · Role · Security · Status),
 * invite / change role / remove (step-up through the API client's `401` replay; `last_owner` handled),
 * "Awaiting approval" for destinations that need a second owner/admin (`approver_conflict` explained),
 * and the "Two-person approval" callout. The UI never decides the two-person rule itself — the API does.
 */

import {
  Button,
  Callout,
  Field,
  Input,
  KeyValueList,
  LiveRegion,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  type TableColumn,
} from "@nearpay-internal/ui";
import {
  approveSettlementDestination,
  createInvitation,
  listMembers,
  type Role,
  type SettlementDestination,
} from "@nearpay-money/spec";
import { useState } from "react";
import { useApp } from "../../app/context";
import { ApiError } from "../../lib/errors";
import { roleAllows } from "../../lib/permissions";
import { approvalNotice } from "../settlement/activation";
import { usePendingApprovals, useTeam, useTeamCalls } from "./api";
import { TENURE_COPY } from "./approval-copy";
import {
  alreadyApproved,
  approvalStep,
  canManage,
  grantableRoles,
  ROLE_INFO,
  roleLabel,
  type TeamRow,
  teamRows,
  validEmail,
  wouldRemoveLastOwner,
} from "./logic";
import { ActionError, ErrorState, RoleNotice } from "./parts";
import { fmtDate } from "./ui";
import "./team.css";

export function Team() {
  const app = useApp();
  const team = useTeam();
  const [inviting, setInviting] = useState(false);
  const [managing, setManaging] = useState<TeamRow | null>(null);
  const [announce, setAnnounce] = useState("");
  const role = app.session?.role;
  const canInvite = grantableRoles(role).length > 0 && roleAllows(createInvitation, role);

  const header = (
    <PageHeader
      title="Team & approvals"
      subtitle="Control who can view payments and authorize changes."
      actions={
        canInvite ? (
          <Button onClick={() => setInviting(true)} data-testid="invite-member">
            Invite member
          </Button>
        ) : undefined
      }
    />
  );
  if (!roleAllows(listMembers, role))
    return (
      <div className="np-stack np-stack--lg">
        {header}
        <RoleNotice>Only owners and admins can manage the team. Ask an owner if you need a different role.</RoleNotice>
      </div>
    );

  const members = team.data?.members ?? [];
  const rows = team.data ? teamRows(team.data.members, team.data.invitations) : [];
  const me = app.session?.user.id;

  const columns: TableColumn<TeamRow>[] = [
    {
      key: "who",
      header: "Team member",
      primary: true,
      cell: (r) => (
        <span className="npf-team__who">
          <span>{r.email}</span>
          {r.userId === me && <span className="np-text-caption np-text-secondary">You</span>}
        </span>
      ),
    },
    { key: "role", header: "Role", cell: (r) => roleLabel(r.role) },
    {
      key: "security",
      header: "Security",
      hideOnNarrow: true,
      cell: (r) => (r.kind === "invitation" ? `Invitation expires ${fmtDate(r.expiresAt)}` : r.security),
    },
    { key: "status", header: "Status", cell: (r) => <StatusBadge>{r.status}</StatusBadge> },
    {
      key: "actions",
      header: <span className="np-sr-only">Actions</span>,
      align: "end",
      cell: (r) =>
        canManage(role, r.role) && r.userId !== me ? (
          <Button variant="ghost" size="sm" onClick={() => setManaging(r)} aria-label={`Manage ${r.email}`}>
            Manage
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="np-stack np-stack--lg">
      <LiveRegion>{announce}</LiveRegion>
      {header}
      {team.error ? (
        <ErrorState error={team.error} onRetry={team.reload} title="We couldn't load your team" />
      ) : (
        <Table
          caption="Team members and invitations"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.key}
          loading={team.loading && !team.data}
          empty="No team members."
        />
      )}
      <Approvals onAnnounce={setAnnounce} members={members} />
      <Callout title="Two-person approval">
        When an account has two or more owners or admins, a new payout wallet needs a second approver. It becomes active
        as soon as the second approval lands.
      </Callout>
      <InviteDialog
        open={inviting}
        onClose={() => setInviting(false)}
        onDone={(email) => {
          setInviting(false);
          setAnnounce(`Invitation sent to ${email}.`);
          team.reload();
        }}
      />
      <ManageDialog
        row={managing}
        members={members}
        onClose={() => setManaging(null)}
        onDone={(message) => {
          setManaging(null);
          setAnnounce(message);
          team.reload();
        }}
      />
    </div>
  );
}

function InviteDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (email: string) => void;
}) {
  const app = useApp();
  const calls = useTeamCalls();
  const roles = grantableRoles(app.session?.role);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const emailErr = touched && !validEmail(email) ? "Enter a valid email address." : undefined;
  const send = async () => {
    setTouched(true);
    if (!validEmail(email) || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await calls.invite(email, role);
      const sent = email.trim();
      setEmail("");
      setTouched(false);
      onDone(sent);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite member"
      description="They get an email with a link valid for 7 days. You'll confirm with your passkey."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void send()} data-testid="send-invite">
            Send invitation
          </Button>
        </>
      }
    >
      <form
        className="np-stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Field label="Email" error={emailErr} required>
          <Input
            type="email"
            value={email}
            autoComplete="off"
            onChange={(e) => setEmail(e.target.value)}
            data-testid="invite-email"
          />
        </Field>
        <Field label="Role" hint={ROLE_INFO[role].description}>
          <Select
            value={role}
            options={roles.map((r) => ({ value: r, label: ROLE_INFO[r].label }))}
            onChange={(e) => setRole(e.target.value as Role)}
            data-testid="invite-role"
          />
        </Field>
        <ActionError error={error} />
      </form>
    </Modal>
  );
}

function ManageDialog({
  row,
  members,
  onClose,
  onDone,
}: {
  row: TeamRow | null;
  members: readonly { user: { id: string }; role: Role }[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const app = useApp();
  const calls = useTeamCalls();
  const [role, setRole] = useState<Role | undefined>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>();
  const open = row !== null;
  const current = role ?? row?.role ?? "viewer";
  const roles = grantableRoles(app.session?.role);

  const close = () => {
    setRole(undefined);
    setConfirmRemove(false);
    setError(undefined);
    onClose();
  };
  const run = async (label: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(label);
    setError(undefined);
    try {
      await fn();
      setRole(undefined);
      setConfirmRemove(false);
      onDone(message);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  if (!row) return null;
  const lastOwnerDemote = row.userId ? wouldRemoveLastOwner(members, row.userId, current) : false;
  const lastOwnerRemove = row.userId ? wouldRemoveLastOwner(members, row.userId, null) : false;

  if (row.kind === "invitation")
    return (
      <Modal
        open={open}
        onClose={close}
        title="Pending invitation"
        description={`${row.email} was invited as ${roleLabel(row.role)}. Revoking stops the link from working.`}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Keep invitation
            </Button>
            <Button
              variant="danger"
              loading={busy === "revoke"}
              onClick={() =>
                run("revoke", () => calls.revoke(row.invitationId ?? ""), `Invitation for ${row.email} revoked.`)
              }
              data-testid="revoke-invite"
            >
              Revoke invitation
            </Button>
          </>
        }
      >
        <ActionError error={error} />
      </Modal>
    );

  return (
    <Modal
      open={open}
      onClose={close}
      title={row.email}
      description="Role changes and removals take effect immediately. You'll confirm with your passkey."
      footer={
        confirmRemove ? (
          <>
            <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
              Keep member
            </Button>
            <Button
              variant="danger"
              loading={busy === "remove"}
              onClick={() => run("remove", () => calls.remove(row.userId ?? ""), `${row.email} was removed.`)}
              data-testid="confirm-remove"
            >
              Remove member
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              onClick={() => setConfirmRemove(true)}
              disabled={lastOwnerRemove}
              data-testid="remove-member"
            >
              Remove from team
            </Button>
            <Button
              loading={busy === "role"}
              disabled={current === row.role || lastOwnerDemote}
              onClick={() =>
                run(
                  "role",
                  () => calls.setRole(row.userId ?? "", current),
                  `${row.email} is now ${roleLabel(current)}.`,
                )
              }
              data-testid="save-role"
            >
              Save role
            </Button>
          </>
        )
      }
    >
      <div className="np-stack">
        {confirmRemove ? (
          <Callout tone="warning" title={`Remove ${row.email}?`}>
            Their sessions for this account end at once. You can invite them again later.
          </Callout>
        ) : (
          <Field label="Role" hint={ROLE_INFO[current].description}>
            <Select
              value={current}
              options={(roles.includes(row.role) ? roles : [row.role, ...roles]).map((r) => ({
                value: r,
                label: ROLE_INFO[r].label,
              }))}
              onChange={(e) => setRole(e.target.value as Role)}
              data-testid="member-role"
            />
          </Field>
        )}
        {(lastOwnerDemote || lastOwnerRemove) && (
          <p className="np-text-caption np-text-secondary">
            This is the only owner. Make another member an owner before changing or removing this one.
          </p>
        )}
        <ActionError error={error} />
      </div>
    </Modal>
  );
}

function Approvals({
  onAnnounce,
  members,
}: {
  onAnnounce: (s: string) => void;
  members: readonly { user: { id: string; email: string } }[];
}) {
  const app = useApp();
  const pending = usePendingApprovals();
  const [reviewing, setReviewing] = useState<SettlementDestination | null>(null);
  const email = (id: string | undefined) => members.find((m) => m.user.id === id)?.user.email;
  const rows = pending.data?.data ?? [];
  const canDecide = roleAllows(approveSettlementDestination, app.session?.role);

  const columns: TableColumn<SettlementDestination>[] = [
    {
      key: "req",
      header: "Request",
      primary: true,
      cell: (d) =>
        `${d.is_default ? "Change default settlement destination" : "Add settlement destination"} · ${d.label}`,
    },
    {
      key: "by",
      header: "Approved by",
      hideOnNarrow: true,
      cell: (d) =>
        d.approval?.approved_by.length
          ? d.approval.approved_by.map((u) => email(u) ?? "A team member").join(", ")
          : "—",
    },
    { key: "next", header: "Next step", cell: (d) => approvalStep(d) },
    {
      key: "act",
      header: <span className="np-sr-only">Actions</span>,
      align: "end",
      cell: (d) =>
        canDecide ? (
          <Button variant="secondary" size="sm" onClick={() => setReviewing(d)} data-testid="review-approval">
            Review
          </Button>
        ) : null,
    },
  ];

  return (
    <section className="np-stack" aria-labelledby="npf-team-approvals">
      <h2 className="np-text-h3" id="npf-team-approvals">
        Awaiting approval
      </h2>
      {app.mode === "test" ? (
        <p className="np-text-secondary">Destination approvals apply to live mode. Switch to Live to review them.</p>
      ) : pending.error ? (
        <ErrorState error={pending.error} onRetry={pending.reload} title="We couldn't load pending approvals" />
      ) : pending.loading && !pending.data ? (
        <Skeleton shape="block" />
      ) : (
        <Table
          caption="Changes awaiting approval"
          columns={columns}
          rows={rows}
          rowKey={(d) => d.id}
          empty="Nothing is waiting for approval."
        />
      )}
      <ApproveDialog
        destination={reviewing}
        memberEmail={(id) => email(id) ?? "A team member"}
        onClose={() => setReviewing(null)}
        onDone={(msg) => {
          setReviewing(null);
          onAnnounce(msg);
          pending.reload();
        }}
      />
    </section>
  );
}

function ApproveDialog({
  destination: d,
  memberEmail,
  onClose,
  onDone,
}: {
  destination: SettlementDestination | null;
  memberEmail: (userId: string) => string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const app = useApp();
  const calls = useTeamCalls();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>();
  if (!d) return null;
  const mine = alreadyApproved(d, app.session?.user.id);
  const decide = async (decision: "approve" | "reject") => {
    setBusy(decision);
    setError(undefined);
    try {
      const r = await calls.decide(d.id, decision);
      onDone(decision === "reject" ? `${d.label} was rejected and disabled.` : approvalNotice(d.label, r));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const conflict = error instanceof ApiError && error.code === "approver_conflict";
  return (
    <Modal
      open
      onClose={onClose}
      title="Review destination change"
      description="Check every character of the address with the person who requested it before approving."
      footer={
        <>
          <Button
            variant="ghost"
            loading={busy === "reject"}
            onClick={() => void decide("reject")}
            data-testid="reject-destination"
          >
            Reject
          </Button>
          <Button
            loading={busy === "approve"}
            disabled={mine}
            onClick={() => void decide("approve")}
            data-testid="approve-destination"
          >
            Approve
          </Button>
        </>
      }
    >
      <div className="np-stack">
        <KeyValueList
          items={[
            { label: "Label", value: d.label },
            { label: "Receive", value: `${app.assets.get(d.asset_id)?.symbol ?? d.asset_id} · ${d.chain}` },
            {
              label: d.type === "intents_account" ? "Intents account" : "Address",
              value: <code className="npf-team__mono">{d.address}</code>,
            },
            { label: "Fingerprint", value: <code className="npf-team__mono">{d.fingerprint}</code> },
            { label: "Default destination", value: d.is_default ? "Yes" : "No" },
            { label: "Approvals", value: approvalStep(d) },
            ...(d.created_by ? [{ label: "Added by", value: memberEmail(d.created_by) }] : []),
          ]}
        />
        <p className="np-text-small np-text-secondary">{TENURE_COPY} Pending destinations expire after 7 days.</p>
        {mine && (
          <Callout tone="neutral" title="You already approved this change">
            Another owner or admin must give the second approval.
          </Callout>
        )}
        {conflict ? (
          <Callout tone="warning" title="Another approver is needed" role="alert">
            Another owner or admin must approve this change — you created it or already approved it, or your approval
            doesn't count yet: {TENURE_COPY}
          </Callout>
        ) : (
          <ActionError error={error} />
        )}
        <p className="np-text-caption np-text-secondary">You'll confirm with your passkey.</p>
      </div>
    </Modal>
  );
}
