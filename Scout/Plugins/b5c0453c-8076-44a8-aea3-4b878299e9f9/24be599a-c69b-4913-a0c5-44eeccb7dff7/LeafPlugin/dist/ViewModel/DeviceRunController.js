import Event from "../Common/Event.js";
import { Logger } from "../Common/Logger.js";
import { poller } from "../Common/Polling.js";
import { isScenarioListCancellation } from "../MessageClient.js";
import { decodeReplyData, LEAF_MIME_TYPE, LEAF_TOPIC, } from "../MessagingSystem/DeviceWire.js";
import { MessageRequest, PushType } from "LensStudio:PushToDevice";
const LOG = new Logger("DeviceRunController");
/*
 * Auto-push readiness tuning. The lens-start poll runs while the push transfer
 * is still in flight, so its budget covers transfer + boot.
 */
const ACTIVE_LENS_POLL_INTERVAL_MS = 250;
const ACTIVE_LENS_POLL_MAX_MS = 120000;
/*
 * Probe budget when connecting to a lens the device reports as running: both
 * activeLensId and waitForLensReady can report a stale lens (its old connection
 * is never dropped), so reachability is probed with a real scenario-list
 * request; if it goes unanswered within this many 100ms retries, the lens is
 * pushed instead. Kept short: activeLensId can be stale (a lens deleted on the
 * device leaves no STOPPED event), so a long budget would hang "Connecting..."
 * on a lens that is already gone.
 */
const CONNECT_PROBE_LIST_MAX_RETRIES = 20;
/*
 * Handover tuning for pushing over a running lens: activeLensId keeps reporting
 * the old lens until the new one replaces it, and the old lens keeps answering
 * requests while the transfer is in flight. The only reliable "swap happened"
 * signal is the old lens first going silent, probed with a direct ping.
 */
const HANDOVER_PING_INTERVAL_MS = 500;
const HANDOVER_PING_TIMEOUT_MS = 1000;
const HANDOVER_MAX_MS = 120000;
/*
 * PushToDevice exposes no event for lenses pushed outside the plugin (e.g. Lens
 * Studio's own send-to-device flow), so poll the device state to notice them.
 */
const DEVICE_STATE_POLL_INTERVAL_MS = 2000;
/*
 * The "Not Connected"/"Connecting..." button states are not clickable, so the
 * plugin must leave them on its own: after this many consecutive watcher ticks
 * with nothing connected and nothing connecting, fall back to preview
 * execution. The grace also lets an MCP set-target call be followed by a run.
 */
const DISCONNECT_FALLBACK_TICKS = 5;
/*
 * Push-task wait cap. The push task can hang without settling, so stop gating
 * the controller on it after this budget rather than locking "Pushing...".
 */
const PUSH_TASK_MAX_MS = 120000;
/*
 * Post-push background list-load budget (100ms polls, 60s): every failed send
 * kicks the connection acquisition, so this keeps pressure on the channel while
 * the pushed lens boots. If it runs out, the watcher returns execution to the
 * preview — reconnecting is always an explicit toggle/run/push action.
 */
const POST_PUSH_LIST_MAX_RETRIES = 600;
/**
 * State machine for executing scenarios on a paired device: brings up
 * a reachable lens (probing the one the device reports, pushing when needed),
 * watches for lenses started or stopped outside the plugin, and derives the
 * {@link DeviceConnectionState} shown in the plugin header.
 *
 * Owned by the PluginViewModel, which implements {@link DeviceRunHost}; scenario
 * messages themselves travel through the RoutingMessageBroker, not through this
 * class.
 */
