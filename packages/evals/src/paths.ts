import { resolve } from "node:path";

/** `packages/evals`. */
export const EVALS_DIR = resolve(import.meta.dirname, "..");
export const SCENARIOS_DIR = resolve(EVALS_DIR, "scenarios");
export const RECORDINGS_DIR = resolve(EVALS_DIR, "recordings");
export const BASELINE_FILE = resolve(EVALS_DIR, "baseline.json");
export const CI_SUBSET_FILE = resolve(EVALS_DIR, "ci-subset.json");
export const BUSINESS_FILE = resolve(EVALS_DIR, "../../businesses/casa-fiorella.yaml");
