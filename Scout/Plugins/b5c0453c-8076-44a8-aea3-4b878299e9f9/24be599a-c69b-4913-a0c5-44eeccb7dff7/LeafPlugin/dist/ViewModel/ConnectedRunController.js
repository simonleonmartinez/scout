import { defer } from "../Common/Deferred.js";
import { Logger } from "../Common/Logger.js";
import { RENDEZVOUS_RELEASE, CONNECTED_RUN_ABORTED, RUN_START_RENDEZVOUS, RENDEZVOUS_ARRIVED, PARTICIPANT_RESULT, RENDEZVOUS_STEP_REQUEST, LEAF_ROLE_KEY, LEAF_HANDLE_KEY, LEAF_RUN_ID_KEY, LEAF_RUN_START_TIMEOUT_MS_KEY, DEFAULT_RUN_START_TIMEOUT_MS, isRendezvousArrived, isParticipantResult, parseStepResponse, } from "../MessagingSystem/MessageTypes/ConnectedMessages.js";
const LOG = new Logger("ConnectedRunController");
/** Default whole-run budget in milliseconds; device requests have a separate timeout in ConnectedRunService. */
export const RUN_TIMEOUT_MS = 270000;
/** Largest portable setTimeout delay, in milliseconds. */
export const MAX_RUN_TIMEOUT_MS = 2147483647;
const DEVICE_PARK_POLL_MS = 250;
/** Validate a whole-run budget in milliseconds; -1 disables execution expiry. */
export function validateRunTimeout(timeoutMs) {
    if (timeoutMs !== -1 &&
        (!Number.isFinite(timeoutMs) ||
            timeoutMs <= 0 ||
            timeoutMs > MAX_RUN_TIMEOUT_MS)) {
        throw new Error(`ConnectedRun timeout must be -1 or a positive, finite number of milliseconds up to ${MAX_RUN_TIMEOUT_MS}.`);
    }
}
/** Rejection for Participants still pending when a run aborts; `kind` becomes their result status. */
class RunAbortError extends Error {
    constructor(message, kind) {
        super(message);
        this.kind = kind;
    }
}
/**
 * Coordinates preview and device Participants and releases their Rendezvous.
 * Inbound messages correlate by run id and Handle because editor panel wrappers
 * are unstable. Preview drivers push through the broker; device drivers step
 * over the reply-only bus. Participants never signal each other.
 */
