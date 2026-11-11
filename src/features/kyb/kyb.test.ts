import { describe, expect, it } from "vitest";
import { countryOptions, formatErrors, formOf, statusInfo, submitErrors, updateBody } from "./logic";

const full = {
  ...formOf(undefined),
  legal_name: "Acme Studio Ltd",
  country_of_incorporation: "GB",
  registration_number: "123",
  business_type: "company",
  line1: "1 High St",
  city: "London",
  address_country: "GB",
  rep_name: "Alex Morgan",
  rep_title: "Director",
  expected_monthly_volume: "under_10k",
};

describe("KYB (self-declared)", () => {
  it("requires every field except website, registration number and optional address lines to submit", () => {
    expect(submitErrors(full)).toEqual({});
    expect(submitErrors({ ...full, registration_number: "" })).toEqual({});
    const e = submitErrors(formOf(undefined));
    expect(Object.keys(e).sort()).toEqual(
      [
        "address_country",
        "business_type",
        "city",
        "country_of_incorporation",
        "expected_monthly_volume",
        "legal_name",
        "line1",
        "rep_name",
        "rep_title",
      ].sort(),
    );
  });
  it("checks formats on drafts", () => {
    expect(formatErrors({ ...formOf(undefined), website: "http://a.example" }).website).toBeDefined();
    expect(formatErrors({ ...formOf(undefined), city: "Paris" }).line1).toBeDefined();
    expect(formatErrors({ ...formOf(undefined), rep_name: "A" }).rep_title).toBeDefined();
    expect(formatErrors(formOf(undefined))).toEqual({});
  });
  it("sends groups whole or null", () => {
    expect(updateBody(formOf(undefined))).toMatchObject({
      legal_name: null,
      business_address: null,
      representative: null,
    });
    expect(updateBody(full)).toMatchObject({
      business_address: { line1: "1 High St", line2: null, city: "London", country: "GB" },
      representative: { name: "Alex Morgan", title: "Director" },
    });
  });
  it("never claims verification or a NearPay review (open onboarding, ADR-0024)", () => {
    for (const s of ["pending", "needs_info", "approved", "rejected", "new_thing"]) {
      const i = statusInfo({ status: s as never });
      expect(i).not.toBeNull();
      expect(`${i?.title} ${i?.body} ${i?.badge}`).not.toMatch(/verif|review|waiting/i);
    }
    expect(statusInfo({ status: "approved" })?.title).toBe("You're live — you can accept real payments");
    // no "not submitted" card before the details are saved (owner decision 2026-11-11): the form is the prompt
    expect(statusInfo({ status: "not_started" })).toBeNull();
    expect(countryOptions("en").find((c) => c.value === "GB")?.label).toBe("United Kingdom");
  });
});
