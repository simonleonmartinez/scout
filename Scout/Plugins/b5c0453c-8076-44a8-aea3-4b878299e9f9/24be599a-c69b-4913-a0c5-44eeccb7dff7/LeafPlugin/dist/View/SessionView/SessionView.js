import * as Ui from "LensStudio:Ui";
import { BaseView } from "../BaseView.js";
import { SessionFrameView } from "./SessionFrameView.js";
import { SESSION_VIEW_BACKGROUND_COLOR } from "../Ui/Colors.js";
const SESSION_VIEW_SPACING = 0;
const SESSION_VIEW_MARGINS = [0, 0, 0, 0];
const SESSION_SPACING = 8;
/**
 * Session widget containing UI for scenario management within a session.
 */
export class SessionView extends BaseView {
    constructor(parentWidget, sessionObservable, availableScenariosObservable, availableParameterTypesObservable, deleteSession, addScenario, updateSessionName, runAllSessions, removeScenario, setConfig, setScenarioId, runScenario) {
        super(parentWidget, {
            direction: Ui.Direction.TopToBottom,
            contentMargins: SESSION_VIEW_MARGINS,
            spacing: SESSION_VIEW_SPACING,
        }, SESSION_VIEW_BACKGROUND_COLOR);
        this._sessionObservable = sessionObservable;
        this._availableScenariosObservable = availableScenariosObservable;
        this._availableParameterTypesObservable = availableParameterTypesObservable;
        this.addHorizontalSpacer(SESSION_SPACING);
        // Frame around the session-block.
        this.sessionFrameView = new SessionFrameView(this.widget, this._sessionObservable, this._availableScenariosObservable, this._availableParameterTypesObservable, deleteSession, addScenario, updateSessionName, runAllSessions, removeScenario, setConfig, setScenarioId, runScenario);
        this.addView(this.sessionFrameView);
    }
    get sessionObservable() {
        return this._sessionObservable;
    }
    /** @override */
    delete() {
        this.sessionFrameView.delete();
        super.delete();
    }
}
