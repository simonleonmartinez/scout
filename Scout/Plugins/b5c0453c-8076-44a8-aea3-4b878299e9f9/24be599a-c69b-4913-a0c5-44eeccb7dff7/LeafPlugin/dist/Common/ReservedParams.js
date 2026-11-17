/**
 * Prefix used by the LEAF framework on reserved configuration keys
 * (e.g. `__leaf__log_level`). These keys are consumed by the framework
 * before the scenario runs and are surfaced in the plugin UI as a
 * per-scenario settings popup rather than as regular parameters.
 *
 * Must stay in sync with `LEAF/Assets/Leaf.lspkg/Scenarios/scenario/ScenarioConfig.ts`.
 */
export const LEAF_RESERVED_PREFIX = "__leaf__";
export const LEAF_LOG_LEVEL_KEY = "__leaf__log_level";
export const LEAF_TIMEOUT_SECS_KEY = "__leaf__timeout_secs";
export const LEAF_DIAGNOSTIC_POLICY_KEY = "__leaf__diagnostic_policy";
export const LEAF_DIAGNOSTIC_REPORT_DURATION_MS_KEY = "__leaf__diagnostic_report_duration_ms";
export const LEAF_DISABLE_USER_INPUT_KEY = "__leaf__disable_user_input";
export const LEAF_LOG_LEVELS = [
    "DEBUG",
    "INFO",
    "WARN",
    "ERROR",
];
export const LEAF_DIAGNOSTIC_POLICIES = [
    "fallback",
    "fail-fast",
];
/** LEAF parses reserved booleans as these strings, not as JS booleans. */
export const LEAF_TRUE = "true";
export const LEAF_FALSE = "false";
/**
 * Canonical defaults for the reserved parameters. Must match
 * `RESERVED_PARAMS` in `LEAF/Assets/Leaf.lspkg/Scenarios/scenario/ScenarioConfig.ts`.
 * Used to display sensible values in the UI when a scenario's config is
 * missing one of the reserved keys.
 */
export const LEAF_DEFAULT_LOG_LEVEL = "INFO";
export const LEAF_DEFAULT_TIMEOUT_SECS = "600";
export const LEAF_DEFAULT_DIAGNOSTIC_POLICY = "fallback";
export const LEAF_DEFAULT_DIAGNOSTIC_REPORT_DURATION_MS = "-1";
export const LEAF_DEFAULT_DISABLE_USER_INPUT = "true";
/**
 * Builds a dropdown spec. `V` ties `defaultValue` to `values`, so a default
 * outside the options is a compile error rather than a row that cannot render.
 */
function choiceSpec(spec) {
    return {
        label: spec.label,
        tooltip: spec.tooltip,
        defaultValue: spec.defaultValue,
        control: {
            kind: "choice",
            type: { type: "enum", options: spec.values },
            minWidth: spec.minWidth,
            ignoreCase: spec.ignoreCase,
        },
    };
}
/** Builds a checkbox spec, constrained to the two strings LEAF parses. */
function toggleSpec(spec) {
    return { ...spec, control: { kind: "toggle" } };
}
/** The reserved parameters, in display order. */
export const LEAF_RESERVED_PARAM_SPECS = {
    [LEAF_LOG_LEVEL_KEY]: choiceSpec({
        label: "Log level",
        tooltip: "Global log level for the run. Matched case-insensitively.",
        values: LEAF_LOG_LEVELS,
        defaultValue: LEAF_DEFAULT_LOG_LEVEL,
        ignoreCase: true,
    }),
    [LEAF_TIMEOUT_SECS_KEY]: {
        label: "Timeout (s)",
        tooltip: "Maximum execution time for this Scenario or whole Ensemble, in " +
            "whole seconds. -1 disables the timeout.",
        defaultValue: LEAF_DEFAULT_TIMEOUT_SECS,
        control: { kind: "integer" },
    },
    [LEAF_DIAGNOSTIC_POLICY_KEY]: choiceSpec({
        label: "Diagnostics",
        tooltip: "What to do when a diagnostic fires: 'fallback' keeps the scenario " +
            "running; 'fail-fast' stops it right away.",
        values: LEAF_DIAGNOSTIC_POLICIES,
        defaultValue: LEAF_DEFAULT_DIAGNOSTIC_POLICY,
        minWidth: 110,
    }),
    [LEAF_DIAGNOSTIC_REPORT_DURATION_MS_KEY]: {
        label: "Report (ms)",
        tooltip: "How long the in-world diagnostic report stays up after the run. " +
            "Negative leaves it shown indefinitely; 0 means it never appears.\n" +
            "The field shows the value LEAF will act on, so -0 reads back as 0.",
        defaultValue: LEAF_DEFAULT_DIAGNOSTIC_REPORT_DURATION_MS,
        control: { kind: "integer" },
    },
    [LEAF_DISABLE_USER_INPUT_KEY]: toggleSpec({
        label: "Block input",
        tooltip: "Ignore real user input while the scenario runs. Turn off to keep " +
            "driving the lens by hand during development.",
        defaultValue: LEAF_DEFAULT_DISABLE_USER_INPUT,
    }),
};
export const LEAF_RESERVED_PARAM_KEYS = Object.keys(LEAF_RESERVED_PARAM_SPECS);
/**
 * @param key - A config key.
 * @returns True if the key is a LEAF-reserved key (prefixed with `__leaf__`).
 */
export function isReservedKey(key) {
    return key.startsWith(LEAF_RESERVED_PREFIX);
}
/**
 * Reserved keys in `config` with no {@link LEAF_RESERVED_PARAM_SPECS} entry,
 * i.e. added on the LEAF side. They round-trip untouched but cannot be edited.
 */
export function unsupportedReservedKeys(config) {
    return Object.keys(config).filter((key) => isReservedKey(key) && !(key in LEAF_RESERVED_PARAM_SPECS));
}
/**
 * Split a config into reserved (`__leaf__*`) and non-reserved entries.
 */
export function splitReservedKeys(config) {
    const reserved = {};
    const scenario = {};
    for (const key of Object.keys(config)) {
        if (isReservedKey(key)) {
            reserved[key] = config[key];
        }
        else {
            scenario[key] = config[key];
        }
    }
    return { reserved, scenario };
}
