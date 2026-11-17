import * as Ui from "LensStudio:Ui";
import * as FileSystem from "LensStudio:FileSystem";
import { PluginViewModel } from "./ViewModel/PluginViewModel.js";
import { PluginMessageBroker } from "./MessagingSystem/PluginMessageBroker.js";
import { DeviceMessageBroker } from "./MessagingSystem/DeviceMessageBroker.js";
import { StickyLensIdMessageBus } from "./MessagingSystem/StickyLensIdMessageBus.js";
import { RoutingMessageBroker } from "./MessagingSystem/RoutingMessageBroker.js";
import { MessagePublisher } from "./MessagingSystem/MessagePublisher.js";
import { PluginView } from "./View/PluginView/PluginView.js";
import { BaseView } from "./View/BaseView.js";
import { PLUGIN_BACKGROUND } from "./View/Ui/Colors.js";
import { Logger } from "./Common/Logger.js";
import { InvalidPluginStateError } from "./ViewModel/Reader.js";
const CONTENT_LAYOUT_SPACING = 0;
const CONTENT_LAYOUT_MARGINS = [0, 0, 0, 0];
const CONTENT_LAYOUT_STRETCH = 1;
const AUTO_SAVE_FILE_NAME = new Editor.Path("leaf_plugin_state.json");
const LOG = new Logger("LeafPlugin");
/**
 * LeafPlugin encapsulates the entire plugin UI and logic.
 * Can be created, destroyed, and recreated with state persistence.
 * Use the static `create()` method to instantiate.
 */
