import { Logger } from "../Common/Logger.js";
import { poller } from "../Common/Polling.js";
import { LEAF_DEFAULT_LOG_LEVEL, LEAF_DEFAULT_DIAGNOSTIC_POLICY, LEAF_LOG_LEVEL_KEY, LEAF_TIMEOUT_SECS_KEY, LEAF_DIAGNOSTIC_POLICY_KEY, LEAF_LOG_LEVELS, LEAF_DIAGNOSTIC_POLICIES, } from "../Common/ReservedParams.js";
import { ENSEMBLE_LIST_REQUEST, isEnsembleListResponse, } from "../MessagingSystem/MessageTypes/ConnectedMessages.js";
import { ConnectedRunController, RUN_TIMEOUT_MS, validateRunTimeout, } from "./ConnectedRunController.js";
const LOG = new Logger("ConnectedRunService");
/**
 * Discovery/readiness timeout in milliseconds. Probes repeat until the lens
 * subscribes and replies; ordinary Scenario readiness does not wait for them.
 */
const DEFAULT_PROBE_TIMEOUT_MS = 12000;
/** Re-send cadence for the Ensemble-discovery probe (see {@link DEFAULT_PROBE_TIMEOUT_MS}). */
const DEFAULT_PROBE_POLL_MS = 400;
/** Per-request budget in milliseconds, including work between Rendezvous; independent of {@link RUN_TIMEOUT_MS}. */
const DEVICE_STEP_TIMEOUT_MS = 90000;
/** Ensemble settings shown in the panel and saved with Session rows. */
export const ENSEMBLE_DEFAULT_CONFIG = {
    [LEAF_TIMEOUT_SECS_KEY]: String(RUN_TIMEOUT_MS / 1000),
    [LEAF_LOG_LEVEL_KEY]: LEAF_DEFAULT_LOG_LEVEL,
    [LEAF_DIAGNOSTIC_POLICY_KEY]: LEAF_DEFAULT_DIAGNOSTIC_POLICY,
};
/** Resolve Ensemble settings; timeoutMs overrides the saved budget in milliseconds (-1 disables expiry). */
export function resolveEnsembleSettings(overrides, timeoutMs) {
    for (const key of Object.keys(overrides)) {
        if (!Object.prototype.hasOwnProperty.call(ENSEMBLE_DEFAULT_CONFIG, key)) {
            throw new Error(`Unsupported Ensemble setting "${key}". Allowed: ${Object.keys(ENSEMBLE_DEFAULT_CONFIG).join(", ")}.`);
        }
    }
    const config = { ...ENSEMBLE_DEFAULT_CONFIG, ...overrides };
    if (!LEAF_LOG_LEVELS.includes(config[LEAF_LOG_LEVEL_KEY])) {
        throw new Error(`Invalid Ensemble log level "${config[LEAF_LOG_LEVEL_KEY]}". Expected: ${LEAF_LOG_LEVELS.join(", ")}.`);
    }
    if (!LEAF_DIAGNOSTIC_POLICIES.includes(config[LEAF_DIAGNOSTIC_POLICY_KEY])) {
        throw new Error(`Invalid Ensemble diagnostic policy "${config[LEAF_DIAGNOSTIC_POLICY_KEY]}". Expected: ${LEAF_DIAGNOSTIC_POLICIES.join(", ")}.`);
    }
    const seconds = Number(config[LEAF_TIMEOUT_SECS_KEY]);
    const configuredTimeout = seconds === -1 ? -1 : seconds * 1000;
    validateRunTimeout(configuredTimeout);
    const resolvedTimeout = timeoutMs !== null && timeoutMs !== void 0 ? timeoutMs : configuredTimeout;
    validateRunTimeout(resolvedTimeout);
    return { timeoutMs: resolvedTimeout, config };
}
/** Explain why Ensemble discovery could not obtain a list. */
export function describeDiscoveryFailure(outcome) {
    switch (outcome.kind) {
        case "no-preview": return "Ensemble discovery failed: no Preview panel is open. Open one and retry.";
        case "no-reply": return "Ensemble discovery failed: the lens did not answer. Check the preview and LEAF package, then retry; see the console for probe errors.";
        case "unavailable": return "Ensemble discovery is unavailable: no preview broker or previews provider.";
    }
}
/** One line naming why a ConnectedRun failed, for logs and MCP results. */
export function describeConnectedRunFailure(result) {
    const failed = result.participants
        .filter((p) => p.status !== "succeeded")
        .map((p) => `${p.handle}(${p.role}): ${p.status}${p.detail ? " — " + p.detail : ""}`)
        .join("; ");
    return `${failed || "no Participant failed"}${result.error ? ` [${result.error}]` : ""}`;
}
/**
 * Discovers Ensembles, binds Roles to previews and the paired device, and waits
 * for readiness before starting the {@link ConnectedRunController}.
 */
