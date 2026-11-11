/**
 * Self-declared KYB (ADR-0020 decision 3, ADR-0024 open onboarding; spec `KybProfile`): form ↔ profile
 * mapping, the draft PATCH body, the completeness check `submitKyb` enforces, and status copy. Saving
 * complete details turns live mode on at once (no NearPay review). Copy rule: business details are
 * self-declared — never "verified" or "reviewed".
 */
import type { KybCase as KybCaseSchema, KybProfile as KybProfileSchema, z } from "@nearpay-money/spec";

export type KybProfile = z.output<typeof KybProfileSchema>;
export type KybCase = z.output<typeof KybCaseSchema>;

export interface KybForm {
  legal_name: string;
  country_of_incorporation: string;
  registration_number: string;
  business_type: string;
  website: string;
  line1: string;
  line2: string;
  city: string;
  postal_code: string;
  region: string;
  address_country: string;
  rep_name: string;
  rep_title: string;
  expected_monthly_volume: string;
}

export type KybField = keyof KybForm;

export const BUSINESS_TYPES = [
  { value: "company", label: "Company" },
  { value: "sole_proprietorship", label: "Sole proprietorship" },
  { value: "partnership", label: "Partnership" },
  { value: "non_profit", label: "Non-profit" },
  { value: "other", label: "Other" },
] as const;

export const VOLUME_BANDS = [
  { value: "under_10k", label: "Under $10,000 a month" },
  { value: "10k_to_100k", label: "$10,000 – $100,000 a month" },
  { value: "100k_to_1m", label: "$100,000 – $1,000,000 a month" },
  { value: "over_1m", label: "Over $1,000,000 a month" },
] as const;

export function formOf(p: KybProfile | undefined): KybForm {
  return {
    legal_name: p?.legal_name ?? "",
    country_of_incorporation: p?.country_of_incorporation ?? "",
    registration_number: p?.registration_number ?? "",
    business_type: p?.business_type ?? "",
    website: p?.website ?? "",
    line1: p?.business_address?.line1 ?? "",
    line2: p?.business_address?.line2 ?? "",
    city: p?.business_address?.city ?? "",
    postal_code: p?.business_address?.postal_code ?? "",
    region: p?.business_address?.region ?? "",
    address_country: p?.business_address?.country ?? "",
    rep_name: p?.representative?.name ?? "",
    rep_title: p?.representative?.title ?? "",
    expected_monthly_volume: p?.expected_monthly_volume ?? "",
  };
}

export type Errors = Partial<Record<KybField, string>>;

const t = (s: string) => s.trim();

/** Format checks that apply to drafts too (lengths, URL, partial groups). */
export function formatErrors(f: KybForm): Errors {
  const e: Errors = {};
  if (t(f.legal_name).length > 200) e.legal_name = "Use at most 200 characters.";
  if (t(f.registration_number).length > 64) e.registration_number = "Use at most 64 characters.";
  if (t(f.website)) {
    try {
      const u = new URL(t(f.website));
      if (u.protocol !== "https:") e.website = "Use an https:// address.";
    } catch {
      e.website = "Enter a full address, like https://acme.example.";
    }
  }
  const addr = [f.line1, f.line2, f.city, f.postal_code, f.region, f.address_country].some((x) => t(x));
  if (addr) {
    if (!t(f.line1)) e.line1 = "Enter the street address.";
    if (!t(f.city)) e.city = "Enter the city.";
    if (!t(f.address_country)) e.address_country = "Choose the country.";
  }
  if (t(f.rep_name) || t(f.rep_title)) {
    if (!t(f.rep_name)) e.rep_name = "Enter the representative's full name.";
    if (!t(f.rep_title)) e.rep_title = "Enter their role.";
  }
  return e;
}

