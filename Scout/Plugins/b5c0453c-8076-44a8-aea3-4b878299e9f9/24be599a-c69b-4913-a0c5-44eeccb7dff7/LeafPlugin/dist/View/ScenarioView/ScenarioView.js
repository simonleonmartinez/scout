import * as Ui from "LensStudio:Ui";
import { BaseView } from "../BaseView.js";
import { ScenarioSelector } from "./ScenarioSelector.js";
import { Configuration } from "./Configuration.js";
import { AdvancedSettingsView } from "./AdvancedSettingsView.js";
import { SCENARIO_VIEW_BACKGROUND_COLOR } from "../Ui/Colors.js";
const SCENARIO_VIEW_SPACING = 6;
const SCENARIO_VIEW_MARGINS = [1, 1, 1, 1];
/**
 * Scenario widget handling the UI for a single scenario.
 */
export class ScenarioView extends BaseView {
    constructor(parentWidget, availableScenariosObservable, availableParameterTypesObservable, scenarioObservable, removeScenario, setConfig, setScenarioId, runScenario) {
        super(parentWidget, {
            direction: Ui.Direction.TopToBottom,
            contentMargins: SCENARIO_VIEW_MARGINS,
            spacing: SCENARIO_VIEW_SPACING,
        }, SCENARIO_VIEW_BACKGROUND_COLOR);
        this.scenarioSelector = new ScenarioSelector(this.widget, availableScenariosObservable, scenarioObservable.id, removeScenario, setScenarioId, runScenario);
        this.addView(this.scenarioSelector);
        this.configuration = new Configuration(this.widget, scenarioObservable.config, setConfig, availableParameterTypesObservable, scenarioObservable.id);
        this.addView(this.configuration);
        this.advancedSettings = new AdvancedSettingsView(this.widget, scenarioObservable.config, setConfig);
        this.addWidget(this.advancedSettings.widget);
    }
    /** @override */
    delete() {
        this.scenarioSelector.delete();
        this.configuration.delete();
        this.advancedSettings.delete();
        super.delete();
    }
}
