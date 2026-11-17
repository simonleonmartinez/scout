import * as Ui from "LensStudio:Ui";
import { BaseView } from "../BaseView";
import { SessionHeader } from "./SessionHeader";
import { ScenarioContainer } from "./ScenarioContainer";
import { SESSION_FRAME_BACKGROUND_COLOR } from "../Ui/Colors";
const SESSION_DIVIDER_SPACING = 2;
const SESSION_FRAME_SPACING = 4;
const SESSION_FRAME_MARGINS = [8, 8, 8, 8];
export class SessionFrameView extends BaseView {
    constructor(parentWidget, sessionObservable, availableScenariosObservable, availableParameterTypesObservable, deleteSession, addScenario, updateSessionName, runScenarios, removeScenario, setConfig, setScenarioId, runScenario) {
        super(parentWidget, {
            direction: Ui.Direction.TopToBottom,
            contentMargins: SESSION_FRAME_MARGINS,
            spacing: SESSION_FRAME_SPACING,
        }, SESSION_FRAME_BACKGROUND_COLOR);
        this.sessionObservable = sessionObservable;
        this.availableScenariosObservable = availableScenariosObservable;
        this.availableParameterTypesObservable = availableParameterTypesObservable;
        // Header with session title and delete button
        this.sessionHeader = new SessionHeader(this.widget, this.sessionObservable.name, updateSessionName, deleteSession, runScenarios, addScenario);
        this.addView(this.sessionHeader);
        this.addHorizontalSpacer(SESSION_DIVIDER_SPACING);
        this.addDivider({
            orientation: "horizontal",
            colorRole: Ui.ColorRole.Text,
            thickness: 1,
        });
        this.addHorizontalSpacer(SESSION_DIVIDER_SPACING);
        // Container for scenarios
        this._scenarioContainer = new ScenarioContainer(this.widget, this.sessionObservable.scenarios, this.availableScenariosObservable, this.availableParameterTypesObservable, removeScenario, setConfig, setScenarioId, runScenario);
        this.addView(this._scenarioContainer);
        this.unsubscribe = sessionObservable.scenarios.subscribe((scenarios) => {
            this.enableRunSession(scenarios.length > 0);
        });
        // subscribe() does not fire immediately; set the initial state explicitly.
        this.enableRunSession(sessionObservable.scenarios.value().length > 0);
        // Adding a scenario is only possible when the lens reported at least one.
        this.unsubscribeAvailableScenarios =
            this.availableScenariosObservable.subscribe((availableScenarios) => {
                this.sessionHeader.enableAddScenario(Object.keys(availableScenarios || {}).length > 0);
            });
        this.sessionHeader.enableAddScenario(Object.keys(this.availableScenariosObservable.value() || {}).length > 0);
    }
    /**
     * Enables or disables the run button in the session header.
     * @param enabled - Whether the run button should be enabled.
     */
    enableRunSession(enabled) {
        this.sessionHeader.enableRunSession(enabled);
    }
    /** @override */
    delete() {
        this.unsubscribe();
        this.unsubscribeAvailableScenarios();
        this.sessionHeader.delete();
        this._scenarioContainer.delete();
        super.delete();
    }
}
