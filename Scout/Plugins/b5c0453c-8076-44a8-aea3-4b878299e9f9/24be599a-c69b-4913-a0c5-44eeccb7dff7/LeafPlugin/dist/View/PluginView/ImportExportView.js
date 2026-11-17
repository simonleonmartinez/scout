import * as Ui from "LensStudio:Ui";
import { BaseView } from "../BaseView.js";
import { SAVE_ICON_SVG, LOAD_ICON_SVG } from "../Ui/icons.js";
const JSON_BUTTONS_VERTICAL_SPACING = 4;
const JSON_BUTTONS_CONTAINER_SPACING = 0;
const JSON_BUTTONS_MARGINS = [0, 0, 0, 0];
/**
 * View for import/exporting the plugin state to/from JSON.
 * Contains buttons for exporting and loading JSON.
 */
export class ImportExportView extends BaseView {
    constructor(parentWidget, exportJson, loadJson) {
        super(parentWidget, {
            direction: Ui.Direction.RightToLeft,
            contentMargins: JSON_BUTTONS_MARGINS,
            spacing: JSON_BUTTONS_CONTAINER_SPACING,
        });
        this.addPushButton({
            icon: SAVE_ICON_SVG,
            tooltip: "Save to JSON file",
            onClick: () => {
                exportJson();
            },
        });
        this.addVerticalSpacer(JSON_BUTTONS_VERTICAL_SPACING);
        this.addPushButton({
            icon: LOAD_ICON_SVG,
            tooltip: "Load from JSON file",
            onClick: () => {
                loadJson();
            },
        });
        this.addStretch(1);
    }
}