export class DeviceRunController {
    /**
     * @param host - The owning view model's scenario-list and run state.
     * @param deviceMessageBus - PushToDevice messaging interface, or null when the
     *   PushToDevice plugin is not loaded (device mode reports "unavailable").
     * @param pushToDevice - PushToDevice push interface, or null when unavailable
     *   (pushLens() rejects).
     */
    constructor(host, deviceMessageBus = null, pushToDevice = null) {
        var _a, _b;
        this.host = host;
        this.deviceMessageBus = deviceMessageBus;
        this.pushToDevice = pushToDevice;
        /** In-flight push; concurrent pushLens() calls join it. */
        this.pushPromise = null;
        /** In-flight readiness flow (probe or push); concurrent callers join it. */
        this.connectablePromise = null;
        /** Whether connectToDevice() is in flight; drives the "connecting" state. */
        this.connectInProgress = false;
        /** Whether destroy() has run; stops in-flight polls from touching a dead host. */
        this.isDestroyed = false;
        /** Last computed state; compared against to dedupe onStatusChanged. */
        this.state = "off";
        /** Stops the device-state watcher; null when it is not running. */
        this.stopDeviceStateWatcher = null;
        /** Lens id seen by the previous watcher tick. */
        this.lastSeenDeviceLensId = "";
        /** Consecutive watcher ticks without a connection; triggers the preview fallback. */
        this.disconnectedTicks = 0;
        this.pushInProgressEvent = new Event();
        /** Fires when a lens push starts (true) or settles (false). */
        this.onPushInProgressChanged = this.pushInProgressEvent.publicApi();
        this.statusEvent = new Event();
        /** Fires when the device connection state changes. */
        this.onStatusChanged = this.statusEvent.publicApi();
        this.state = this.computeState();
        /*
         * A lens already running at construction is handled by the host's initial
         * scenario-list request, not treated as newly detected.
         */
        this.lastSeenDeviceLensId = (_b = (_a = this.deviceMessageBus) === null || _a === void 0 ? void 0 : _a.getActiveLensId()) !== null && _b !== void 0 ? _b : "";
        if (this.deviceMessageBus) {
            this.stopDeviceStateWatcher = poller.repeatEvery(() => this.checkDeviceState(), DEVICE_STATE_POLL_INTERVAL_MS);
        }
    }
    /** Stop the watcher and in-flight polls so a destroyed instance can be collected. */
    destroy() {
        var _a;
        this.isDestroyed = true;
        (_a = this.stopDeviceStateWatcher) === null || _a === void 0 ? void 0 : _a.call(this);
        this.stopDeviceStateWatcher = null;
    }
    /**
     * @returns Whether the PushToDevice messaging interface is available, i.e.
     * execute on device can work at all in this Lens Studio build.
     */
    isMessagingAvailable() {
        return this.deviceMessageBus !== null;
    }
    /**
     * @returns Whether the execute-on-device setting is enabled AND the device
     * messaging interface exists, i.e. messages actually go to the device.
     */
    isDeviceMode() {
        return (this.host.isExecuteOnDeviceEnabled() && this.deviceMessageBus !== null);
    }
    /** @returns Whether a lens push is currently in flight. */
    isPushInProgress() {
        return this.pushPromise !== null;
    }
    /** @returns The connection state shown in the plugin header. */
    getConnectionState() {
        return this.state;
    }
    /**
     * Recompute the state and notify subscribers if it changed. Call after any
     * host-side change that feeds {@link computeState} (run finished, setting
     * toggled, scenario list loaded).
     */
    refreshStatus() {
        const state = this.computeState();
        if (state === this.state) {
            return;
        }
        LOG.info(`Device state: ${this.state} -> ${state}`);
        this.state = state;
        this.statusEvent.invoke(state);
    }
    /** Re-anchor the watcher after the execute-on-device setting changed. */
    onExecuteOnDeviceChanged() {
        var _a, _b;
        this.disconnectedTicks = 0;
        // A lens change that happened while disabled is not a lost connection.
        this.lastSeenDeviceLensId = (_b = (_a = this.deviceMessageBus) === null || _a === void 0 ? void 0 : _a.getActiveLensId()) !== null && _b !== void 0 ? _b : "";
        this.refreshStatus();
    }
    /**
     * Whether a scenario-list refresh can be served right now. In device mode a
     * lens must be running (the request's retry loop handles the connection coming
     * up); otherwise the refresh should be deferred quietly — Push/Run brings a
     * lens up. Always true in preview mode.
     */
    canServeScenarioList() {
        const service = this.deviceMessageBus;
        if (!this.isDeviceMode() || !service) {
            return true;
        }
        return service.getActiveLensId() !== "";
    }
    /**
     * Bring up a reachable lens on the device: if the device reports a running lens,
     * verify it actually answers within a short timeout; if it does not (stale id) or
     * none is running, push the current lens and wait until it is ready. No-op unless
     * device mode is active. Wired to the header's "Execute on Device" toggle; throws
     * when no lens can be brought up.
     */
    async connectToDevice() {
        if (!this.isDeviceMode()) {
            return;
        }
        this.connectInProgress = true;
        this.refreshStatus();
        try {
            await this.ensureDeviceConnectable();
        }
        catch (error) {
            LOG.error(`Failed to connect to the device: ${error}`);
            throw error;
        }
        finally {
            this.connectInProgress = false;
            this.refreshStatus();
        }
    }
    /**
     * Active readiness for a user-initiated run: verify the reported lens is
     * reachable, pushing the current lens when it is stale or absent (joining any
     * in-flight push). No-op in preview mode or when the interfaces are unavailable.
     * Throws if a lens can't be brought up.
     */
    async ensureReadyForRun() {
        if (!this.isDeviceMode()) {
            return;
        }
        await this.ensureDeviceConnectable();
        /* A push starts discovery in the background; a run needs its reply. */
        await this.host.waitForScenarioList();
    }
    /**
     * Push the current project's lens to the paired device. Wired to the
     * push_leaf_lens MCP tool and used by the connect flow. Concurrent calls join
     * the in-flight push. In device mode, additionally waits for the pushed lens to
     * become ready and reloads the scenario list from it. Throws when the push fails
     * or the interface is unavailable.
     */
    pushLens() {
        const inFlight = this.pushPromise;
        if (inFlight) {
            return inFlight;
        }
        const push = this.doPushLens().finally(() => {
            if (this.pushPromise === push) {
                this.pushPromise = null;
                this.pushInProgressEvent.invoke(false);
                this.refreshStatus();
            }
        });
        this.pushPromise = push;
        this.pushInProgressEvent.invoke(true);
        this.refreshStatus();
        /*
         * Log here so fire-and-forget callers still surface failures; the rejection
         * additionally propagates to awaiting callers (MCP tools, runs).
         */
        push.catch((error) => {
            LOG.error(`Failed to push lens to device: ${error}`);
        });
        return push;
    }
    /**
     * Single-flight wrapper around the readiness flow: a scenario run started while
     * the toggle is still connecting must join that flow, not race it. A parallel
     * probe would supersede the in-flight scenario-list request and fail both.
     */
    ensureDeviceConnectable() {
        const inFlight = this.connectablePromise;
        if (inFlight) {
            return inFlight;
        }
        const connectable = this.doEnsureDeviceConnectable().finally(() => {
            if (this.connectablePromise === connectable) {
                this.connectablePromise = null;
            }
        });
        this.connectablePromise = connectable;
        return connectable;
    }
    async doEnsureDeviceConnectable() {
        const service = this.deviceMessageBus;
        if (!service) {
            return;
        }
        const lensId = service.getActiveLensId();
        if (lensId) {
            try {
                /*
                 * Probe with a real request even when a device list is already loaded:
                 * only an answered request proves the lens is still alive (activeLensId
                 * can report a dead lens), and the answer refreshes the scenario list
                 * (state becomes "connected").
                 */
                await this.host.loadScenarioList(CONNECT_PROBE_LIST_MAX_RETRIES);
                return;
            }
            catch (error) {
                if (isScenarioListCancellation(error)) {
                    // Superseded by a newer flow (toggle or reset); let it take over.
                    throw error;
                }
                LOG.warn(`The lens on the device is not answering (${error}). Pushing the lens instead.`);
            }
        }
        // pushLens() waits for the lens to start and answer in device mode.
        await this.pushLens();
    }
    async doPushLens() {
        var _a;
        if (this.isDestroyed) {
            return;
        }
        const pushToDevice = this.pushToDevice;
        if (!pushToDevice) {
            throw new Error("PushToDevice interface unavailable: cannot push lens to device.");
        }
        const service = this.deviceMessageBus;
        const previousLensId = (_a = service === null || service === void 0 ? void 0 : service.getActiveLensId()) !== null && _a !== void 0 ? _a : "";
        if (this.isDeviceMode())
            this.host.invalidateDeviceScenarioList();
        /*
         * Kick the push but do not gate on its task: it has been observed to not
         * settle even though the lens transfers and starts fine (and it resolves
         * with `false` instead of rejecting on failure). The lens-start poll below
         * is the reliable completion signal; the task's own outcome is only logged
         * when it eventually settles.
         */
        const pushTask = pushToDevice.push([PushType.Spectacles]);
        pushTask.then(() => LOG.info("Push task settled."), (error) => LOG.warn(`Push task failed: ${error}`));
        if (!this.isDeviceMode() || !service) {
            /*
             * Preview mode: nothing to observe beyond the transfer. Cap the wait so
             * a push task that never settles cannot pin "Pushing..." indefinitely.
             */
            await Promise.race([pushTask, poller.sleep(PUSH_TASK_MAX_MS)]);
            return;
        }
        /*
         * Device mode: do NOT await the push task here. The lens-start poll below
         * is the reliable completion signal, and continuations resumed by the
         * cross-plugin push promise have been observed to lose their microtasks in
         * this runtime (see pollUntil's doc comment).
         */
        // Stage logs: if the connection stalls, the last line tells which step.
        if (previousLensId) {
            LOG.info("Pushing. Waiting for the running lens to hand over...");
            await this.waitForLensHandover(service);
        }
        LOG.info("Waiting for the pushed lens to start on the device...");
        const lensId = await poller.pollUntil(() => service.getActiveLensId(), (id) => id !== "", ACTIVE_LENS_POLL_INTERVAL_MS, ACTIVE_LENS_POLL_MAX_MS);
        if (this.isDestroyed) {
            return;
        }
        if (!lensId) {
            throw new Error("The lens did not start on the device after the push.");
        }
        LOG.info(`Lens '${lensId}' started; loading its scenario list in the background.`);
        this.lastSeenDeviceLensId = lensId;
        /*
         * Hand the scenario-list load off to the background rather than awaiting it
         * under the push: blocking here pins the toggle on "Pushing..." (a disabled
         * button) for the whole retry budget. The request retries every 100ms (each
         * failed send kicks the connection acquisition) and flips the state to
         * "connected" the moment the lens answers; if the budget runs out, the
         * device-state watcher falls back to preview execution.
         */
        void this.host.loadScenarioList(POST_PUSH_LIST_MAX_RETRIES);
    }
    /**
     * Wait until the lens that was running before the push stops answering — the
     * signal that the device is swapping to the pushed lens. activeLensId cannot
     * distinguish the two instances (re-pushing the same project keeps the same
     * id), so without this wait the old lens would answer the post-push
     * scenario-list request and the push would complete with the stale list.
     * Proceeds with a warning when the old lens never goes silent in the budget.
     */
    async waitForLensHandover(service) {
        /*
         * Hand-rolled rather than pollUntil: the ping is async and pollUntil's
         * probe must stay synchronous (see its doc comment).
         */
        let elapsedMs = 0;
        while (elapsedMs < HANDOVER_MAX_MS) {
            if (this.isDestroyed) {
                return;
            }
            if (!(await this.pingLens(service))) {
                return;
            }
            await poller.sleep(HANDOVER_PING_INTERVAL_MS);
            elapsedMs += HANDOVER_PING_INTERVAL_MS;
        }
        LOG.warn("The previous lens is still answering after the push; the scenario list may be stale until the pushed lens starts.");
    }
    /**
     * Probe whether a LEAF lens currently answers on the device, with a direct
     * request that bypasses the broker so the reply never touches the
     * scenario-list model.
     */
    async pingLens(service) {
        const request = new MessageRequest();
        request.lensId = service.getActiveLensId();
        request.topic = LEAF_TOPIC;
        request.data = JSON.stringify({ type: "ScenarioListRequest" });
        request.mimeType = LEAF_MIME_TYPE;
        request.timeoutMs = HANDOVER_PING_TIMEOUT_MS;
        try {
            const response = await service.sendRequest(request);
            // An unparseable reply is not a LEAF lens answering.
            JSON.parse(decodeReplyData(response.data, response.mimeType));
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Watcher tick: keeps the header status fresh and leaves device mode on its
     * own when the connection is gone — the lens died, was replaced, or never
     * answered. There is no background reconnect (PushToDevice gives no reliable
     * signal to reconnect on): bringing a lens back up is always an explicit
     * action (toggle, run, or push), which probes reachability and pushes as
     * needed.
     */
    checkDeviceState() {
        const service = this.deviceMessageBus;
        if (!service) {
            return;
        }
        // Cheap and deduped: picks up lens start/stop changes.
        this.refreshStatus();
        const lensId = service.getActiveLensId();
        if (!this.host.isExecuteOnDeviceEnabled()) {
            // Track the lens quietly so enabling later starts from the current one.
            this.lastSeenDeviceLensId = lensId;
            this.disconnectedTicks = 0;
            return;
        }
        if (this.isPushInProgress() || this.connectInProgress) {
            // A push/connect legitimately changes the lens; it re-anchors
            // lastSeenDeviceLensId itself when it completes.
            this.disconnectedTicks = 0;
            return;
        }
        /*
         * The lens this session was connected to is gone or was replaced: stop
         * showing a "connected" state that no longer exists. The status drops to
         * "Not Connected" right away (so the loss is visible), and the grace
         * fallback below returns execution to the preview shortly after.
         */
        if (this.lastSeenDeviceLensId && lensId !== this.lastSeenDeviceLensId) {
            this.host.invalidateDeviceScenarioList();
            LOG.warn("Lost the connection to the device lens.");
            this.refreshStatus();
        }
        this.lastSeenDeviceLensId = lensId;
        if (lensId && this.host.isScenarioListFromDevice()) {
            // Connected.
            this.disconnectedTicks = 0;
            return;
        }
        if (this.host.isScenarioListLoading()) {
            // An explicit flow (post-push load, run reset) is still working on it.
            this.disconnectedTicks = 0;
            return;
        }
        if (this.host.isConnectedRunPending()) {
            /* ConnectedRun discovery and preview preparation may precede device readiness. */
            this.disconnectedTicks = 0;
            return;
        }
        /*
         * Device mode is on but nothing is connected and nothing is connecting:
         * the non-clickable "Not Connected"/"Connecting..." states must resolve on
         * their own, so fall back to preview execution after a short grace period.
         */
        this.disconnectedTicks++;
        if (this.disconnectedTicks >= DISCONNECT_FALLBACK_TICKS) {
            this.disconnectedTicks = 0;
            LOG.warn(lensId
                ? "The lens on device is not answering. Switching back to preview execution."
                : "No lens running on device. Switching back to preview execution.");
            this.host.fallBackToPreview();
        }
    }
    /** Whether a device is currently connected to Lens Studio. */
    isDeviceConnected() {
        var _a, _b;
        try {
            return (_b = (_a = this.pushToDevice) === null || _a === void 0 ? void 0 : _a.isSpectaclesConnected()) !== null && _b !== void 0 ? _b : false;
        }
        catch {
            // The facade can throw transiently across a device reconnect.
            return false;
        }
    }
    /** Derive the connection state; the order of the checks is the state priority. */
    computeState() {
        const service = this.deviceMessageBus;
        if (!service) {
            return "unavailable";
        }
        if (!this.isDeviceConnected()) {
            // Without a device, "Execute on Device" would be a dead button.
            return "disconnected";
        }
        if (!this.host.isExecuteOnDeviceEnabled()) {
            return "off";
        }
        if (this.isPushInProgress()) {
            return "pushing";
        }
        if (this.connectInProgress) {
            return "connecting";
        }
        /*
         * Device mode with no lens or no device-loaded list yet: transient — a
         * connect/push/run brings a lens up, or the watcher's grace fallback
         * returns to the preview.
         */
        if (!service.getActiveLensId() || !this.host.isScenarioListFromDevice()) {
            return "connecting";
        }
        return "connected";
    }
}
