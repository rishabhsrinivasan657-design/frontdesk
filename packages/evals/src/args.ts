import type { Mode } from "./report.js";
import { CATEGORIES, type Category } from "./scenario.js";

export interface CliOptions {
  mode: Mode;
  filter?: Category;
  subset?: "ci";
  save: boolean;
  check: boolean;
  /** Print every transcript to stderr. */
  verbose: boolean;
}

export const USAGE =
  "usage: pnpm eval [--live | --record | --replay] [--filter <category>] [--subset ci] [--save] [--check] [--verbose]";

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { mode: "replay", save: false, check: false, verbose: false };
  let modeSet = false;
  const fail = (why: string): never => {
    throw new Error(`${why}\n${USAGE}`);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--":
        break;
      case "--live":
      case "--record":
      case "--replay":
        if (modeSet) fail("choose one of --live, --record, --replay");
        options.mode = arg.slice(2) as Mode;
        modeSet = true;
        break;
      case "--filter": {
        const value = argv[++i];
        if (!value || !(CATEGORIES as readonly string[]).includes(value)) {
          fail(`--filter needs one of: ${CATEGORIES.join(", ")}`);
        }
        options.filter = value as Category;
        break;
      }
      case "--subset":
        if (argv[++i] !== "ci") fail("--subset supports: ci");
        options.subset = "ci";
        break;
      case "--save":
        options.save = true;
        break;
      case "--check":
        options.check = true;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      default:
        fail(`unknown argument ${JSON.stringify(arg)}`);
    }
  }
  return options;
}
