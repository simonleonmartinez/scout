import * as Ui from "LensStudio:Ui";
import { BaseView } from "../BaseView.js";
import { KeyValuesInputView } from "../InputViews/KeyValuesInputView.js";
import { SCENARIO_CONFIG_BACKGROUND_COLOR } from "../Ui/Colors.js";
import { splitReservedKeys } from "../../Common/ReservedParams.js";
const SCENARIO_CONFIG_SPACING = 4;
const SCENARIO_CONFIG_MARGINS = [12, 8, 8, 8];
const SCENARIO_CONFIG_TITLE = "Parameters";
/**
 * Configuration widget showing a scenario's user-facing parameters.
 * LEAF-reserved keys (`__leaf__*`) are filtered out; they are surfaced
 * via the {@link AdvancedSettingsView} collapsible section instead.
 */
export class Configuration extends BaseView {
    constructor(parentWidget, scenarioConfig, setConfig, availableParameterTypes, scenarioId) {
        super(parentWidget, {
            direction: Ui.Direction.TopToBottom,
            contentMargins: SCENARIO_CONFIG_MARGINS,
            spacing: SCENARIO_CONFIG_SPACING,
        }, SCENARIO_CONFIG_BACKGROUND_COLOR);
        this.addLabel(SCENARIO_CONFIG_TITLE, Ui.FontRole.DefaultBold);
        /* Re-derived per call so it tracks the currently selected scenario, not the
           one selected when Configuration was built. */
        const getParameterTypes = () => { var _a; return (_a = availableParameterTypes.value()[scenarioId.value()]) !== null && _a !== void 0 ? _a : {}; };
        const initialUserParams = splitReservedKeys(scenarioConfig.value()).scenario;
        const keyValues = new KeyValuesInputView(this.widget, initialUserParams, getParameterTypes());
        keyValues.onContentChange.add(() => {
            const userParams = keyValues.getContent();
            const reserved = splitReservedKeys(scenarioConfig.value()).reserved;
            setConfig({ ...reserved, ...userParams });
        });
        this.unsubscribeScenarioConfig = scenarioConfig.subscribe((config) => {
            const userParams = splitReservedKeys(config).scenario;
            keyValues.setContent(userParams, getParameterTypes());
            this.showWidget(Object.keys(userParams).length > 0);
        });
        /* Types can change without the config changing, e.g. switching to a
           scenario that declares the same keys with different allowed values. */
        this.unsubscribeParameterTypes = availableParameterTypes.subscribe(() => {
            const userParams = splitReservedKeys(scenarioConfig.value()).scenario;
            keyValues.setContent(userParams, getParameterTypes());
        });
        this.addView(keyValues);
        this.showWidget(Object.keys(initialUserParams).length > 0);
    }
    /** @override */
    delete() {
        this.unsubscribeScenarioConfig();
        this.unsubscribeParameterTypes();
        super.delete();
    }
    /**
     * Show or hide the parameters.
     * @param show - Whether to show the widget.
     */
    showWidget(show) {
        this.widget.visible = show;
    }
}
