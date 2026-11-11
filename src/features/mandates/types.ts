/** Output types of spec 0.4.0 mandate schemas the spec exports as values only. */
import type {
  MandateCancelInstructions as CancelSchema,
  MandateCollection as CollectionSchema,
  MandateFundingInstructions as FundingSchema,
  MandateSimulation as SimulationSchema,
  z,
} from "@nearpay-money/spec";

export type MandateCancelInstructions = z.output<typeof CancelSchema>;
export type MandateCollection = z.output<typeof CollectionSchema>;
export type MandateFundingInstructions = z.output<typeof FundingSchema>;
export type MandateSimulation = z.output<typeof SimulationSchema>;
