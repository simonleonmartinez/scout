import Event from "../Common/Event.js";
import { splitReservedKeys } from "../Common/ReservedParams.js";
import { PluginModel } from "../Model/PluginModel.js";
import { DefaultFileSystemHandler } from "../FileSystemHandler/DefaultFileSystemHandler.js";
import { Logger } from "../Common/Logger.js";
import { isScenarioListCancellation, MessageClient, SCENARIO_RUN_CANCELLED_ERROR, } from "../MessageClient.js";
import { FileReader, InvalidPluginStateError } from "./Reader.js";
import { FileWriter } from "./Writer.js";
import { DefaultSettingsRepository } from "../Settings/DefaultSettingsRepository.js";
import { GitignoreGuard } from "../Settings/GitignoreGuard.js";
import { DEFAULT_JSON_INTENDATION, DEFAULT_SETTINGS_FILE_NAME, } from "../Settings/PluginSettings.js";
import { DeviceRunController, } from "./DeviceRunController.js";
import { validateRunTimeout, } from "./ConnectedRunController.js";
import { ConnectedRunService, describeDiscoveryFailure, ENSEMBLE_DEFAULT_CONFIG, resolveEnsembleSettings, } from "./ConnectedRunService.js";
export const JSON_INTENDATION = 4;
const LOG = new Logger("PluginViewModel");
/*
 * Retry budget for the reset-before-run scenario-list reload (100ms polls, 60s).
 * View-model-owned because it is target-agnostic: it also protects preview runs,
 * surfacing an unresponsive lens as an actionable error instead of hanging the
 * run and the MCP call forever. Device-specific budgets live in
 * DeviceRunController; background refreshes are bounded per attempt and retried
 * by the device-state watcher, which falls back to the preview when the lens
 * never answers.
 */
const RUN_SCENARIO_LIST_MAX_RETRIES = 600;
/** Sentinel retry budget: retry indefinitely. */
const UNBOUNDED_RETRIES = -1;
/**
 * PluginViewModel is the view model for the Leaf Plugin.
 * It interacts with the MessagePublisher to handle messages between the plugin and the Lens
 * and is responsible for managing the plugin's state consisting of sessions with scenarios.
 * Device connectivity (push, connect, status) is owned by its {@link DeviceRunController};
 * ConnectedRun mechanics (Ensemble discovery, Binding, the Rendezvous arbiter) by its
 * {@link ConnectedRunService} — the view model only routes Ensemble ids to it and
 * tracks busy state.
 */