export class ConnectedRunController {
    constructor(broker, runStartTimeoutMs = DEFAULT_RUN_START_TIMEOUT_MS, runTimeoutMs = RUN_TIMEOUT_MS) {
        this.broker = broker;
        this.runStartTimeoutMs = runStartTimeoutMs;
        this.runTimeoutMs = runTimeoutMs;
        this.epoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
        this.runCounter = 0;
        this.active = null;
        this.destroyed = false;
        if (!Number.isFinite(runStartTimeoutMs) || runStartTimeoutMs <= 0) {
            this.runStartTimeoutMs = DEFAULT_RUN_START_TIMEOUT_MS;
        }
        if (runTimeoutMs !== -1 &&
            (!Number.isFinite(runTimeoutMs) ||
                runTimeoutMs <= 0 ||
                runTimeoutMs > MAX_RUN_TIMEOUT_MS)) {
            this.runTimeoutMs = RUN_TIMEOUT_MS;
        }
        this.unsubscribe = this.broker.onMessageFromPanel(({ message }) => { var _a; return (_a = this.active) === null || _a === void 0 ? void 0 : _a.onInbound(message); });
    }
    /** @returns true if a ConnectedRun is currently in progress. */
    isRunning() {
        return this.active !== null;
    }
    /**
     * Run an Ensemble against a Binding. Resolves with a per-Participant result
     * (never rejects on a Participant failure — the failure is attributed in the
     * result), rejects only on a controller-level error.
     * @param timeoutMs - Whole-run budget in milliseconds; -1 disables expiry. Defaults to the controller's budget (initially {@link RUN_TIMEOUT_MS}).
     * @param config - Settings forwarded to every participant; the coordinator owns execution expiry.
     */
    async run(ensembleId, bindings, timeoutMs = this.runTimeoutMs, config = {}) {
        validateRunTimeout(timeoutMs);
        if (this.destroyed)
            throw new Error("ConnectedRun controller was destroyed: the LEAF panel was closed.");
        if (this.active) {
            throw new Error("A ConnectedRun is already in progress.");
        }
        if (bindings.length < 2) {
            throw new Error(`A ConnectedRun needs at least two Participants; got ${bindings.length}.`);
        }
        const runId = `${this.epoch}/${++this.runCounter}`;
        const active = new ActiveRun(runId, ensembleId, bindings, this.broker, this.runStartTimeoutMs, timeoutMs, config);
        this.active = active;
        try {
            return await active.execute();
        }
        finally {
            active.dispose();
            if (this.active === active) {
                this.active = null;
            }
        }
    }
    /**
     * Cancel any in-flight run and release its timers. Called when the plugin
     * panel is torn down, so an abandoned run's watchdog does not fire a stray
     * "run timed out" long after the panel is gone.
     */
    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.unsubscribe();
        this.cancel("the LEAF panel was closed");
        this.active = null;
    }
    /** Cancel the current run while keeping the controller available for another run. */
    cancel(reason = "the ConnectedRun was cancelled") {
        var _a;
        (_a = this.active) === null || _a === void 0 ? void 0 : _a.cancel(reason);
    }
}
/** State and arbitration for a single in-flight ConnectedRun. */
class ActiveRun {
    constructor(runId, ensembleId, bindings, broker, runStartTimeoutMs, runTimeoutMs, config) {
        this.runId = runId;
        this.ensembleId = ensembleId;
        this.bindings = bindings;
        this.broker = broker;
        this.runStartTimeoutMs = runStartTimeoutMs;
        this.runTimeoutMs = runTimeoutMs;
        this.config = config;
        this.participants = new Map();
        this.rendezvous = new Map();
        /*
         * Raw setTimeout, deliberately: the two watchdogs need cancellation
         * (dispose() must silence an abandoned run), which poller.sleep does not
         * offer, and rooting the handles in this array prevents the GC-dropped-timer
         * hazard poller exists to solve (Polling.ts).
         */
        this.timers = [];
        this.aborted = false;
        /* A participant keeps the same budget as a fallback if the coordinator's abort is lost. */
        this.config = {
            ...config,
            __leaf__timeout_secs: runTimeoutMs === -1 ? "-1" : String(runTimeoutMs / 1000),
        };
        for (const binding of bindings) {
            this.participants.set(binding.handle, {
                binding,
                completion: defer(),
                driver: this.createDriver(binding),
            });
        }
    }
    /**
     * Build the outbound driver for a Participant. Both legs feed the same arbiter:
     * a preview leg pushes start/release to its panel and its inbound arrivals come
     * back through the broker (wired in {@link ConnectedRunController}); a device
     * leg is reply-only, so its driver pulls via step requests and synthesises the
     * arrivals/results the preview pushes.
     */
    createDriver(binding) {
        if (binding.device) {
            return new DeviceParticipantDriver(this.ensembleId, binding, this.runId, this.runStartTimeoutMs, this.config, binding.device, (message) => this.onInbound(message), (detail, kind) => this.onDriverError(binding, detail, kind));
        }
        return new PreviewParticipantDriver(this.ensembleId, binding, binding.panel, this.runId, this.runStartTimeoutMs, this.config, this.broker, (detail) => this.onDriverError(binding, detail));
    }
    onDriverError(binding, detail, kind = "transport-error") {
        var _a;
        if (this.aborted)
            return;
        (_a = this.participants.get(binding.handle)) === null || _a === void 0 ? void 0 : _a.completion.reject(new Error(detail));
        this.abort(`${binding.handle} could not be driven: ${detail}`, kind);
    }
    async execute() {
        LOG.info(`ConnectedRun ${this.runId}: Ensemble "${this.ensembleId}" — ${this.bindings
            .map((b) => `${b.handle}=${b.role}`)
            .join(", ")}`);
        // Fail if not everyone reaches run-start: the "never opted in" signal.
        this.timers.push(setTimeout(() => {
            const state = this.rendezvous.get(this.key(RUN_START_RENDEZVOUS, 0));
            if (!(state === null || state === void 0 ? void 0 : state.released)) {
                const missing = [...this.participants.keys()].filter((h) => { var _a; return !((_a = state === null || state === void 0 ? void 0 : state.arrived.has(h)) !== null && _a !== void 0 ? _a : false); });
                this.abort(`did not start: ${missing.join(", ")}. ${this.unattributedStartRefusal
                    ? `A preview reported: ${this.unattributedStartRefusal}. That reply had no run id and may belong to an earlier request.`
                    : "Did the lens opt in with @enableConnectedRuns()?"}`, "timeout");
            }
        }, this.runStartTimeoutMs));
        if (this.runTimeoutMs !== -1) {
            this.timers.push(setTimeout(() => this.abort("run timed out", "timeout"), this.runTimeoutMs));
        }
        /* Subscribe to every result before starting any Participant. */
        const completion = Promise.all(this.bindings.map((b) => this.awaitParticipant(b)));
        for (const binding of this.bindings) {
            if (this.aborted)
                break;
            this.sendStart(binding);
        }
        await completion;
        const participants = this.bindings.map((b) => {
            var _a, _b;
            return (_b = (_a = this.participants.get(b.handle)) === null || _a === void 0 ? void 0 : _a.result) !== null && _b !== void 0 ? _b : {
                handle: b.handle,
                role: b.role,
                status: "error",
                detail: "no result recorded",
            };
        });
        const ok = participants.every((p) => p.status === "succeeded");
        /* An abort after all Participants succeed does not change the result. */
        return {
            runId: this.runId,
            ok,
            participants,
            error: ok ? undefined : this.abortReason,
        };
    }
    sendStart(binding) {
        this.participants.get(binding.handle).driver.start();
    }
    async awaitParticipant(binding) {
        try {
            const outcome = await this.participants.get(binding.handle).completion
                .promise;
            this.record(binding, outcome.status, outcome.detail);
            if (outcome.status === "failed") {
                /* Fail parked peers immediately when a Participant fails. */
                this.abort(`${binding.handle}'s Scenario failed`, "peer-failed");
            }
            else {
                this.checkRendezvousProgress();
            }
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            /* Distinguish watchdog timeouts, cancellation, and transport errors in results. */
            const status = error instanceof RunAbortError ? error.kind : "error";
            this.record(binding, status, detail);
        }
    }
    record(binding, status, detail) {
        const participant = this.participants.get(binding.handle);
        if (participant.result) {
            return;
        }
        participant.result = {
            handle: binding.handle,
            role: binding.role,
            status,
            detail,
        };
        const label = `${binding.handle} (${binding.role})`;
        if (status === "succeeded") {
            LOG.info(`ConnectedRun ${this.runId}: ${label} ✅ ${status}`);
        }
        else {
            LOG.error(`ConnectedRun ${this.runId}: ${label} ❌ ${status}${detail ? ` — ${detail}` : ""}`);
        }
    }
    onInbound(message) {
        var _a, _b, _c;
        const payload = message;
        if (payload.runId === this.runId &&
            (payload.type === RENDEZVOUS_ARRIVED ||
                payload.type === PARTICIPANT_RESULT)) {
            const binding = (_b = this.participants.get((_a = payload.participant) !== null && _a !== void 0 ? _a : "")) === null || _b === void 0 ? void 0 : _b.binding;
            if (!binding) {
                this.abort(`Unattributed ${payload.type} message in the current run: ${JSON.stringify(message).slice(0, 300)}`, "protocol-error");
                return;
            }
            if ((payload.type === RENDEZVOUS_ARRIVED &&
                !isRendezvousArrived(message)) ||
                (payload.type === PARTICIPANT_RESULT && !isParticipantResult(message))) {
                this.onDriverError(binding, `Malformed ${payload.type} message from ${binding.handle}: ${JSON.stringify(message).slice(0, 300)}`, "protocol-error");
                return;
            }
        }
        const startReply = message;
        if (startReply.type === "ScenarioStartResponse" &&
            startReply.status === "error" &&
            startReply.scenarioId === this.ensembleId) {
            this.unattributedStartRefusal =
                typeof startReply.reason === "string" && startReply.reason
                    ? `lens refused the start: ${startReply.reason}`
                    : "lens refused the start — see its console";
            LOG.warn(`ConnectedRun ${this.runId}: a preview reported: ${this.unattributedStartRefusal}. The reply has no run id; waiting for an attributed result because it may belong to an earlier request.`);
            return;
        }
        if (isParticipantResult(message) && message.runId === this.runId) {
            if (message.status === "succeeded" && !this.runStartReleased())
                return;
            (_c = this.participants
                .get(message.participant)) === null || _c === void 0 ? void 0 : _c.completion.resolve({ status: message.status, detail: message.detail });
            return;
        }
        if (isRendezvousArrived(message) && message.runId === this.runId) {
            const participant = this.participants.get(message.participant);
            if (!participant)
                return;
            const state = this.stateFor(message.rendezvous, message.seq);
            if (state.released) {
                /* Duplicate arrivals must not make an already-released Participant appear parked. */
                return;
            }
            state.arrived.add(message.participant);
            participant.waitingAt = this.key(message.rendezvous, message.seq);
            LOG.debug(`ConnectedRun ${this.runId}: ${message.participant} arrived at "${message.rendezvous}" (${state.arrived.size}/${this.participants.size})`);
            this.tryRelease(state);
            this.checkRendezvousProgress();
            return;
        }
    }
    /** Abort a Rendezvous that cannot release because a peer finished or reached a different point. */
    checkRendezvousProgress() {
        if (this.aborted)
            return;
        const participants = [...this.participants.values()];
        const waiting = participants.filter((p) => p.waitingAt !== undefined);
        for (const participant of waiting) {
            const state = this.rendezvous.get(participant.waitingAt);
            const finished = participants.find((peer) => peer.result && !state.arrived.has(peer.binding.handle));
            if (finished) {
                this.abort(`${finished.binding.handle} finished before reaching ${participant.binding.handle}'s Rendezvous "${state.name}" (${state.seq}); it cannot release.`, "rendezvous-mismatch");
                return;
            }
        }
        if (waiting.length < this.participants.size)
            return;
        if (new Set(waiting.map((p) => p.waitingAt)).size <= 1)
            return;
        const detail = waiting
            .map((p) => `${p.binding.handle} → ${p.waitingAt}`)
            .join(", ");
        this.abort(`Participants reached different Rendezvous and cannot proceed: ${detail}`, "rendezvous-mismatch");
    }
    /** Release a Rendezvous once every Participant has arrived. */
    tryRelease(state) {
        if (state.released || this.aborted) {
            return;
        }
        if (state.arrived.size < this.participants.size) {
            return;
        }
        state.released = true;
        this.releaseAll(state, "ok");
        LOG.debug(`ConnectedRun ${this.runId}: released "${state.name}"`);
    }
    releaseAll(state, status, reason) {
        /* Preview releases are pushed; the device receives them on its next step. */
        const release = {
            type: RENDEZVOUS_RELEASE,
            runId: this.runId,
            rendezvous: state.name,
            seq: state.seq,
            status,
            reason,
        };
        for (const binding of this.bindings) {
            if (this.aborted && status === "ok")
                break;
            this.participants.get(binding.handle).driver.release(release);
        }
        /* Only clear waits for this release; synchronous replies may already have advanced a peer. */
        const releasedKey = this.key(state.name, state.seq);
        for (const participant of this.participants.values()) {
            if (participant.waitingAt === releasedKey) {
                participant.waitingAt = undefined;
            }
        }
    }
    /** Abort the run: error-release arrived-but-unreleased Rendezvous, fail waiters. */
    abort(reason, kind) {
        if (this.aborted) {
            return;
        }
        this.aborted = true;
        this.abortReason = reason;
        LOG.error(`ConnectedRun ${this.runId}: aborting — ${reason}`);
        for (const state of this.rendezvous.values()) {
            if (!state.released && state.arrived.size > 0) {
                state.released = true;
                this.releaseAll(state, "error", reason);
            }
        }
        for (const participant of this.participants.values()) {
            if (!participant.result) {
                participant.completion.reject(new RunAbortError(reason, kind));
                /* Also notify running Participants that are not parked at a Rendezvous. */
                participant.driver.abort(reason);
            }
        }
    }
    /** Whether every Participant has passed the run-start Rendezvous. */
    runStartReleased() {
        var _a;
        return (((_a = this.rendezvous.get(this.key(RUN_START_RENDEZVOUS, 0))) === null || _a === void 0 ? void 0 : _a.released) === true);
    }
    stateFor(name, seq) {
        const key = this.key(name, seq);
        let state = this.rendezvous.get(key);
        if (!state) {
            state = { name, seq, arrived: new Set(), released: false };
            this.rendezvous.set(key, state);
        }
        return state;
    }
    key(name, seq) {
        return `${name}#${seq}`;
    }
    /** Externally cancel this run: abort it and release its timers immediately. */
    cancel(reason) {
        this.abort(reason, "cancelled");
        this.dispose();
    }
    dispose() {
        for (const timer of this.timers) {
            clearTimeout(timer);
        }
        this.timers.length = 0;
    }
}
/**
 * Shared start payload. Suppress overlays because ConnectedRuns retain lens
 * state between runs.
 */
