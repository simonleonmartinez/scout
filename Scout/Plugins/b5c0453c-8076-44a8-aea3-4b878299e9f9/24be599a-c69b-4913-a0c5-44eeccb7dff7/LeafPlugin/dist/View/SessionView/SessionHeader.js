import * as Ui from "LensStudio:Ui";
import { BaseView } from "../BaseView.js";
import { DELETE_ICON_SVG, PLAY_ICON_SVG, PLUS_ICON_SVG } from "../Ui/icons.js";
const SESSION_NAME_MIN_WIDTH = 200;
const SESSION_NAME_MAX_WIDTH = 300;
const SESSION_HEADER_SPACING = 4;
const SESSION_HEADER_MARGINS = [0, 0, 0, 0];
const SESSION_HEAD_BUTTONS_SPACING = 0;
const SESSION_HEADER_BUTTONS_MARGINS = [0, 0, 0, 0];
const SESSION_HEADER_BUTTONS_STRETCH = 1;
class SessionHeaderButtons extends BaseView {
    constructor(parentWidget, runScenarios, deleteSession) {
        super(parentWidget, {
            direction: Ui.Direction.RightToLeft,
            contentMargins: SESSION_HEADER_BUTTONS_MARGINS,
            spacing: SESSION_HEAD_BUTTONS_SPACING,
        });
        this.addPushButton({
            icon: DELETE_ICON_SVG,
            tooltip: "Delete this session",
            onClick: () => {
                deleteSession();
            },
        });
        this.addVerticalSpacer(SESSION_HEADER_SPACING);
        this.runSessionButton = this.addPushButton({
            icon: PLAY_ICON_SVG,
            tooltip: "Run all scenarios in this session",
            onClick: () => {
                runScenarios();
            },
        });
        this.addStretch(SESSION_HEADER_BUTTONS_STRETCH);
    }
    /**
     * Enables or disables the run button in the session header.
     * @param enabled - Whether the run button should be enabled.
     */
    enableRunSession(enabled) {
        this.runSessionButton.enabled = enabled;
    }
}
const ADD_SCENARIO_TOOLTIP = "Add a scenario to the session";
const ADD_SCENARIO_DISABLED_TOOLTIP = "No scenarios available. Ensure a LeafIndex is in the scene, and push the lens when executing on device.";
/**
 * Header for a session, containing the session name and action buttons.
 */
export class SessionHeader extends BaseView {
    constructor(parentWidget, nameObservable, updateSessionName, deleteSession, runScenarios, addScenario) {
        super(parentWidget, {
            direction: Ui.Direction.LeftToRight,
            contentMargins: SESSION_HEADER_MARGINS,
            spacing: SESSION_HEADER_SPACING,
        });
        this.sessionNameEdit = this.createSessionNameEdit(nameObservable, updateSessionName);
        this.addWidget(this.sessionNameEdit);
        this.addScenarioButton = this.addPushButton({
            tooltip: ADD_SCENARIO_TOOLTIP,
            icon: PLUS_ICON_SVG,
            primary: true,
            onClick: () => {
                addScenario();
            },
        });
        // Push buttons to the right
        this.addStretch(SESSION_HEADER_BUTTONS_STRETCH);
        this.sessionHeaderButtons = new SessionHeaderButtons(this.widget, runScenarios, deleteSession);
        this.addView(this.sessionHeaderButtons);
    }
    /**
     * Enables or disables the run button in the session header.
     * @param enabled - Whether the run button should be enabled.
     */
    enableRunSession(enabled) {
        this.sessionHeaderButtons.enableRunSession(enabled);
    }
    /**
     * Enables or disables the add-scenario button, explaining why when disabled.
     * @param enabled - Whether adding a scenario is currently possible.
     */
    enableAddScenario(enabled) {
        this.addScenarioButton.enabled = enabled;
        this.addScenarioButton.toolTip = enabled
            ? ADD_SCENARIO_TOOLTIP
            : ADD_SCENARIO_DISABLED_TOOLTIP;
    }
    createSessionNameEdit(sessionNameObservable, updateSessionName) {
        const sessionNameEdit = new Ui.LineEdit(this.widget);
        sessionNameEdit.text = sessionNameObservable.value();
        sessionNameEdit.fontRole = Ui.FontRole.MediumTitleBold;
        sessionNameEdit.backgroundRole = Ui.ColorRole.Base;
        sessionNameEdit.setSizePolicy(Ui.SizePolicy.Policy.Preferred, Ui.SizePolicy.Policy.Fixed);
        sessionNameEdit.setMinimumWidth(SESSION_NAME_MIN_WIDTH);
        sessionNameEdit.setMaximumWidth(SESSION_NAME_MAX_WIDTH);
        sessionNameEdit.onEditingFinished.connect(() => {
            if (sessionNameEdit.text === sessionNameObservable.value())
                return;
            updateSessionName(sessionNameEdit.text);
        });
        this.unsubscribe = sessionNameObservable.subscribe((name) => {
            if (sessionNameEdit.text === name)
                return;
            sessionNameEdit.blockSignals(true);
            sessionNameEdit.text = name;
            sessionNameEdit.blockSignals(false);
        });
        return sessionNameEdit;
    }
    /** @override */
    delete() {
        this.unsubscribe();
        this.sessionNameEdit.deleteLater();
        this.sessionHeaderButtons.delete();
        super.delete();
    }
}
