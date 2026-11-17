import * as Ui from "LensStudio:Ui";
import { BaseView } from "../BaseView";
import { ImportExportView } from "./ImportExportView";
import { PLUGIN_HEADER_BACKGROUND_COLOR } from "../Ui/Colors";
import { PLUS_ICON_SVG, RUN_ALL_ICON } from "../Ui/icons";
const HEADER_SPACING = 0;
const HEADER_MARGINS = [8, 8, 8, 8];
const ButtonsVerticalSpacing = 8;
const LAYOUT_STRETCH = 1;
const EXECUTE_ON_DEVICE_TEXT = "Execute on Device";
/** Button text per device connection state; the tooltip carries the detail. */
const STATE_TEXT = {
    off: EXECUTE_ON_DEVICE_TEXT,
    unavailable: EXECUTE_ON_DEVICE_TEXT,
    pushing: "Pushing...",
    connecting: "Connecting...",
    disconnected: "Not Connected",
    connected: "Connected",
};
/** Tooltip per connection state, explaining the button text on hover. */
const STATE_DETAILS = {
    unavailable: "Execute on device is unavailable: the PushToDevice plugin is not loaded in this Lens Studio build.",
    off: "Click to execute scenarios on the paired device instead of the " +
        "preview. Pushes the lens first if none is running.",
    pushing: "Pushing the lens to the device and waiting for it to respond...",
    connecting: "Connecting to the lens on the device and loading its scenario list...",
    disconnected: "No device is connected. Scenarios execute in the preview; " +
        "connect a device to execute on it.",
    connected: "Executing scenarios on the device lens. Click to run in the preview instead.",
};
/**
 * Header for the entire plugin, containing the title and action buttons.
 */
export class PluginHeaderView extends BaseView {
    constructor(parentWidget, exportJson, importJson, createSession, runAllSessions, toggleExecuteOnDevice) {
        super(parentWidget, {
            direction: Ui.Direction.LeftToRight,
            contentMargins: HEADER_MARGINS,
            spacing: HEADER_SPACING,
        }, PLUGIN_HEADER_BACKGROUND_COLOR);
        const button = this.addPushButton({
            icon: PLUS_ICON_SVG,
            text: "New Session",
            tooltip: "Create a new session",
            onClick: () => {
                createSession();
            },
            primary: true,
        });
        button.fontRole = Ui.FontRole.DefaultBold;
        this.addVerticalSpacer(ButtonsVerticalSpacing);
        this.runAllButton = this.addPushButton({
            icon: RUN_ALL_ICON,
            tooltip: "Run all sessions",
            onClick: () => {
                runAllSessions();
            },
        });
        this.addVerticalSpacer(ButtonsVerticalSpacing);
        /*
         * Single toggle for on-device execution. Its text tracks the connection
         * state (Execute on Device / Pushing... / Connecting... / Connected /
         * Not Connected) and it renders as a primary (blue) button while connected.
         */
        this.executeOnDeviceButton = this.addPushButton({
            text: EXECUTE_ON_DEVICE_TEXT,
            onClick: () => {
                toggleExecuteOnDevice();
            },
        });
        // Push content to the left
        this.addStretch(LAYOUT_STRETCH);
        this.addView(new ImportExportView(this.widget, exportJson, importJson));
    }
    /**
     * Reflect whether a push or scenario run is in flight on the "Run All" button.
     * @param busy - Whether the plugin is currently busy.
     */
    setBusy(busy) {
        this.runAllButton.enabled = !busy;
    }
    /**
     * Render the device connection state on the execute-on-device toggle:
     * text, enabled state, primary (blue) styling, and the tooltip detail.
     * @param state - The connection state to render.
     */
    setStatus(state) {
        const button = this.executeOnDeviceButton;
        button.text = STATE_TEXT[state];
        button.toolTip = STATE_DETAILS[state];
        /*
         * Only the two resting states are clickable; transitional and error states
         * resolve on their own (retry, push follow-up, or fallback to preview).
         */
        button.enabled = state === "off" || state === "connected";
        button.primary = state === "connected";
    }
}
