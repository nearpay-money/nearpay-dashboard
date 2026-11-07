import { describe, expect, it } from "vitest";
import {
  alreadyApproved,
  approvalStep,
  canManage,
  grantableRoles,
  teamRows,
  validEmail,
  wouldRemoveLastOwner,
} from "./logic";

const m = (id: string, role: "owner" | "admin" | "viewer") => ({
  user: { id, email: `${id}@a.co` },
  role,
  last_login_at: null,
});

describe("team rules", () => {
  it("only owners grant or manage owners", () => {
    expect(grantableRoles("owner")).toContain("owner");
    expect(grantableRoles("admin")).not.toContain("owner");
    expect(grantableRoles("viewer")).toEqual([]);
    expect(canManage("admin", "owner")).toBe(false);
    expect(canManage("admin", "viewer")).toBe(true);
    expect(canManage("owner", "owner")).toBe(true);
  });
  it("detects the last owner", () => {
    const ms = [m("a", "owner"), m("b", "admin")];
    expect(wouldRemoveLastOwner(ms, "a", "admin")).toBe(true);
    expect(wouldRemoveLastOwner(ms, "a", null)).toBe(true);
    expect(wouldRemoveLastOwner(ms, "a", "owner")).toBe(false);
    expect(wouldRemoveLastOwner([...ms, m("c", "owner")], "a", null)).toBe(false);
    expect(wouldRemoveLastOwner(ms, "b", null)).toBe(false);
  });
  it("merges members and pending invitations", () => {
    const rows = teamRows(
      [m("b", "viewer"), m("a", "owner")],
      [
        { id: "inv_1", email: "n@a.co", role: "admin", status: "pending", expires_at: 1 },
        { id: "inv_2", email: "o@a.co", role: "admin", status: "revoked", expires_at: 1 },
      ],
    );
    expect(rows.map((r) => [r.email, r.status])).toEqual([
      ["a@a.co", "Active"],
      ["n@a.co", "Pending"],
      ["b@a.co", "Active"],
    ]);
  });
  it("describes approvals", () => {
    const d = { approval: { required: 2, approved_by: ["usr_1" as never], rejected_by: null } };
    expect(approvalStep(d)).toMatch(/^1 of 2/);
    expect(approvalStep({ approval: null })).toBe("Approval required");
    expect(alreadyApproved(d, "usr_1")).toBe(true);
    expect(alreadyApproved(d, "usr_2")).toBe(false);
    expect(validEmail("a@b.co")).toBe(true);
    expect(validEmail("a@b")).toBe(false);
  });
});