function scenarioStartRequest(ensembleId, binding, runId, runStartTimeoutMs, config) {
    return {
        type: "ScenarioStartRequest",
        scenarioId: ensembleId,
        config: {
            ...config,
            [LEAF_ROLE_KEY]: binding.role,
            [LEAF_HANDLE_KEY]: binding.handle,
            [LEAF_RUN_ID_KEY]: runId,
            [LEAF_RUN_START_TIMEOUT_MS_KEY]: String(runStartTimeoutMs),
            __leaf__diagnostic_report_duration_ms: "0",
        },
    };
}
/**
 * Drives a device through serial step requests and feeds replies to the arbiter.
 * Polls while parked to collect local failures; queued releases go out as soon
 * as the current request settles.
 */
class DeviceParticipantDriver {
    constructor(ensembleId, binding, runId, runStartTimeoutMs, config, device, onInbound, onError) {
        this.ensembleId = ensembleId;
        this.binding = binding;
        this.runId = runId;
        this.runStartTimeoutMs = runStartTimeoutMs;
        this.config = config;
        this.device = device;
        this.onInbound = onInbound;
        this.onError = onError;
        this.pendingReleases = [];
        this.pumping = false;
        this.done = false;
    }
    start() {
        void this.run();
    }
    /** Queue the arbiter's release; delivered on the next step. */
    release(message) {
        this.pendingReleases.push({
            rendezvous: message.rendezvous,
            seq: message.seq,
            status: message.status,
            reason: message.reason,
        });
        void this.pump();
    }
    async run() {
        try {
            const reply = (await this.device.sendRequest(scenarioStartRequest(this.ensembleId, this.binding, this.runId, this.runStartTimeoutMs, this.config)));
            if ((reply === null || reply === void 0 ? void 0 : reply.status) === "error") {
                /* A refused start has no Scenario to answer a step request. */
                this.fail(new Error(typeof reply.reason === "string" && reply.reason
                    ? `the device lens refused the start: ${reply.reason}`
                    : "the device lens refused the start; see the device log for the reason"), "start request", "start-refused");
                return;
            }
        }
        catch (error) {
            this.fail(error, "start request");
            return;
        }
        // Fetch the first park (the implicit run-start Rendezvous).
        await this.pump();
    }
    async pump() {
        if (this.pumping || this.done) {
            return;
        }
        if (this.pollTimer)
            clearTimeout(this.pollTimer);
        this.pollTimer = undefined;
        this.pumping = true;
        let releases = [];
        try {
            do {
                if (this.done) {
                    return;
                }
                releases = this.pendingReleases;
                this.pendingReleases = [];
                const request = {
                    type: RENDEZVOUS_STEP_REQUEST,
                    runId: this.runId,
                    releases,
                };
                const raw = await this.device.sendRequest(request);
                if (this.done) {
                    /* Ignore a reply from a step that was aborted while in flight. */
                    return;
                }
                let step;
                try {
                    step = parseStepResponse(raw, this.runId);
                }
                catch (error) {
                    this.fail(error, "step response", "protocol-error");
                    return;
                }
                if (step.state === "done") {
                    this.done = true;
                    const result = {
                        type: PARTICIPANT_RESULT,
                        runId: this.runId,
                        participant: this.binding.handle,
                        status: step.status,
                        detail: step.detail,
                    };
                    this.onInbound(result);
                    return;
                }
                /* The arrival may synchronously queue a release if this device was the last to arrive. */
                const arrival = {
                    type: RENDEZVOUS_ARRIVED,
                    runId: this.runId,
                    participant: this.binding.handle,
                    rendezvous: step.rendezvous,
                    seq: step.seq,
                };
                this.onInbound(arrival);
            } while (!this.done && this.pendingReleases.length > 0);
        }
        catch (error) {
            this.fail(error, `step request (releases: ${releases.map((r) => `${r.rendezvous}#${r.seq}`).join(", ") || "none"})`);
        }
        finally {
            this.pumping = false;
            if (!this.done) {
                this.pollTimer = setTimeout(() => {
                    this.pollTimer = undefined;
                    void this.pump();
                }, DEVICE_PARK_POLL_MS);
            }
        }
    }
    abort(reason) {
        if (this.done) {
            return;
        }
        this.done = true;
        if (this.pollTimer)
            clearTimeout(this.pollTimer);
        this.pollTimer = undefined;
        /* Discard queued releases so they cannot create a waiter for an aborted run. */
        this.pendingReleases = [];
        /* Send the abort independently of queued releases. */
        const message = {
            type: CONNECTED_RUN_ABORTED,
            runId: this.runId,
            reason,
        };
        void this.device.sendRequest(message).catch((error) => {
            LOG.warn(`ConnectedRun ${this.runId}: could not deliver the abort to ${this.binding.handle}; its Scenario may still be running on the device: ${error}`);
        });
    }
    /** Fail this Participant, naming the request that failed. */
    fail(error, during, kind = "transport-error") {
        if (this.done)
            return;
        const detail = error instanceof Error ? error.message : String(error);
        const reason = `${during} failed: ${detail}`;
        this.abort(reason);
        this.onError(reason, kind);
    }
}
/**
 * Drives one preview Participant over the push transport. The preview leg is
 * bidirectional `postMessage`: the start request and each release are pushed to
 * the panel, and the lens's arrivals/results are pushed back through the broker
 * into the shared arbiter (wired once in {@link ConnectedRunController}). So this
 * driver owns only the outbound half — there is nothing to pull.
 */
class PreviewParticipantDriver {
    constructor(ensembleId, binding, panel, runId, runStartTimeoutMs, config, broker, onError) {
        this.ensembleId = ensembleId;
        this.binding = binding;
        this.panel = panel;
        this.runId = runId;
        this.runStartTimeoutMs = runStartTimeoutMs;
        this.config = config;
        this.broker = broker;
        this.onError = onError;
    }
    start() {
        try {
            this.broker.postToPanel(this.panel, scenarioStartRequest(this.ensembleId, this.binding, this.runId, this.runStartTimeoutMs, this.config));
        }
        catch (error) {
            this.onError(`start request failed: ${error}`);
        }
    }
    release(message) {
        try {
            this.broker.postToPanel(this.panel, message);
        }
        catch (error) {
            this.onError(`release ${message.rendezvous}#${message.seq} failed: ${error}`);
        }
    }
    abort(reason) {
        const message = {
            type: CONNECTED_RUN_ABORTED,
            runId: this.runId,
            reason,
        };
        try {
            this.broker.postToPanel(this.panel, message);
        }
        catch (error) {
            /* A failed send can leave the Participant running; preserve that diagnostic. */
            LOG.warn(`ConnectedRun ${this.runId}: could not deliver the abort to ${this.binding.handle}; its Scenario may still be running: ${error}`);
        }
    }
}
