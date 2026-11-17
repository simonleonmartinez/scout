import * as Ui from "LensStudio:Ui";
import { BaseView } from "../BaseView.js";
import { ScenarioView } from "../ScenarioView/ScenarioView.js";
const SCENARIO_CONTAINER_SPACING = 6;
const SCENARIO_CONTAINER_MARGINS = [0, 0, 0, 0];
/**
 * Container in which new scenarios get created.
 */
export class ScenarioContainer extends BaseView {
    constructor(parentWidget, scenarioListObservable, availableScenariosObservable, availableParameterTypesObservable, removeScenario, setConfig, setScenarioId, runScenario) {
        super(parentWidget, {
            direction: Ui.Direction.TopToBottom,
            contentMargins: SCENARIO_CONTAINER_MARGINS,
            spacing: SCENARIO_CONTAINER_SPACING,
        });
        this.scenarioListObservable = scenarioListObservable;
        this.availableScenariosObservable = availableScenariosObservable;
        this.availableParameterTypesObservable = availableParameterTypesObservable;
        this.removeScenario = removeScenario;
        this.setConfig = setConfig;
        this.setScenarioId = setScenarioId;
        this.runScenario = runScenario;
        this.scenarioViews = [];
        this.syncScenarioViews();
        // For now we recreate all scenarios when the list changes to avoid having to deal with scenario orders.
        this.unsubscribe = this.scenarioListObservable.subscribe(() => {
            this.syncScenarioViews();
        });
    }
    syncScenarioViews() {
        this.deleteAllScenarioViews();
        const currentScenarios = this.scenarioListObservable.value();
        currentScenarios.forEach((scenarioObservable) => {
            if (!scenarioObservable) {
                throw new Error("Scenario observable is null");
            }
            const scenarioView = new ScenarioView(this.widget, this.availableScenariosObservable, this.availableParameterTypesObservable, scenarioObservable, () => this.removeScenario(scenarioObservable), (config) => this.setConfig(scenarioObservable, config), (scenarioId) => this.setScenarioId(scenarioObservable, scenarioId), () => this.runScenario(scenarioObservable));
            this.addView(scenarioView);
            this.scenarioViews.push(scenarioView);
        });
    }
    deleteAllScenarioViews() {
        this.scenarioViews.forEach((scenarioView) => {
            scenarioView.delete();
        });
        this.scenarioViews = [];
    }
    /** @override */
    delete() {
        this.unsubscribe();
        this.deleteAllScenarioViews();
        super.delete();
    }
}