export class ConnectedRunService {
    constructor(options) {
        var _a, _b;
        this.options = options;
        /** The lens's last *answered* discovery; never a timeout or no-preview result. */
        this.ensembleCache = null;
        // Monotonic source of unique preview-readiness probe tokens.
        this.probeCounter = 0;
        this.destroyed = false;
        this.pendingProbes = new Set();
        this.destruction = new Promise((_, reject) => { this.rejectDestroyed = reject; });
        this.destruction.catch(() => { });
        this.controller = new ConnectedRunController(options.broker, options.runStartTimeoutMs, options.runTimeoutMs);
        this.probeTimeoutMs = (_a = options.probeTimeoutMs) !== null && _a !== void 0 ? _a : DEFAULT_PROBE_TIMEOUT_MS;
        this.probePollMs = (_b = options.probePollMs) !== null && _b !== void 0 ? _b : DEFAULT_PROBE_POLL_MS;
    }
    /** Cancel pending discovery, preparation, and the active run. */
    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.rejectDestroyed(new Error("ConnectedRun was cancelled: the LEAF panel was closed."));
        for (const cancel of this.pendingProbes)
            cancel();
        this.controller.destroy();
    }
    /**
     * Ask the first open preview which Ensembles its lens declares, re-sending
     * the probe until it answers or the window elapses. Only an answered list is
     * cached: a timeout or a missing preview says nothing about the lens.
     * @param forceRefresh - Bypass the cache.
     */
    async discover(forceRefresh = false) {
        if (this.destroyed)
            return { kind: "unavailable" };
        if (forceRefresh)
            this.ensembleCache = null;
        if (this.ensembleCache && !forceRefresh) {
            return { kind: "answered", ensembles: this.ensembleCache };
        }
        const previews = this.livePreviews();
        /* An unavailable GUI does not prove that no preview exists; retry on the probe cadence. */
        if (previews !== null && previews.length === 0) {
            return { kind: "no-preview" };
        }
        const broker = this.options.broker;
        const probe = { postFailures: 0, lastPostError: undefined };
        const ensembles = await this.awaitPanelReply({
            /* Re-resolve each send because a lens reset can replace the preview panel. */
            post: () => {
                const live = this.options.previewsProvider();
                if (live.length === 0)
                    throw new Error("No Preview panel is available for Ensemble discovery.");
                broker.postToPanel(live[0], { type: ENSEMBLE_LIST_REQUEST });
            },
            /* Tokened replies belong to readiness probes, not discovery. */
            match: (message) => isEnsembleListResponse(message) && message.probeId === undefined
                ? message.ensembles
                : undefined,
            probe,
        });
        if (this.destroyed)
            return { kind: "unavailable" };
        if (ensembles === null) {
            LOG.warn(`No Ensemble-discovery reply within ${this.probeTimeoutMs}ms: ${this.noReplyCauses(probe)}`);
            return { kind: "no-reply" };
        }
        this.ensembleCache = ensembles;
        return { kind: "answered", ensembles };
    }
    /**
     * Run a ConnectedRun: bind each Role to a Participant and execute the
     * Ensemble across them. In preview mode every Role binds to an open preview
     * (in declared order); in device mode the last Role binds to the paired
     * device and the rest to previews.
     * @param ensembleId - The Ensemble to run (sent in the scenario-id slot).
     * @param roleNames - The Ensemble's Roles, in binding order.
     * @param timeoutMs - Whole-run budget override in milliseconds; -1 disables execution expiry.
     * @param config - Overrides of {@link ENSEMBLE_DEFAULT_CONFIG}; timeout is in seconds, log level and diagnostics apply to every participant.
     * @throws if settings are invalid, a participant is unavailable, or the binding does not contain
     *   every declared Role exactly once.
     */
    async run(ensembleId, roleNames, timeoutMs, config = {}) {
        var _a, _b, _c;
        this.assertAlive();
        const settings = resolveEnsembleSettings(config, timeoutMs !== null && timeoutMs !== void 0 ? timeoutMs : (config[LEAF_TIMEOUT_SECS_KEY] === undefined ? this.options.runTimeoutMs : undefined));
        if (roleNames.length < 2) {
            throw new Error(`Ensemble "${ensembleId}" needs at least two Roles.`);
        }
        const onDevice = this.options.device.isDeviceMode();
        if (onDevice && !this.options.deviceBus) {
            throw new Error(`Ensemble "${ensembleId}": execute-on-device is on but no device message bus is available.`);
        }
        const previewRoleCount = onDevice ? roleNames.length - 1 : roleNames.length;
        let previews = this.options.previewsProvider();
        if (previews.length < previewRoleCount) {
            (_b = (_a = this.options).ensurePreviews) === null || _b === void 0 ? void 0 : _b.call(_a, previewRoleCount);
            previews = this.options.previewsProvider();
        }
        if (previews.length < previewRoleCount) {
            throw new Error(`Ensemble "${ensembleId}" needs ${previewRoleCount} Preview panel(s) but only ${previews.length} ${previews.length === 1 ? "is" : "are"} open. Open ${previewRoleCount} Preview panel(s) (Window → General → Preview) and run again.`);
        }
        const bound = previews.slice(0, previewRoleCount);
        /* Starts are not replayed, so each bound preview must answer a readiness probe first. */
        for (let i = 0; i < bound.length; i++) {
            const probe = { postFailures: 0, lastPostError: undefined };
            const ensembles = await this.waitForPreviewReady(bound[i], probe);
            this.assertAlive();
            if (ensembles === null) {
                throw new Error(`Ensemble "${ensembleId}": Preview ${i + 1} did not answer LEAF's readiness probe within ${this.probeTimeoutMs}ms: ${this.noReplyCauses(probe)}`);
            }
            const declared = (_c = ensembles.find((e) => e.id === ensembleId)) === null || _c === void 0 ? void 0 : _c.roles;
            if (!declared) {
                throw new Error(`Ensemble "${ensembleId}" is not declared by Preview ${i + 1}.`);
            }
            if (roleNames.length !== declared.length ||
                new Set(roleNames).size !== declared.length ||
                roleNames.some((role) => !declared.includes(role))) {
                throw new Error(`Ensemble "${ensembleId}": Preview ${i + 1} declares Roles (${declared.join(", ")}), but discovery returned (${roleNames.join(", ")}). Load the same lens declarations in every preview.`);
            }
        }
        let deviceLeg = null;
        if (onDevice) {
            const bus = this.options.deviceBus;
            // Bring up a reachable device lens (pushes if none is running).
            await Promise.race([this.options.device.ensureReadyForRun(), this.destruction]);
            this.assertAlive();
            deviceLeg = {
                sendRequest: (message) => bus.sendLeafRequest(message, DEVICE_STEP_TIMEOUT_MS),
            };
        }
        const bindings = roleNames.map((role, i) => {
            const handle = `p${i + 1}`;
            return i < previewRoleCount
                ? { role, handle, panel: bound[i] }
                : { role, handle, device: deviceLeg };
        });
        LOG.info(`Starting ConnectedRun of "${ensembleId}" across ${previewRoleCount} preview(s)${onDevice ? " + 1 device" : ""}.`);
        const result = await this.controller.run(ensembleId, bindings, settings.timeoutMs, settings.config);
        if (result.ok) {
            LOG.info(`✅ ConnectedRun "${ensembleId}" passed (${result.runId}).`);
        }
        else {
            LOG.error(`❌ ConnectedRun "${ensembleId}" failed (${result.runId}): ${describeConnectedRunFailure(result)}`);
        }
        return result;
    }
    assertAlive() {
        if (this.destroyed)
            throw new Error("ConnectedRun was cancelled: the LEAF panel was closed.");
    }
    /**
     * The open previews right now, or `null` if the provider threw. The provider
     * walks the live GUI, which can be torn down mid-flight during a lens-reset
     * panel rebuild; `null` lets callers tell "nothing open" from "could not look".
     */
    livePreviews() {
        try {
            return this.options.previewsProvider();
        }
        catch (error) {
            LOG.debug(`Previews provider threw (GUI mid-rebuild?): ${error}`);
            return null;
        }
    }
    /** Why a probe went unanswered — the honest causes, given whether it could be sent at all. */
    noReplyCauses(probe) {
        var _a;
        if (probe.postFailures > 0) {
            return `the probe could not be sent to the preview (${probe.postFailures} attempt(s) failed: ${(_a = probe.lastPostError) !== null && _a !== void 0 ? _a : "unknown error"}).`;
        }
        return "the lens is still loading, its LEAF package predates ConnectedRuns, or the LEAF MessagingBridge is not in the scene.";
    }
    /** Probe until the Preview replies with its declarations, or return null on timeout. */
    waitForPreviewReady(panel, probe) {
        const broker = this.options.broker;
        /* The token identifies this preview's reply despite unstable panel identity. */
        const probeId = `probe_${++this.probeCounter}`;
        const request = { type: ENSEMBLE_LIST_REQUEST, probeId };
        return this.awaitPanelReply({
            post: () => broker.postToPanel(panel, request),
            match: (message) => isEnsembleListResponse(message) && message.probeId === probeId
                ? message.ensembles
                : undefined,
            probe,
        });
    }
    /**
     * Retry the probe until a matching Ensemble list arrives; return null on
     * timeout or cancellation.
     */
    awaitPanelReply(options) {
        const broker = this.options.broker;
        return new Promise((resolve) => {
            let settled = false;
            let unsubscribe = null;
            let stopRepeating = null;
            let timeout;
            const finish = (value) => {
                if (settled) {
                    return;
                }
                settled = true;
                this.pendingProbes.delete(cancel);
                unsubscribe === null || unsubscribe === void 0 ? void 0 : unsubscribe();
                stopRepeating === null || stopRepeating === void 0 ? void 0 : stopRepeating();
                if (timeout)
                    clearTimeout(timeout);
                timeout = undefined;
                resolve(value);
            };
            const cancel = () => finish(null);
            this.pendingProbes.add(cancel);
            unsubscribe = broker.onMessageFromPanel((panelResponse) => {
                const message = panelResponse.message;
                if (settled) {
                    return;
                }
                const value = options.match(message);
                if (value !== undefined) {
                    finish(value);
                }
            });
            const post = () => {
                if (settled) {
                    return;
                }
                try {
                    options.post();
                }
                catch (error) {
                    const probe = options.probe;
                    probe.postFailures++;
                    probe.lastPostError = error instanceof Error ? error.message : String(error);
                    if (probe.postFailures === 1) {
                        LOG.warn(`Probe send to the preview failed; retrying on the poll cadence: ${error}`);
                    }
                }
            };
            stopRepeating = poller.repeatEvery(post, this.probePollMs);
            timeout = setTimeout(() => finish(null), this.probeTimeoutMs);
            post();
        });
    }
}