const REQUIRED: readonly [KybField, string][] = [
  ["legal_name", "Enter the registered legal name."],
  ["country_of_incorporation", "Choose the country of incorporation."],
  ["business_type", "Choose the business type."],
  ["line1", "Enter the street address."],
  ["city", "Enter the city."],
  ["address_country", "Choose the country."],
  ["rep_name", "Enter the representative's full name."],
  ["rep_title", "Enter their role."],
  ["expected_monthly_volume", "Choose the expected volume."],
];

/**
 * Everything `submitKyb` requires: all fields except website, registration number (optional since
 * ADR-0024) and the optional address lines.
 */
export function submitErrors(f: KybForm): Errors {
  const e: Errors = { ...formatErrors(f) };
  for (const [k, msg] of REQUIRED) if (!t(f[k]) && !e[k]) e[k] = msg;
  return e;
}

const orNull = (s: string): string | null => (t(s) ? t(s) : null);

/** Draft PATCH body (`null` clears a field; groups are sent whole or cleared). */
export function updateBody(f: KybForm) {
  const hasAddr = t(f.line1) && t(f.city) && t(f.address_country);
  const hasRep = t(f.rep_name) && t(f.rep_title);
  return {
    legal_name: orNull(f.legal_name),
    country_of_incorporation: orNull(f.country_of_incorporation),
    registration_number: orNull(f.registration_number),
    business_type: (orNull(f.business_type) as KybProfile["business_type"]) ?? null,
    website: orNull(f.website),
    business_address: hasAddr
      ? {
          line1: t(f.line1),
          line2: orNull(f.line2),
          city: t(f.city),
          postal_code: orNull(f.postal_code),
          region: orNull(f.region),
          country: t(f.address_country),
        }
      : null,
    representative: hasRep ? { name: t(f.rep_name), title: t(f.rep_title) } : null,
    expected_monthly_volume: (orNull(f.expected_monthly_volume) as KybProfile["expected_monthly_volume"]) ?? null,
  };
}

export interface StatusInfo {
  readonly badge: string;
  readonly tone: "info" | "warning" | "success" | "danger" | "neutral";
  readonly title: string;
  readonly body: string;
}

export function statusInfo(c: Pick<KybCase, "status">): StatusInfo {
  switch (c.status) {
    case "not_started":
      return {
        badge: "Not submitted",
        tone: "neutral",
        title: "Add your business details",
        body: "Live payments turn on as soon as you save complete details. Save a draft any time.",
      };
    case "pending":
      // only seen when an operator has turned manual review back on (NP_KYB_MODE=manual)
      return {
        badge: "Submitted",
        tone: "info",
        title: "Your details are submitted",
        body: "Live payments turn on as soon as they are processed; we'll email the owners. Details can't be changed meanwhile.",
      };
    case "needs_info":
      return {
        badge: "More information",
        tone: "warning",
        title: "NearPay needs more information",
        body: "Update the details below and save them again.",
      };
    case "approved":
      return {
        badge: "Live",
        tone: "success",
        title: "You're live — you can accept real payments",
        body: "Your business details are saved. Customers see your declared legal name at checkout.",
      };
    case "rejected":
      return {
        badge: "Not accepted",
        tone: "danger",
        title: "Live payments aren't available for this business",
        body: "These details can't be used for live payments. Contact support to discuss next steps.",
      };
    default:
      return { badge: String(c.status).replace(/_/g, " "), tone: "neutral", title: "Business details", body: "" };
  }
}

/** ISO 3166-1 alpha-2 codes; names come from `Intl.DisplayNames`. */
const CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );

export function countryOptions(locale?: string): { value: string; label: string }[] {
  let names: Intl.DisplayNames | undefined;
  try {
    names = new Intl.DisplayNames(locale ? [locale] : undefined, { type: "region" });
  } catch {
    names = undefined;
  }
  return CODES.map((c) => ({ value: c, label: names?.of(c) ?? c })).sort((a, b) => a.label.localeCompare(b.label));
}

export const labelOf = (opts: readonly { value: string; label: string }[], v: string | null | undefined): string =>
  (v && opts.find((o) => o.value === v)?.label) || v || "—";
