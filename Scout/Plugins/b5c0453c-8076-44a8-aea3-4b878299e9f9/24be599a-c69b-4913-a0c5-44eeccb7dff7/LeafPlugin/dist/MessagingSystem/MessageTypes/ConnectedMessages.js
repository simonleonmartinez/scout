/**
 * Plugin-side mirror of `Leaf.lspkg/Scenarios/connected/ConnectedMessages.ts`.
 */
/** Config key carrying the Role the orchestrator assigned a Participant. */
export const LEAF_ROLE_KEY = "__leaf__role";
/** Config key carrying the stable Handle (e.g. "p1"). */
export const LEAF_HANDLE_KEY = "__leaf__handle";
/** Run identity: coordinator nonce / positive decimal safe-integer sequence. Echoed unchanged. */
export const LEAF_RUN_ID_KEY = "__leaf__run_id";
/** Config key carrying the coordinator's run-start budget in milliseconds. */
export const LEAF_RUN_START_TIMEOUT_MS_KEY = "__leaf__run_start_timeout_ms";
/** Default run-start admission budget in milliseconds. */
export const DEFAULT_RUN_START_TIMEOUT_MS = 15000;
/** The implicit Rendezvous every Participant reaches before its Scenario runs. */
export const RUN_START_RENDEZVOUS = "__leaf__run_start__";
export const RENDEZVOUS_ARRIVED = "leaf.connected.rendezvousArrived";
export const RENDEZVOUS_RELEASE = "leaf.connected.rendezvousRelease";
/** Plugin → Participant: the orchestrator aborted the run; stop now. Pushed to previews, sent as a request to the device. */
export const CONNECTED_RUN_ABORTED = "leaf.connected.runAborted";
export const PARTICIPANT_RESULT = "leaf.connected.participantResult";
export const ENSEMBLE_LIST_REQUEST = "leaf.connected.ensembleListRequest";
export const ENSEMBLE_LIST_RESPONSE = "leaf.connected.ensembleListResponse";
/** Device steps carry releases and read parks or terminal results; parks remain readable until released. */
export const RENDEZVOUS_STEP_REQUEST = "leaf.connected.rendezvousStepRequest";
export const RENDEZVOUS_STEP_RESPONSE = "leaf.connected.rendezvousStepResponse";
/**
 * Validate a raw device step reply into a {@link RendezvousStepResponse}. The
 * wire carries unvalidated JSON; a malformed reply must fail the Participant
 * with a message that shows the payload, not drive the arbiter with
 * `undefined` fields.
 * @throws with the offending payload if the shape is not a step response.
 */
export function parseStepResponse(raw, runId) {
    const r = raw;
    const bad = (why) => {
        var _a;
        throw new Error(`Device step reply for ConnectedRun ${runId} malformed (${why}): ${(_a = JSON.stringify(raw)) === null || _a === void 0 ? void 0 : _a.slice(0, 300)}`);
    };
    if (!r || typeof r !== "object" || r.type !== RENDEZVOUS_STEP_RESPONSE) {
        return bad(`expected type "${RENDEZVOUS_STEP_RESPONSE}"`);
    }
    if (r.runId !== runId) {
        return bad(`runId "${String(r.runId)}" is not the current run`);
    }
    if (r.state === "parked") {
        if (typeof r.rendezvous !== "string" ||
            !r.rendezvous ||
            typeof r.seq !== "number" ||
            !Number.isSafeInteger(r.seq) ||
            r.seq < 0) {
            return bad("parked without rendezvous/seq");
        }
        return {
            type: RENDEZVOUS_STEP_RESPONSE,
            runId,
            state: "parked",
            rendezvous: r.rendezvous,
            seq: r.seq,
        };
    }
    if (r.state === "done") {
        if (r.status !== "succeeded" && r.status !== "failed") {
            return bad("done without a succeeded/failed status");
        }
        return r.detail === undefined
            ? { type: RENDEZVOUS_STEP_RESPONSE, runId, state: "done", status: r.status }
            : {
                type: RENDEZVOUS_STEP_RESPONSE,
                runId,
                state: "done",
                status: r.status,
                detail: String(r.detail),
            };
    }
    return bad(`unknown state "${String(r.state)}"`);
}
/** Validate an Ensemble discovery response, including its declarations and optional probe token. */
export function isEnsembleListResponse(message) {
    const response = message;
    return ((response === null || response === void 0 ? void 0 : response.type) === ENSEMBLE_LIST_RESPONSE &&
        (response.probeId === undefined || typeof response.probeId === "string") &&
        Array.isArray(response.ensembles) &&
        response.ensembles.every((ensemble) => ensemble &&
            typeof ensemble.id === "string" &&
            Array.isArray(ensemble.roles) &&
            ensemble.roles.every((role) => typeof role === "string")));
}
/** Validate a Rendezvous arrival before using its identity and sequence. */
export function isRendezvousArrived(message) {
    const arrived = message;
    return ((arrived === null || arrived === void 0 ? void 0 : arrived.type) === RENDEZVOUS_ARRIVED &&
        typeof arrived.runId === "string" &&
        typeof arrived.participant === "string" &&
        typeof arrived.rendezvous === "string" &&
        arrived.rendezvous.length > 0 &&
        typeof arrived.seq === "number" &&
        Number.isSafeInteger(arrived.seq) &&
        arrived.seq >= 0);
}
/** Validate a Participant result, including its status and optional failure detail. */
export function isParticipantResult(message) {
    const result = message;
    return ((result === null || result === void 0 ? void 0 : result.type) === PARTICIPANT_RESULT &&
        typeof result.runId === "string" &&
        typeof result.participant === "string" &&
        (result.status === "succeeded" || result.status === "failed") &&
        (result.detail === undefined || typeof result.detail === "string"));
}
