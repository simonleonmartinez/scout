import Event from "./Common/Event.js";
import { LEAF_DEFAULT_TIMEOUT_SECS, LEAF_TIMEOUT_SECS_KEY, } from "./Common/ReservedParams.js";
const POLL_INTERVAL_MS = 100;
const POLL_MAX_RETRIES = 10;
const MS_PER_SEC = 1000;
export const SCENARIO_LIST_REQUEST_CANCELLED_ERROR = "Scenario list request cancelled";
/** Whether an error is the deliberate cancellation of a scenario-list request. */
export function isScenarioListCancellation(error) {
    const message = error instanceof Error ? error.message : String(error);
    return message === SCENARIO_LIST_REQUEST_CANCELLED_ERROR;
}
export const SCENARIO_RUN_CANCELLED_ERROR = "Scenario run cancelled";
/**
 * MessageClient is responsible for communicating with the lens.
 * It is used by the PluginViewModel to request scenario list from the lens.
 */
export class MessageClient {
    constructor(messagePublisher) {
        this.messagePublisher = messagePublisher;
        this.scenarioRunStateEvent = new Event();
        /**
         * Subscribe to scenario run state changes.
         */
        this.onScenarioRunStateChange = this.scenarioRunStateEvent.publicApi();
    }
    /**
     * Request scenario list from the scene.
     * @param maxRetries Maximum number of retry attempts. If maxRetries is -1, will keep retrying indefinitely
     * @returns Promise that resolves with scenarios or rejects with error
     */
    async requestScenarioList(maxRetries = POLL_MAX_RETRIES) {
        return this.requestScenarioListInternal(maxRetries);
    }
    /**
     *
     * @param maxRetries Maximum number of retry attempts. If maxRetries is -1, will keep retrying indefinitely
     * @param retryCount Current retry count
     * @returns Promise that resolves with scenarios or rejects with error
     */
    requestScenarioListInternal(maxRetries, retryCount = 0) {
        return new Promise((resolve, reject) => {
            if (maxRetries != -1 && retryCount >= maxRetries) {
                throw new Error(`Failed to get scenario list after ${maxRetries} attempts`);
            }
            // Clear any existing retry timeout
            if (this.scenarioListRetryTimeout) {
                clearTimeout(this.scenarioListRetryTimeout);
                this.scenarioListRetryTimeout = undefined;
            }
            let responseReceived = false;
            // Subscribe to the response
            const unsubscribe = this.messagePublisher.subscribe("ScenarioListResponse", (response) => {
                const scenarioListResponse = response;
                responseReceived = true;
                if (this.scenarioListRetryTimeout) {
                    clearTimeout(this.scenarioListRetryTimeout);
                    this.scenarioListRetryTimeout = undefined;
                }
                this.scenarioListCancel = undefined;
                unsubscribe();
                resolve(scenarioListResponse.scenarios);
            });
            /*
             * Tear down the whole retry chain when superseded: otherwise an indefinite
             * (-1) request keeps re-sending against whatever target is active after a
             * toggle. Rejecting the innermost attempt propagates through the chain.
             */
            this.scenarioListCancel = () => {
                responseReceived = true;
                if (this.scenarioListRetryTimeout) {
                    clearTimeout(this.scenarioListRetryTimeout);
                    this.scenarioListRetryTimeout = undefined;
                }
                unsubscribe();
                reject(new Error(SCENARIO_LIST_REQUEST_CANCELLED_ERROR));
            };
            // Send the request
            this.messagePublisher.notify({
                type: "ScenarioListRequest",
            });
            // Retry after a timeout
            this.scenarioListRetryTimeout = setTimeout(async () => {
                if (!responseReceived) {
                    unsubscribe();
                    try {
                        const scenarios = await this.requestScenarioListInternal(maxRetries, retryCount + 1);
                        resolve(scenarios);
                    }
                    catch (error) {
                        reject(error);
                    }
                }
            }, POLL_INTERVAL_MS);
        });
    }
    /**
     * Cancel the scenario run.
     * Used after lens reset to stop waiting for a lens-response and cleans up resources.
     * Note: Does not cancel the scenario execution on the lens side.
     */
    cancelScenarioRun() {
        var _a;
        // Reject the in-flight run (if any) so its awaiter doesn't hang forever.
        const reject = this.scenarioRunReject;
        (_a = this.scenarioRunCleanup) === null || _a === void 0 ? void 0 : _a.call(this);
        reject === null || reject === void 0 ? void 0 : reject(new Error(SCENARIO_RUN_CANCELLED_ERROR));
    }
    /**
     * Cancel a pending scenario-list request (and its retry loop). The pending
     * promise rejects with {@link SCENARIO_LIST_REQUEST_CANCELLED_ERROR}.
     */
    cancelScenarioListRequest() {
        const cancel = this.scenarioListCancel;
        this.scenarioListCancel = undefined;
        cancel === null || cancel === void 0 ? void 0 : cancel();
    }
    /**
     * Release resources (pending run + the indefinite scenario-list poll) so a
     * destroyed instance can be garbage collected across plugin resets.
     */
    destroy() {
        this.cancelScenarioRun();
        this.cancelScenarioListRequest();
        if (this.scenarioListRetryTimeout) {
            clearTimeout(this.scenarioListRetryTimeout);
            this.scenarioListRetryTimeout = undefined;
        }
    }
    /**
     * Resolve the run timeout (ms) from the scenario config. A negative value
     * disables the timeout; an absent/invalid value falls back to the default.
     */
    resolveTimeoutMs(scenario) {
        var _a;
        const raw = (_a = scenario.config[LEAF_TIMEOUT_SECS_KEY]) !== null && _a !== void 0 ? _a : LEAF_DEFAULT_TIMEOUT_SECS;
        const seconds = Number(raw);
        const safeSeconds = Number.isFinite(seconds)
            ? seconds
            : Number(LEAF_DEFAULT_TIMEOUT_SECS);
        return safeSeconds * MS_PER_SEC;
    }
    /**
     * Trigger scenario run message sequence.
     * @param scenario - The scenario to run
     * @returns Promise that resolves with the final scenario state
     */
    async runScenario(scenario) {
        this.cancelScenarioRun();
        return new Promise((resolve, reject) => {
            let unsubscribeScenarioRun;
            let unsubscribeScenarioCompleted;
            // Unsubscribe and clear the timeout, else it later flips a completed run to "failed".
            this.scenarioRunCleanup = () => {
                unsubscribeScenarioRun === null || unsubscribeScenarioRun === void 0 ? void 0 : unsubscribeScenarioRun();
                unsubscribeScenarioCompleted === null || unsubscribeScenarioCompleted === void 0 ? void 0 : unsubscribeScenarioCompleted();
                if (this.scenarioRunTimeout) {
                    clearTimeout(this.scenarioRunTimeout);
                    this.scenarioRunTimeout = undefined;
                }
                this.scenarioRunReject = undefined;
            };
            this.scenarioRunReject = reject;
            // Honor the user-configured timeout; a negative value disables it.
            const timeoutMs = this.resolveTimeoutMs(scenario);
            if (timeoutMs >= 0) {
                this.scenarioRunTimeout = setTimeout(() => {
                    var _a;
                    (_a = this.scenarioRunCleanup) === null || _a === void 0 ? void 0 : _a.call(this);
                    this.scenarioRunStateEvent.invoke("failed");
                    reject(new Error(`Scenario ${scenario.id} timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            }
            this.scenarioRunStateEvent.invoke("starting");
            // Subscribe before notifying, else a synchronous response is missed and the run times out.
            unsubscribeScenarioRun = this.messagePublisher.subscribe("ScenarioStartResponse", (response) => {
                var _a;
                if (unsubscribeScenarioRun)
                    unsubscribeScenarioRun();
                const startResponse = response;
                // Check if the response has an error status
                if (startResponse.status === "error") {
                    (_a = this.scenarioRunCleanup) === null || _a === void 0 ? void 0 : _a.call(this);
                    this.scenarioRunStateEvent.invoke("failed");
                    reject(new Error(`Scenario "${scenario.id}" could not start: ${startResponse.reason || "the lens refused the start; see its console."}`));
                    return;
                }
                this.scenarioRunStateEvent.invoke("running");
                // Subscribe to the completion response before requesting it.
                unsubscribeScenarioCompleted = this.messagePublisher.subscribe("ScenarioCompletedResponse", (response) => {
                    var _a;
                    (_a = this.scenarioRunCleanup) === null || _a === void 0 ? void 0 : _a.call(this);
                    const completedResponse = response;
                    const finalStatus = completedResponse.status;
                    // When ScenarioCompletedResponse, set scenario completed and resolve the promise
                    this.scenarioRunStateEvent.invoke(finalStatus);
                    resolve(finalStatus);
                });
                // When ScenarioRunResponse, send ScenarioCompletedRequest
                this.messagePublisher.notify({
                    type: "ScenarioCompletedRequest",
                    scenarioId: scenario.id,
                });
            });
            // Send ScenarioRunRequest
            this.messagePublisher.notify({
                type: "ScenarioStartRequest",
                scenarioId: scenario.id,
                config: scenario.config,
            });
        });
    }
}
