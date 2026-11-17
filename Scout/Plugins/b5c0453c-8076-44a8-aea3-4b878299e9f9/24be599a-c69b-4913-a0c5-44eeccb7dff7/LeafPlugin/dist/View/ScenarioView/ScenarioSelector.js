import * as Ui from "LensStudio:Ui";
import { BaseView } from "../BaseView.js";
import { DELETE_ICON_SVG, PLAY_ICON_SVG } from "../Ui/icons.js";
import { SCENARIO_SELECTION_BACKGROUND_COLOR } from "../Ui/Colors.js";
const SCENARIO_SELECTOR_SPACING = 4;
const SCENARIO_SELECTOR_MARGINS = [8, 7, 0, 7];
/**
 * View to select scenarios to be run.
 */
export class ScenarioSelector extends BaseView {
    constructor(parentWidget, availableScenariosObservable, scenarioIdObservable, removeScenario, setScenarioId, runScenario) {
        super(parentWidget, {
            direction: Ui.Direction.LeftToRight,
            contentMargins: SCENARIO_SELECTOR_MARGINS,
            spacing: SCENARIO_SELECTOR_SPACING,
        }, SCENARIO_SELECTION_BACKGROUND_COLOR);
        this.removeScenario = removeScenario;
        this.setScenarioId = setScenarioId;
        this.unsubscribeFunctions = [];
        this.addWidget(this.createScenarioDropdown(availableScenariosObservable, scenarioIdObservable));
        // Scenario management
        this.addPushButton({
            icon: PLAY_ICON_SVG,
            tooltip: "Run this scenario separately",
            onClick: () => {
                runScenario();
            },
        });
        this.addPushButton({
            icon: DELETE_ICON_SVG,
            tooltip: "Remove this scenario from the session",
            onClick: () => {
                this.removeScenario();
            },
        });
    }
    /** Keep an unavailable saved Scenario visible until the user replaces or removes it. */
    createScenarioDropdown(availableScenariosObservable, scenarioIdObservable) {
        const scenarioDropdown = new Ui.ComboBox(this.widget);
        const refresh = () => {
            const available = availableScenariosObservable.value();
            const id = scenarioIdObservable.value();
            const selected = available[id] ? id : `${id} (not listed)`;
            scenarioDropdown.blockSignals(true);
            scenarioDropdown.clear();
            for (const scenarioId of Object.keys(available))
                scenarioDropdown.addItem(scenarioId);
            if (!available[id])
                scenarioDropdown.addItem(selected);
            scenarioDropdown.currentText = selected;
            scenarioDropdown.toolTip = available[id] ? "" : "This saved scenario is not in the current list. The lens may still be loading or discovery may have failed.";
            scenarioDropdown.blockSignals(false);
        };
        refresh();
        scenarioDropdown.setSizePolicy(Ui.SizePolicy.Policy.Preferred, Ui.SizePolicy.Policy.Fixed);
        scenarioDropdown.onCurrentTextChange.connect((id) => {
            if (availableScenariosObservable.value()[id])
                this.setScenarioId(id);
        });
        this.unsubscribeFunctions.push(scenarioIdObservable.subscribe(refresh), availableScenariosObservable.subscribe(refresh));
        return scenarioDropdown;
    }
    /** @override */
    delete() {
        this.unsubscribeFunctions.forEach((unsubscribe) => unsubscribe());
        this.unsubscribeFunctions = [];
        super.delete();
    }
}