export class PluginViewModel {
    /** Fires when the device connection state changes. */
    get onStatusChanged() {
        return this.deviceController.onStatusChanged;
    }
    /**
     * @param projectDirectory - The current project directory.
     * @param messagePublisher - {@link MessagePublisher} for sending and receiving messages.
     * @param resetPreview - Function to reset the scene.
     * @param routingBroker - Broker that routes messages to the preview or the device;
     *   the view model flips its target when the execute-on-device setting changes.
     * @param options - Optional dependencies; see {@link PluginViewModelOptions}.
     */
    constructor(projectDirectory, messagePublisher, resetPreview, routingBroker, options = {}) {
        var _a, _b, _c, _d, _e;
        this.projectDirectory = projectDirectory;
        this.resetPreview = resetPreview;
        this.routingBroker = routingBroker;
        this.pluginModel = new PluginModel();
        /** Lens-reported state of the current scenario run. */
        this.currentScenarioState = "idle";
        /** In-flight scenario-list request, or undefined when none is pending. */
        this.scenarioListRequest = undefined;
        /*
         * Target the displayed scenario list was loaded from. Stays on the previous
         * source while a device-mode refresh is deferred (no lens running yet).
         */
        this.scenarioListSource = "none";
        /** Bumped per committed scenario list; guards the async Ensemble merge against staleness. */
        this.scenarioListGeneration = 0;
        /** IDs from the ordinary list, before Ensembles are merged into the model. */
        this.plainScenarioIds = new Set();
        /** Failed list probes are reused briefly, then an explicit listing can retry. */
        this.ensembleRetryAfter = 0;
        this.warnedMissingSavedIds = new Set();
        this.destroyed = false;
        /** Exclusive run reservation, also suppressing automatic device fallback. */
        this.connectedRunPending = false;
        /** Count of user/tool-initiated runs currently in flight. */
        this.activeRuns = 0;
        /** Busy value last emitted through onBusyChanged; dedupes the event. */
        this.lastEmittedBusy = false;
        this.busyEvent = new Event();
        /** Fires when the plugin starts/stops being busy (push or scenario run in flight). */
        this.onBusyChanged = this.busyEvent.publicApi();
        this.sessionsImportedEvent = new Event();
        /** Fires after saved Sessions have been restored, including unavailable rows. */
        this.onSessionsImported = this.sessionsImportedEvent.publicApi();
        this.fileSystemHandler =
            (_a = options.fileSystemHandler) !== null && _a !== void 0 ? _a : new DefaultFileSystemHandler();
        this.reader = new FileReader(this.fileSystemHandler);
        this.writer = new FileWriter(this.fileSystemHandler);
        this.settingsFilePath = this.projectDirectory.appended(DEFAULT_SETTINGS_FILE_NAME);
        // The settings file holds machine-specific paths and is regenerated on
        // every launch, so ensure it is gitignored before it is first written.
        new GitignoreGuard(this.projectDirectory, [DEFAULT_SETTINGS_FILE_NAME.toString()], this.fileSystemHandler).ensureIgnored();
        this.settingsRepository =
            (_b = options.settingsRepository) !== null && _b !== void 0 ? _b : new DefaultSettingsRepository(this.settingsFilePath, {
                fileDialogOpeningPath: projectDirectory
                    .appended(DEFAULT_SETTINGS_FILE_NAME)
                    .toString(),
                jsonIndentation: DEFAULT_JSON_INTENDATION,
                executeOnDevice: false,
            });
        this.messageClient = new MessageClient(messagePublisher);
        /*
         * The device state is unknown at startup (activeLensId may be stale after a
         * lens ends), so always initialize to preview: the button starts at its
         * actionable "Execute on Device" default and connecting is an explicit
         * user/agent action.
         */
        if (this.settingsRepository.getExecuteOnDevice()) {
            this.settingsRepository.setExecuteOnDevice(false);
        }
        this.routingBroker.setTarget("preview");
        this.messageClient.onScenarioRunStateChange.add((state) => {
            this.currentScenarioState = state;
        });
        this.deviceController = new DeviceRunController({
            isExecuteOnDeviceEnabled: () => this.settingsRepository.getExecuteOnDevice(),
            fallBackToPreview: () => this.setExecuteOnDevice(false),
            loadScenarioList: (maxRetries) => this.startScenarioListRequest(maxRetries),
            waitForScenarioList: () => this.waitForReady(),
            isScenarioListLoading: () => this.scenarioListRequest !== undefined,
            isScenarioListFromDevice: () => this.scenarioListSource === "device",
            invalidateDeviceScenarioList: () => {
                if (this.scenarioListSource === "device") {
                    this.scenarioListSource = "none";
                }
            },
            isConnectedRunPending: () => this.connectedRunPending,
        }, (_c = options.deviceMessageBus) !== null && _c !== void 0 ? _c : null, (_d = options.pushToDevice) !== null && _d !== void 0 ? _d : null);
        this.connectedRun =
            options.pluginMessageBroker && options.previewsProvider
                ? new ConnectedRunService({
                    broker: options.pluginMessageBroker,
                    previewsProvider: options.previewsProvider,
                    ensurePreviews: options.ensurePreviews,
                    deviceBus: (_e = options.deviceMessageBus) !== null && _e !== void 0 ? _e : null,
                    device: this.deviceController,
                })
                : null;
        // Busy combines runs (owned here) with pushes (owned by the controller).
        this.deviceController.onPushInProgressChanged.add(() => this.emitBusyChanged());
        this.startScenarioListRequest();
    }
    /**
     * Release resources held by the view model (device watcher, pending
     * message-client timers/polling) so a destroyed instance can be garbage
     * collected.
     */
    destroy() {
        var _a;
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.scenarioListGeneration++;
        this.deviceController.destroy();
        this.messageClient.destroy();
        (_a = this.connectedRun) === null || _a === void 0 ? void 0 : _a.destroy();
    }
    /**
     * @returns The path in which to open the export file dialog.
     */
    getExportDialogOpeningPath() {
        return this.settingsRepository.getSessionsFilePath();
    }
    /**
     * @returns The path in which to open the import file dialog.
     */
    getImportDialogOpeningPath() {
        return this.settingsRepository.getSessionsFilePath().parent;
    }
    /**
     * Set the last known path of the sessions file.
     * @param path - The sessions file path
     */
    setSessionsFilePath(path) {
        this.settingsRepository.setSessionsFilePath(path);
    }
    /**
     * @returns Whether the execute-on-device setting is enabled (raw persisted value,
     * regardless of whether the PushToDevice interface is available).
     */
    getExecuteOnDevice() {
        return this.settingsRepository.getExecuteOnDevice();
    }
    /**
     * @returns Whether the PushToDevice messaging interface is available, i.e. execute
     * on device can work at all in this Lens Studio build.
     */
    isDeviceMessagingAvailable() {
        return this.deviceController.isMessagingAvailable();
    }
    /**
     * Bring up a reachable lens on the device, pushing the current lens when the
     * reported one is stale or absent. No-op unless device mode is active. Wired
     * to the header's "Execute on Device" toggle; throws when no lens can be
     * brought up.
     */
    connectToDevice() {
        return this.deviceController.connectToDevice();
    }
    /**
     * @returns Whether the plugin is busy: a push or a user/tool-initiated run is in flight.
     */
    isBusy() {
        return this.deviceController.isPushInProgress() || this.activeRuns > 0;
    }
    /**
     * @returns The destination scenario messages are currently routed to.
     */
    getExecutionTarget() {
        return this.routingBroker.getTarget();
    }
    /**
     * @returns The device connection state shown in the plugin header.
     */
    getDeviceConnectionState() {
        return this.deviceController.getConnectionState();
    }
    /**
     * Persist the execute-on-device setting, switch the message routing target, cancel
     * work aimed at the old target, and reload the scenario list from the new one.
     * @param executeOnDevice - When true, route to the device; otherwise the preview.
     */
    setExecuteOnDevice(executeOnDevice) {
        if (executeOnDevice === this.settingsRepository.getExecuteOnDevice()) {
            return;
        }
        this.settingsRepository.setExecuteOnDevice(executeOnDevice);
        this.routingBroker.setTarget(this.deviceController.isDeviceMode() ? "device" : "preview");
        /*
         * Replies aimed at the old target are dropped by the router, so an in-flight
         * run would hang until its timeout. Cancel it instead.
         */
        this.messageClient.cancelScenarioRun();
        this.currentScenarioState = "idle";
        /*
         * Reload the scenario list from the new target. In device mode this defers
         * quietly until a lens is running (watcher, connect, or push brings one up).
         */
        this.startScenarioListRequest();
        this.deviceController.onExecuteOnDeviceChanged();
    }
    /**
     * Push the current project's lens to the paired device. Wired to the
     * push_leaf_lens MCP tool. Concurrent calls join the in-flight push. In device
     * mode, additionally waits for the pushed lens to become ready and reloads the
     * scenario list from it. Throws when the push fails or the interface is
     * unavailable.
     */
    pushLens() {
        return this.deviceController.pushLens();
    }
    /**
     * Track run ownership and busy state. Exclusive admission rejects competing
     * runs and defers device preparation to the body, after validation.
     */
    async withRun(body, exclusive = false) {
        this.assertAlive();
        if (this.connectedRunPending || (exclusive && this.activeRuns > 0)) {
            throw new Error("A run is already in progress; wait for it to finish.");
        }
        if (exclusive)
            this.connectedRunPending = true;
        this.activeRuns++;
        try {
            this.emitBusyChanged();
            if (!exclusive)
                await this.deviceController.ensureReadyForRun();
            this.assertAlive();
            return await body();
        }
        finally {
            if (exclusive)
                this.connectedRunPending = false;
            this.activeRuns = Math.max(0, this.activeRuns - 1);
            try {
                this.emitBusyChanged();
            }
            finally {
                this.deviceController.refreshStatus();
            }
        }
    }
    assertAlive() {
        if (this.destroyed)
            throw new Error(SCENARIO_RUN_CANCELLED_ERROR);
    }
    emitBusyChanged() {
        const busy = this.isBusy();
        if (busy === this.lastEmittedBusy) {
            return;
        }
        this.lastEmittedBusy = busy;
        this.busyEvent.invoke(busy);
    }
    /**
     * @returns The observable plugin model.
     */
    get observablePluginModel() {
        return this.pluginModel.observable;
    }
    /**
     * Async function which resolves when the scenario list has been loaded.
     * Do not remove. Used externally in other plugins.
     */
    async waitForReady() {
        /*
         * Loop rather than await once: a superseded request rejects with a
         * cancellation, and the request that replaced it is the one to wait on.
         */
        while (this.scenarioListRequest) {
            try {
                await this.scenarioListRequest;
            }
            catch (error) {
                if (!isScenarioListCancellation(error)) {
                    throw error;
                }
            }
        }
    }
    /**
     * Export the current state to JSON file by adding/updating a "leaf" entry.
     * @param filePath - The file path to export to
     */
    saveToFile(filePath) {
        this.writer.saveToFile(filePath, this.pluginModel.toJSON());
    }
    /**
     * Import saved Sessions, retaining unavailable rows and their configuration.
     * @param filePath - The file path to import from
     * @returns Resolves after Session restoration; discovery updates availability separately.
     * @throws if the file is invalid or the panel was closed.
     */
    async loadFromFile(filePath) {
        this.assertAlive();
        const parsedJson = this.reader.loadFromFile(filePath);
        if (!parsedJson) {
            throw new InvalidPluginStateError(`Error importing file: Invalid format. Make sure the file format is correct.
        You can export through the plugin to get a valid template.`);
        }
        this.pluginModel.loadSessions(parsedJson);
        LOG.info(`Successfully imported ${parsedJson.sessions.length} session(s)`);
        this.warnMissingSavedIds();
        this.sessionsImportedEvent.invoke();
    }
    /**
     * Creates a new session with the given name.
     */
    createSession() {
        return this.pluginModel.createSession();
    }
    /**
     * Deletes a session.
     * @param sessionObservable - The observable of the session to delete.
     */
    deleteSession(sessionObservable) {
        try {
            this.pluginModel.deleteSession(sessionObservable);
        }
        catch (error) {
            LOG.error(`Error deleting session: ${error}`);
        }
    }
    /**
     * Renames a session.
     * @param sessionObservable - The observable of the session to rename.
     * @param name - The new name for the session.
     */
    setSessionName(sessionObservable, name) {
        this.pluginModel.setSessionName(sessionObservable, name);
    }
    /**
     * Creates a new scenario within a session.
     * @param sessionObservable - The observable of the session to create the scenario in.
     * @param id - The ID of the scenario to create.
     */
    addScenario(sessionObservable, id) {
        return this.pluginModel.addScenario(sessionObservable, id);
    }
    /**
     * Deletes a scenario from a session.
     * @param scenarioObservable - The observable of the scenario.
     */
    removeScenario(scenarioObservable) {
        this.pluginModel.removeScenario(scenarioObservable);
    }
    /**
     * Sets the configuration of a scenario.
     * @param scenarioObservable - The observable of the scenario.
     * @param config - The new configuration for the scenario.
     */
    setScenarioConfig(scenarioObservable, config) {
        var _a;
        const defaultConfigs = this.pluginModel.observable.defaultConfigs.value() || {};
        /* Compare scenario-declared keys only. Reserved `__leaf__*` keys are owned
           by the framework, and the plugin can know one the running Leaf.lspkg does
           not report yet, so counting them here rejected every edit to a reserved
           row that the lens had not declared. */
        const configKeys = Object.keys(splitReservedKeys(config).scenario);
        const defaultKeys = Object.keys(splitReservedKeys((_a = defaultConfigs[scenarioObservable.id.value()]) !== null && _a !== void 0 ? _a : scenarioObservable.config.value()).scenario);
        if (configKeys.length !== defaultKeys.length ||
            !configKeys.every((k) => defaultKeys.includes(k))) {
            LOG.error(`Config keys do not match default config keys for scenario ${scenarioObservable.id.value()}`);
            return;
        }
        this.pluginModel.setScenarioConfig(scenarioObservable, config);
    }
    /**
     * Sets the ID of a scenario.
     * @param scenarioObservable - The observable of the scenario.
     * @param scenarioId - The new ID for the scenario.
     */
    setScenarioId(scenarioObservable, scenarioId) {
        this.pluginModel.setScenarioId(scenarioObservable, scenarioId);
    }
    /**
     * Run all sessions sequentially, one after another.
     */
    async runAllSessions() {
        if (this.pluginModel.observable.sessions.value().length === 0) {
            LOG.warn("No sessions to run.");
            return;
        }
        try {
            await this.withRun(async () => {
                const target = this.routingBroker.getTarget();
                for (const session of this.pluginModel.observable.sessions.value()) {
                    if (this.routingBroker.getTarget() !== target) {
                        LOG.warn("Execution target changed while running sessions. Stopping the run.");
                        return;
                    }
                    await this.runSessionInternal(session);
                }
            });
        }
        catch (error) {
            this.logError("Running sessions", error);
        }
    }
    logError(action, error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === SCENARIO_RUN_CANCELLED_ERROR) {
            LOG.warn(`${action} was cancelled.`);
            return;
        }
        LOG.error(`${action} failed: ${error}`);
    }
    /**
     * Run a single session.
     * @param sessionObservable - The observable of the session to run.
     */
    async runSession(sessionObservable) {
        try {
            await this.withRun(() => this.runSessionInternal(sessionObservable));
        }
        catch (error) {
            this.logError(`Running session ${sessionObservable.name.value()}`, error);
        }
    }
    async runSessionInternal(sessionObservable) {
        if (this.isScenarioRunning()) {
            LOG.warn("There is already a scenario running. The scene will be reset.");
        }
        if (sessionObservable.scenarios.value().length === 0) {
            LOG.warn(`No scenarios to run in session ${sessionObservable.name.value()}.`);
            return;
        }
        LOG.info(`========== Running Session ${sessionObservable.name.value()} ==========`);
        const target = this.routingBroker.getTarget();
        await this.reset();
        for (const scenario of sessionObservable.scenarios.value()) {
            /*
             * Switching the execution target mid-run must stop the whole run, not
             * carry the remaining scenarios over to the other target.
             */
            if (this.routingBroker.getTarget() !== target) {
                LOG.warn(`Execution target changed while running session ${sessionObservable.name.value()}. Stopping the run.`);
                return;
            }
            await this.runScenario(scenario);
        }
    }
    /**
     * Run a single scenario in isolation.
     * @param scenarioObservable - The observable of the scenario to run.
     */
    async runIsolatedScenario(scenarioObservable) {
        try {
            await this.runScenarioById(scenarioObservable.id.value(), scenarioObservable.config.value());
        }
        catch (error) {
            this.logError(`Running scenario ${scenarioObservable.id.value()}`, error);
        }
    }
    /** Validate Ensemble-only options before a tool switches targets or prepares a device. */
    async validateScenarioRunOptions(scenarioId, overrides, options) {
        this.assertAlive();
        if (options.timeoutMs !== undefined) {
            const roles = await this.resolveEnsembleRoles(scenarioId);
            if (!roles)
                throw new Error(`Scenario "${scenarioId}" is not an Ensemble; timeoutSeconds is only supported for Ensembles.`);
        }
        const keys = Object.keys(overrides);
        if (keys.length === 0 || this.plainScenarioIds.has(scenarioId))
            return;
        const outcome = await this.discoverEnsemblesOutcome();
        this.assertAlive();
        if (outcome.kind === "answered" &&
            outcome.ensembles.some((ensemble) => ensemble.id === scenarioId)) {
            resolveEnsembleSettings(overrides, options.timeoutMs);
        }
    }
    /**
     * Run a Scenario or Ensemble on the selected target. Ordinary preview runs
     * reset the lens first; Ensembles and device runs retain lens state.
     * Overrides must match discovered configuration keys; Ensembles accept reserved runner settings.
     * @param scenarioId - The scenario id to run.
     * @param overrides - Partial config overrides keyed by parameter name.
     * @param options - Optional execution target and Ensemble whole-run timeout.
     * @returns Final status and, for Ensembles, per-participant results.
     */
    async runScenarioById(scenarioId, overrides = {}, options = {}) {
        if (options.timeoutMs !== undefined)
            validateRunTimeout(options.timeoutMs);
        if (options.onDevice && !this.isDeviceMessagingAvailable()) {
            throw new Error("Cannot execute on device: the PushToDevice interface is not available in this Lens Studio build.");
        }
        const needsDiscovery = !this.plainScenarioIds.has(scenarioId);
        const hasEnsembleTimeout = options.timeoutMs !== undefined;
        const initialTarget = this.getExecutionTarget();
        const changesTarget = options.onDevice !== undefined &&
            options.onDevice !== this.getExecuteOnDevice();
        const target = changesTarget
            ? options.onDevice
                ? "device"
                : "preview"
            : initialTarget;
        return this.withRun(async () => {
            if (changesTarget) {
                await this.validateScenarioRunOptions(scenarioId, overrides, options);
                this.assertExecutionTarget(initialTarget);
                this.setExecuteOnDevice(options.onDevice);
            }
            await this.waitForReady();
            const ensembleRoles = await this.resolveEnsembleRoles(scenarioId, target === "device" && !hasEnsembleTimeout);
            this.assertExecutionTarget(target);
            if (ensembleRoles) {
                const result = await this.executeConnectedRun(scenarioId, ensembleRoles, overrides, options.timeoutMs);
                this.logResult(scenarioId, result.ok);
                return {
                    status: result.ok ? "succeeded" : "failed",
                    connectedRun: result,
                };
            }
            if (hasEnsembleTimeout) {
                throw new Error(`Scenario "${scenarioId}" is not an Ensemble; timeoutSeconds is only supported for Ensembles. Use parameters for ordinary Scenario configuration.`);
            }
            /* Discovery classified this as ordinary; restore normal disconnect recovery. */
            if (needsDiscovery || changesTarget)
                this.connectedRunPending = false;
            if (changesTarget) {
                await this.deviceController.ensureReadyForRun();
                await this.waitForReady();
                this.assertExecutionTarget(target);
            }
            if (this.isScenarioRunning()) {
                LOG.warn("There is already a scenario running. The scene will be reset.");
            }
            await this.reset();
            const defaultConfigs = this.pluginModel.observable.defaultConfigs.value();
            const defaultConfig = defaultConfigs[scenarioId];
            if (!defaultConfig) {
                throw new Error(`Scenario "${scenarioId}" is not registered with the lens. Available: ${Object.keys(defaultConfigs).join(", ") || "(none)"}`);
            }
            const config = { ...defaultConfig };
            for (const [key, value] of Object.entries(overrides)) {
                if (!(key in defaultConfig)) {
                    throw new Error(`Config key "${key}" is not valid for scenario "${scenarioId}". Allowed: ${Object.keys(defaultConfig).join(", ") || "(none)"}`);
                }
                config[key] = value;
            }
            const scenario = { id: scenarioId, config };
            LOG.info(`Running scenario: ${scenario.id}`);
            const finalStatus = await this.messageClient.runScenario(scenario);
            this.logResult(scenario.id, finalStatus === "succeeded");
            return { status: finalStatus };
        }, needsDiscovery || hasEnsembleTimeout || changesTarget);
    }
    /**
     * Discover the Ensembles the lens declares, for display and binding.
     * @param forceRefresh - Bypass the cache.
     * @returns the declared Ensembles, or `[]` when discovery could not get an
     *   answer; use {@link discoverEnsemblesOutcome} to tell those apart.
     */
    async discoverEnsembles(forceRefresh = false) {
        const outcome = await this.discoverEnsemblesOutcome(forceRefresh);
        return outcome.kind === "answered" ? outcome.ensembles : [];
    }
    /**
     * Discovery with its outcome, so a caller can say *why* there are no
     * Ensembles (no preview open, lens did not reply, or it declares none).
     */
    async discoverEnsemblesOutcome(forceRefresh = false) {
        if (!forceRefresh && this.ensembleListRequest)
            return this.ensembleListRequest;
        const generation = this.scenarioListGeneration;
        const target = this.getExecutionTarget();
        const request = (async () => {
            var _a, _b;
            const outcome = await ((_b = (_a = this.connectedRun) === null || _a === void 0 ? void 0 : _a.discover(forceRefresh)) !== null && _b !== void 0 ? _b : Promise.resolve({ kind: "unavailable" }));
            if (!this.destroyed &&
                generation === this.scenarioListGeneration &&
                target === this.getExecutionTarget()) {
                this.lastEnsembleDiscovery = outcome;
                this.ensembleRetryAfter = Date.now() + 1000;
                if (outcome.kind === "answered")
                    this.mergeEnsembles(outcome.ensembles);
            }
            return outcome;
        })();
        this.ensembleListRequest = request;
        try {
            return await request;
        }
        finally {
            if (this.ensembleListRequest === request) {
                this.ensembleListRequest = undefined;
                this.warnMissingSavedIds();
            }
        }
    }
    assertExecutionTarget(target) {
        this.assertAlive();
        if (this.getExecutionTarget() !== target) {
            throw new Error("Execution target changed while preparing the run. Run it again on the intended target.");
        }
    }
    async executeConnectedRun(ensembleId, roleNames, config, timeoutMs) {
        if (!this.connectedRun) {
            throw new Error("ConnectedRuns are unavailable: no preview broker or previews provider.");
        }
        if (this.activeRuns !== 1) {
            throw new Error("A run is already in progress; wait for it to finish.");
        }
        const previous = this.connectedRunPending;
        this.connectedRunPending = true;
        try {
            return await this.connectedRun.run(ensembleId, roleNames, timeoutMs, config);
        }
        finally {
            this.connectedRunPending = previous;
        }
    }
    /** Known ordinary Scenarios skip discovery; unknown device IDs may need their lens brought up first. */
    async resolveEnsembleRoles(id, prepareDevice = false) {
        var _a;
        if (this.plainScenarioIds.has(id))
            return null;
        const outcome = await this.discoverEnsemblesOutcome();
        this.assertAlive();
        const roles = outcome.kind === "answered"
            ? (_a = outcome.ensembles.find((ensemble) => ensemble.id === id)) === null || _a === void 0 ? void 0 : _a.roles
            : undefined;
        if (roles)
            return roles;
        if (prepareDevice) {
            this.assertExecutionTarget("device");
            await this.deviceController.ensureReadyForRun();
            await this.waitForReady();
            this.assertExecutionTarget("device");
            if (this.plainScenarioIds.has(id))
                return null;
        }
        const available = this.listAvailableScenarios()
            .map((scenario) => scenario.id)
            .join(", ") || "(none)";
        const discovery = outcome.kind === "answered" ? "" : ` ${describeDiscoveryFailure(outcome)}`;
        throw new Error(`Scenario or Ensemble "${id}" is not registered in the available scenario list. Available: ${available}.${discovery}`);
    }
    /**
     * Ensure the active execution target can serve scenario requests: waits for the
     * initial list load and, in device mode, brings up a reachable lens (pushing if
     * needed). Used by the MCP tools.
     * @returns The Ensemble discovery outcome; ordinary rows remain available if discovery fails.
     */
    async ensureTargetReady() {
        /*
         * Bring up a reachable lens first (in device mode this pushes when needed),
         * then wait for the list: pushLens starts the post-push scenario-list load
         * in the background, so the wait must come after to observe it.
         */
        await this.deviceController.ensureReadyForRun();
        await this.waitForReady();
        const cached = this.lastEnsembleDiscovery;
        const outcome = cached &&
            (cached.kind === "answered" || Date.now() < this.ensembleRetryAfter)
            ? cached
            : await this.discoverEnsemblesOutcome();
        this.assertAlive();
        return outcome;
    }
    /**
     * @returns Scenarios known to the lens with their default configs.
     */
    listAvailableScenarios() {
        const defaultConfigs = this.pluginModel.observable.defaultConfigs.value();
        return Object.entries(defaultConfigs).map(([id, config]) => ({
            id,
            config: { ...config },
        }));
    }
    /**
     * Reset plugin run state and reload scenarios. Resets the lens only in preview mode.
     */
    async reset() {
        this.assertAlive();
        /*
         * Refreshing the preview panel is pointless (and visually disruptive) when
         * the scenario runs on the device; the device lens keeps its current state.
         */
        if (!this.deviceController.isDeviceMode()) {
            this.resetPreview();
        }
        this.messageClient.cancelScenarioRun();
        await this.startScenarioListRequest(RUN_SCENARIO_LIST_MAX_RETRIES);
        this.assertAlive();
        this.currentScenarioState = "idle";
    }
    /**
     * Start a scenario-list request against the current routing target, superseding any
     * pending one (whose retry loop would otherwise keep polling — possibly against the
     * wrong target after a toggle). Tracks the request in scenarioListRequest for
     * waitForReady() and logs failures other than deliberate cancellation.
     * @param maxRetries - Retry budget forwarded to the MessageClient; -1 = unbounded.
     */
    startScenarioListRequest(maxRetries = UNBOUNDED_RETRIES) {
        this.lastEnsembleDiscovery = undefined;
        this.messageClient.cancelScenarioListRequest();
        const request = this.doRequestScenarioList(maxRetries).finally(() => {
            // Guard against a superseded request clearing the newer one's handle.
            if (this.scenarioListRequest === request) {
                this.scenarioListRequest = undefined;
                this.warnMissingSavedIds();
            }
        });
        this.scenarioListRequest = request;
        request.catch((e) => {
            if (isScenarioListCancellation(e)) {
                return;
            }
            LOG.error(`Failed to get scenario list: ${e}`);
        });
        return request;
    }
    /**
     * Request the scenario list using MessageClient.
     * Coordinates between MessageClient and PluginModel, and emits state changes for Views.
     */
    async doRequestScenarioList(maxRetries) {
        const target = this.routingBroker.getTarget();
        /*
         * In device mode with no lens running, defer quietly (Push/Run will bring
         * one up). Prevents the indefinite retry spam when no lens runs.
         */
        if (!this.deviceController.canServeScenarioList()) {
            this.deviceController.refreshStatus();
            return;
        }
        const scenarios = await this.messageClient.requestScenarioList(maxRetries);
        if (this.routingBroker.getTarget() !== target) {
            /*
             * The target flipped while this request was in flight; the newer request
             * owns the model now.
             */
            return;
        }
        /*
         * Record the source before applying the configs: the list is authoritative
         * for this target regardless of how a view subscriber reacts, and a
         * subscriber throwing must not leave the status stuck on "Connecting...".
         */
        this.scenarioListSource = target;
        this.scenarioListGeneration++;
        this.lastEnsembleDiscovery = undefined;
        this.plainScenarioIds = new Set(scenarios.map((s) => s.id));
        LOG.info(`Loaded ${scenarios.length} scenario(s) from ${target}.`);
        try {
            this.pluginModel.setDefaultConfigs(scenarios); // will invoke state change
        }
        finally {
            this.deviceController.refreshStatus();
        }
        /* Optional discovery must not delay ordinary readiness or reset-before-run. */
        void this.discoverEnsemblesOutcome(true).catch((error) => {
            LOG.warn(`Could not merge Ensembles into the scenario list: ${error}`);
        });
    }
    mergeEnsembles(ensembles) {
        const configs = this.pluginModel.observable.defaultConfigs.value();
        const parameterTypes = this.pluginModel.observable.availableParameterTypes.value();
        const combined = [
            ...Array.from(this.plainScenarioIds, (id) => ({
                id,
                config: configs[id],
                parameterTypes: parameterTypes[id],
            })),
            ...ensembles.map((ensemble) => ({
                id: ensemble.id,
                config: { ...ENSEMBLE_DEFAULT_CONFIG },
            })),
        ];
        this.pluginModel.setDefaultConfigs(combined);
    }
    warnMissingSavedIds() {
        var _a;
        /* Absence is conclusive only after both lists have answered for the current target. */
        if (this.destroyed ||
            this.scenarioListRequest ||
            this.ensembleListRequest ||
            this.scenarioListSource !== this.getExecutionTarget() ||
            ((_a = this.lastEnsembleDiscovery) === null || _a === void 0 ? void 0 : _a.kind) !== "answered")
            return;
        const available = new Set(Object.keys(this.pluginModel.observable.defaultConfigs.value()));
        const missing = new Set(this.pluginModel.observable.sessions.value().flatMap((session) => session.scenarios
            .value()
            .map((scenario) => scenario.id.value())
            .filter((id) => !available.has(id))));
        const unreported = Array.from(missing).filter((id) => !this.warnedMissingSavedIds.has(id));
        this.warnedMissingSavedIds = missing;
        if (unreported.length > 0) {
            LOG.warn(`Saved Scenario or Ensemble IDs not listed by the current lens: ${unreported.map((id) => JSON.stringify(id)).join(", ")}. Update these Session rows or load the lens that declares them.`);
        }
    }
    async runScenario(observableScenario) {
        const id = observableScenario.id.value();
        /*
         * If this row is an Ensemble, run it as a ConnectedRun across the bound
         * Participants (previews, plus the device in device mode) rather than as a
         * single scenario against one target. A failed
         * ConnectedRun is logged, not thrown: unlike a cancellation it should not
         * abort a surrounding session loop.
         */
        const target = this.getExecutionTarget();
        let roles;
        try {
            roles = await this.resolveEnsembleRoles(id);
        }
        catch (error) {
            this.assertExecutionTarget(target);
            if (error instanceof Error &&
                error.message === SCENARIO_RUN_CANCELLED_ERROR)
                throw error;
            LOG.error(`Skipping unavailable Scenario or Ensemble "${id}": ${error}`);
            this.logResult(id, false);
            return;
        }
        this.assertExecutionTarget(target);
        if (roles) {
            try {
                const result = await this.executeConnectedRun(id, roles, observableScenario.config.value());
                this.logResult(id, result.ok);
            }
            catch (error) {
                LOG.error(`Error running ensemble ${id}: ${error}`);
            }
            this.assertAlive();
            return;
        }
        const scenario = {
            id,
            config: observableScenario.config.value(),
        };
        LOG.info(`Running scenario: ${scenario.id}`);
        try {
            const finalStatus = await this.messageClient.runScenario(scenario);
            this.logResult(scenario.id, finalStatus === "succeeded");
        }
        catch (error) {
            /*
             * A cancelled run (reset or target switch) must abort the surrounding
             * session loop, not fall through to the next scenario.
             */
            const message = error instanceof Error ? error.message : String(error);
            if (message === SCENARIO_RUN_CANCELLED_ERROR) {
                throw error;
            }
            LOG.error(`Error running scenario ${scenario.id}: ${error}`);
        }
    }
    logResult(scenarioId, success) {
        if (success) {
            LOG.info(`✅ Scenario ${scenarioId} completed successfully.`);
        }
        else {
            LOG.info(`❌ Scenario ${scenarioId} failed.`);
        }
    }
    isScenarioRunning() {
        return (this.currentScenarioState === "starting" ||
            this.currentScenarioState === "running");
    }
}