export class LeafPlugin {
    /**
     * Private constructor - use LeafPlugin.create() instead.
     */
    constructor(projectDirectory, cacheDirectory, scrollArea, previewsProvider, gui, resetPreview, deviceMessageBus, pushToDevice, ensurePreviews) {
        this.projectDirectory = projectDirectory;
        this.cacheDirectory = cacheDirectory;
        this.lifecycle = "initializing";
        this.cancelImportSubscription = null;
        /*
         * Decorate the raw message bus so activeLensId() survives the PushToDevice
         * facade's post-reconnect blind spot (see StickyLensIdMessageBus).
         */
        const stickyMessageBus = deviceMessageBus
            ? new StickyLensIdMessageBus(deviceMessageBus, () => {
                var _a;
                try {
                    return (_a = pushToDevice === null || pushToDevice === void 0 ? void 0 : pushToDevice.isSpectaclesConnected()) !== null && _a !== void 0 ? _a : false;
                }
                catch {
                    return false;
                }
            })
            : null;
        /*
         * Route between the preview panel and a lens on the paired device; the
         * ViewModel flips the target when the execute-on-device setting changes.
         *
         * The preview broker is retained (not constructed anonymously inline) so the
         * ViewModel can reach it for ConnectedRuns, which address individual
         * previews rather than routing through the single-target legacy path.
         */
        // Provider, not a snapshot: previews may not exist yet at construction (cold start), so the broker resolves them lazily on each send.
        const pluginMessageBroker = (this.pluginMessageBroker =
            new PluginMessageBroker(previewsProvider));
        const routingBroker = new RoutingMessageBroker(pluginMessageBroker, new DeviceMessageBroker(stickyMessageBus));
        /*
         * The device interfaces go to the ViewModel too (not just the broker) so it
         * can push the lens and wait for it to be ready before running. The preview
         * broker and previews provider go too, for ConnectedRun orchestration.
         */
        this.viewModel = new PluginViewModel(this.projectDirectory, new MessagePublisher(routingBroker), resetPreview, routingBroker, {
            deviceMessageBus: stickyMessageBus,
            pushToDevice,
            previewsProvider,
            pluginMessageBroker,
            ensurePreviews,
        });
        this.content = new BaseView(scrollArea, {
            direction: Ui.Direction.TopToBottom,
            contentMargins: CONTENT_LAYOUT_MARGINS,
            spacing: CONTENT_LAYOUT_SPACING,
        }, PLUGIN_BACKGROUND);
        this.pluginView = new PluginView(this.content.widget, this.viewModel, gui);
        this.content.addView(this.pluginView);
        // Keep content at the top
        this.content.addStretch(CONTENT_LAYOUT_STRETCH);
        scrollArea.setWidget(this.content.widget);
    }
    /**
     * Factory method to create a LeafPlugin instance.
     * Always attempts to load saved state from the auto-save file.
     * @param scrollArea - The scroll area container to attach content to
     * @param projectDirectory - The Lens Studio project directory
     * @param cacheDirectory - The Lens Studio cache directory for storing plugin state
     * @param previewsProvider - Provider of the preview panels for message communication
     * @param gui - The GUI interface for creating UI elements
     * @param resetPreview - Function to reset the scene/preview
     * @param deviceMessageBus - PushToDevice messaging interface for execute-on-device
     *   routing, or null when the PushToDevice plugin is not loaded
     * @param pushToDevice - PushToDevice push interface for auto-push-on-connect and
     *   the push_leaf_lens tool, or null when the PushToDevice plugin is not loaded
     */
    static create(scrollArea, projectDirectory, cacheDirectory, previewsProvider, gui, resetPreview, deviceMessageBus, pushToDevice, ensurePreviews) {
        const plugin = new LeafPlugin(projectDirectory, cacheDirectory, scrollArea, previewsProvider, gui, resetPreview, deviceMessageBus, pushToDevice, ensurePreviews);
        plugin.finishLoading();
        return plugin;
    }
    /**
     * Load the auto-saved state and mark the instance ready (enabling saves).
     * Saved rows are restored before discovery; their availability updates with the list.
     */
    finishLoading() {
        var _a;
        (_a = this.cancelImportSubscription) !== null && _a !== void 0 ? _a : (this.cancelImportSubscription = this.viewModel.onSessionsImported(() => {
            if (this.lifecycle !== "destroyed")
                this.lifecycle = "ready";
        }));
        this.loadFromFile(this.cacheDirectory.appended(AUTO_SAVE_FILE_NAME))
            .then(() => {
            if (this.lifecycle === "destroyed")
                return;
            this.lifecycle = "ready";
        })
            .catch((error) => {
            LOG.error(`Failed to load saved plugin state: ${error}`);
        });
    }
    /**
     * Load plugin state from a file.
     * @param filePath - The file path to load from
     */
    async loadFromFile(filePath) {
        if (FileSystem.exists(filePath)) {
            try {
                await this.viewModel.loadFromFile(filePath);
            }
            catch (error) {
                if (!(error instanceof InvalidPluginStateError) || this.lifecycle === "destroyed")
                    throw error;
                const backup = new Editor.Path(`${filePath}.invalid-${Date.now()}-${Math.random().toString(36).slice(2)}`);
                FileSystem.rename(filePath, backup);
                LOG.warn(`Invalid autosave preserved at ${backup}. New Sessions will be saved normally.`);
            }
        }
    }
    /**
     * Clean up resources when the plugin is destroyed.
     * Saves state before cleanup if loading has completed.
     * Note: Does not destroy the scrollArea as it's owned by the parent.
     */
    destroy() {
        var _a;
        const wasReady = this.lifecycle === "ready";
        this.lifecycle = "destroyed";
        (_a = this.cancelImportSubscription) === null || _a === void 0 ? void 0 : _a.call(this);
        this.cancelImportSubscription = null;
        /*
         * Saving must not abort cleanup: if the write throws, the ViewModel
         * teardown and widget deletion below still need to run.
         */
        try {
            /* Saving before restoration completes would overwrite saved sessions. */
            if (wasReady) {
                this.viewModel.saveToFile(this.cacheDirectory.appended(AUTO_SAVE_FILE_NAME));
            }
            else {
                LOG.warn("Skipping plugin state save: instance was destroyed before its state finished loading.");
            }
        }
        catch (error) {
            LOG.error(`Failed to save plugin state: ${error}`);
        }
        try {
            this.viewModel.destroy();
        }
        finally {
            this.pluginMessageBroker.destroy();
            this.pluginView.delete();
            this.content.delete();
        }
    }
}
