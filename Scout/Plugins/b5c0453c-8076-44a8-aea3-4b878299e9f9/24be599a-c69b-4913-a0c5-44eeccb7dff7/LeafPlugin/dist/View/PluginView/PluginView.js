import * as Ui from "LensStudio:Ui";
import { BaseView } from "../BaseView.js";
import { SessionView } from "../SessionView/SessionView.js";
import { PluginHeaderView } from "./PluginHeaderView.js";
import { PLUGIN_BACKGROUND } from "../Ui/Colors.js";
import { Logger } from "../../Common/Logger.js";
import { isScenarioListCancellation } from "../../MessageClient.js";
const LOG = new Logger("PluginView");
const PLUGIN_VIEW_SPACING = 0;
const PLUGIN_VIEW_MARGINS = [0, 0, 0, 0];
const PLUGIN_HEADER_SEPARATOR_SPACING = 5;
/**
 * Main widget containing all session widgets.
 * Only class that is exposed to the model.
 */
export class PluginView extends BaseView {
    /**
     * @param parentWidget - Parent widget for the session manager
     * @param viewModel - View model providing the data and handling the logic
     * @param gui - GUI interface
     */
    constructor(parentWidget, viewModel, gui) {
        super(parentWidget, {
            direction: Ui.Direction.TopToBottom,
            contentMargins: PLUGIN_VIEW_MARGINS,
            spacing: PLUGIN_VIEW_SPACING,
        }, PLUGIN_BACKGROUND);
        this.viewModel = viewModel;
        this.gui = gui;
        this.sessionViews = [];
        this.unsubscribeViewModelEvents = [];
        this.observablePluginModel = this.viewModel.observablePluginModel;
        this.availableScenarios = Object.keys(this.observablePluginModel.defaultConfigs.value() || {});
        this.header = new PluginHeaderView(this.widget, () => this.handleExportJson(), () => this.handleImportJson(), () => this.handleCreateSession(), () => this.handleRunAllSessions(), () => this.handleToggleExecuteOnDevice());
        this.addView(this.header);
        // Reflect the view-model's device/run state in the header controls.
        this.header.setStatus(this.viewModel.getDeviceConnectionState());
        this.header.setBusy(this.viewModel.isBusy());
        this.unsubscribeViewModelEvents = [
            this.viewModel.onBusyChanged.add((busy) => this.header.setBusy(busy)),
            this.viewModel.onStatusChanged.add((state) => this.header.setStatus(state)),
        ];
        this.addHorizontalSpacer(PLUGIN_HEADER_SEPARATOR_SPACING);
        this.unsubscribeDefaultConfigs =
            this.observablePluginModel.defaultConfigs.subscribe((defaultConfigs) => {
                this.availableScenarios = Object.keys(defaultConfigs || {});
            });
        this.unsubscribeSessions = this.observablePluginModel.sessions.subscribe(() => {
            this.syncSessionViews();
        });
        this.syncSessionViews();
    }
    /**
     * Handle export JSON button click - shows save dialog and exports to selected file.
     */
    handleExportJson() {
        const filePath = this.gui.dialogs.selectFileToSave({
            caption: "Export LEAF Sessions to JSON - Choose filename and location",
            filter: "*.json",
            options: Ui.Dialogs.Options.Usual,
        }, this.viewModel.getExportDialogOpeningPath());
        // An empty path means the user cancelled the dialog; don't write anything.
        if (filePath.isEmpty) {
            return;
        }
        this.viewModel.saveToFile(filePath);
        this.viewModel.setSessionsFilePath(filePath);
    }
    /**
     * Handle import JSON button click - shows open dialog and imports from selected file.
     */
    handleImportJson() {
        // Show open dialog
        const filePath = this.gui.dialogs.selectFileToOpen({
            caption: "Import LEAF Sessions from JSON",
            filter: "*.json",
            options: Ui.Dialogs.Options.Usual,
        }, this.viewModel.getImportDialogOpeningPath());
        // An empty path means the user cancelled the dialog; don't read anything.
        if (filePath.isEmpty) {
            return;
        }
        void this.viewModel.loadFromFile(filePath)
            .then(() => this.viewModel.setSessionsFilePath(filePath))
            .catch((error) => LOG.error(`Failed to import sessions: ${error}`));
    }
    /**
     * Synchronizes session views with the current observable sessions.
     *
     * This is needed when loading a saved plugin state, as loading replaces
     * all sessions at once rather than using individual add/remove operations.
     */
    syncSessionViews() {
        const currentSessions = this.observablePluginModel.sessions.value();
        const sessionViews = new Map(this.sessionViews.map((view) => [view.sessionObservable, view]));
        const updatedSessionViews = [];
        // For each session observable, check if its view already exists,
        // if so, reuse it, otherwise create a new one
        for (const sessionObservable of currentSessions) {
            const existingView = sessionViews.get(sessionObservable);
            if (existingView) {
                updatedSessionViews.push(existingView);
                sessionViews.delete(sessionObservable);
            }
            else {
                const newView = this.createSessionView(sessionObservable);
                updatedSessionViews.push(newView);
            }
        }
        // Delete views that no longer exist in the new state
        sessionViews.forEach((view) => {
            view.delete();
        });
        this.sessionViews = updatedSessionViews;
    }
    /**
     * Creates a new session view for the given observable.
     * @param sessionObservable - The session observable to create a view for
     */
    createSessionView(sessionObservable) {
        const sessionView = new SessionView(this.widget, sessionObservable, this.observablePluginModel.defaultConfigs, this.observablePluginModel.availableParameterTypes, () => this.handleDeleteSession(sessionObservable), () => this.handleAddScenario(sessionObservable), (name) => this.handleSetSessionName(sessionObservable, name), () => this.handleRunSession(sessionObservable), (scenarioObservable) => this.handleRemoveScenario(scenarioObservable), (scenarioObservable, config) => this.handleSetScenarioConfig(scenarioObservable, config), (scenarioObservable, scenarioId) => this.handleSetScenarioId(scenarioObservable, scenarioId), (scenarioObservable) => this.handleRunScenario(scenarioObservable));
        this.addView(sessionView);
        this.sessionViews.push(sessionView);
        return sessionView;
    }
    handleCreateSession() {
        this.viewModel.createSession();
    }
    handleDeleteSession(sessionObservable) {
        this.viewModel.deleteSession(sessionObservable);
    }
    handleSetSessionName(sessionObservable, name) {
        this.viewModel.setSessionName(sessionObservable, name);
    }
    handleAddScenario(sessionObservable) {
        // Guard: with no scenarios available, addScenario would use an undefined id and the dropdown would throw.
        if (this.availableScenarios.length === 0) {
            LOG.warn("Cannot add a scenario: no scenarios are available yet. Ensure a LeafIndex is in your scene, then refresh the preview to reload the scenario list.");
            return undefined;
        }
        const scenarioObservable = this.viewModel.addScenario(sessionObservable, this.availableScenarios[0]);
        return scenarioObservable;
    }
    handleRemoveScenario(scenarioObservable) {
        this.viewModel.removeScenario(scenarioObservable);
    }
    handleSetScenarioConfig(scenarioObservable, config) {
        this.viewModel.setScenarioConfig(scenarioObservable, config);
    }
    handleSetScenarioId(scenarioObservable, scenarioId) {
        this.viewModel.setScenarioId(scenarioObservable, scenarioId);
    }
    handleRunScenario(scenarioObservable) {
        this.viewModel.runIsolatedScenario(scenarioObservable);
    }
    handleRunSession(sessionObservable) {
        this.viewModel.runSession(sessionObservable);
    }
    handleRunAllSessions() {
        this.viewModel.runAllSessions();
    }
    handleToggleExecuteOnDevice() {
        if (this.viewModel.getExecuteOnDevice()) {
            this.viewModel.setExecuteOnDevice(false);
            return;
        }
        this.viewModel.setExecuteOnDevice(true);
        /*
         * Verify the device lens is reachable, pushing the lens when it is stale or
         * absent. On real failures (already logged by the view model), fall back to
         * preview so the button returns to a clickable "Execute on Device" instead
         * of parking in the non-clickable "Not Connected" state. A cancellation is
         * not a failure: it means a newer flow superseded this connect.
         */
        this.viewModel.connectToDevice().catch((error) => {
            if (!isScenarioListCancellation(error)) {
                this.viewModel.setExecuteOnDevice(false);
            }
        });
    }
    /** @override */
    delete() {
        this.unsubscribeViewModelEvents.forEach((unsubscribe) => unsubscribe());
        this.unsubscribeViewModelEvents = [];
        this.unsubscribeDefaultConfigs();
        this.unsubscribeSessions();
        this.sessionViews.forEach((view) => view.delete());
        this.sessionViews = [];
        super.delete();
    }
}
