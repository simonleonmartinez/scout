import * as Ui from "LensStudio:Ui";
import { BaseView } from "../BaseView.js";
import Event from "../../Common/Event.js";
import { createConfiguredWidget, createBoxLayout, setComboBoxItems, } from "../WidgetUtils.js";
import { allowedValues } from "../../Common/Typing.js";
const MIN_WIDTH = 150;
const MAX_WIDTH = 300;
const PAIR_TO_PAIR_SPACING = 5;
const KEY_TO_VALUE_SPACING = 4;
const ROW_MARGINS = [0, 0, 0, 0];
const MAX_PARAMETER_VALUE_WIDTH = 50;
/** Wide enough to read a declared option rather than an elided prefix. */
const CHOICE_MIN_WIDTH = 110;
function isComboBox(field) {
    return field instanceof Ui.ComboBox;
}
function valueOf(field) {
    return isComboBox(field) ? field.currentText : field.text;
}
function sameValues(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}
/**
 * Widget for editing key-value pairs, where keys are fixed and values are
 * editable. A parameter the scenario declared with a fixed set of allowed
 * values gets a {@link Ui.ComboBox}; anything else gets a {@link Ui.LineEdit}
 * that commits on `onEditingFinished` (Enter / focus loss), matching the
 * direct-commit pattern used by the Advanced Settings fields.
 */
export class KeyValuesInputView extends BaseView {
    /**
     * @param parentWidget Parent widget to add this component to.
     * @param keyValues Initial key-value pairs to display.
     * @param parameterTypes Declared type per key; a key typed with a fixed set
     * of allowed values renders as a dropdown instead of a text field.
     */
    constructor(parentWidget, keyValues, parameterTypes = {}) {
        super(parentWidget, {
            direction: Ui.Direction.TopToBottom,
            contentMargins: ROW_MARGINS,
            spacing: PAIR_TO_PAIR_SPACING,
        });
        /**
         * Holds the UI elements for each key-value pair.
         */
        this.keyValueUis = [];
        this.onContentChangeEvent = new Event();
        /**
         * Subscribe to changes in the content (fired when a value is committed).
         */
        this.onContentChange = this.onContentChangeEvent.publicApi();
        this.parameterTypes = parameterTypes;
        this.createKeyValueUi(keyValues);
    }
    getContent() {
        const record = {};
        this.keyValueUis.forEach((pair) => {
            record[pair.key] = valueOf(pair.valueEdit);
        });
        return record;
    }
    /**
     * @param content - The key-value pairs to display.
     * @param parameterTypes - Refreshed declared types, e.g. after switching to
     * a different scenario. Omit to keep the current types.
     */
    setContent(content, parameterTypes) {
        if (parameterTypes !== undefined) {
            this.parameterTypes = parameterTypes;
        }
        // When only the values changed (same keys, same declared types), update the
        // existing fields in place rather than rebuilding. A commit triggers a
        // config round-trip that calls back into here, and rebuilding would destroy
        // the field the user is about to focus next.
        if (this.hasSameKeys(content) && this.fieldsMatchTypes()) {
            this.keyValueUis.forEach((pair) => {
                const value = content[pair.key];
                pair.committedValue = value;
                this.assignValue(pair, value);
            });
            return;
        }
        this.clearKeyValueUis();
        this.createKeyValueUi(content);
    }
    hasSameKeys(content) {
        const keys = Object.keys(content);
        if (keys.length !== this.keyValueUis.length)
            return false;
        return this.keyValueUis.every((pair) => pair.key in content);
    }
    /** False once a key's declared options change, since the field cannot adapt. */
    fieldsMatchTypes() {
        return this.keyValueUis.every((pair) => sameValues(pair.allowed, allowedValues(this.parameterTypes[pair.key])));
    }
    assignValue(pair, value) {
        const field = pair.valueEdit;
        if (valueOf(field) === value)
            return;
        field.blockSignals(true);
        if (isComboBox(field)) {
            field.currentText = value;
        }
        else {
            field.text = value;
        }
        field.blockSignals(false);
    }
    createKeyValueUi(pairs) {
        Object.entries(pairs).forEach(([key, value]) => {
            const rowWidget = createConfiguredWidget({ parentWidget: this.widget });
            const rowLayout = createBoxLayout({
                direction: Ui.Direction.LeftToRight,
                contentMargins: ROW_MARGINS,
                spacing: KEY_TO_VALUE_SPACING,
            });
            const bulletLabel = new Ui.Label(rowWidget);
            bulletLabel.text = "•";
            bulletLabel.setSizePolicy(Ui.SizePolicy.Policy.Fixed, Ui.SizePolicy.Policy.Fixed);
            const keyLabel = new Ui.Label(rowWidget);
            keyLabel.text = `${key}:`;
            const allowed = allowedValues(this.parameterTypes[key]);
            const valueEdit = this.createValueField(rowWidget, allowed, value);
            rowLayout.addWidget(bulletLabel);
            rowLayout.addWidget(keyLabel);
            rowLayout.addWidget(valueEdit);
            rowWidget.setMinimumWidth(MIN_WIDTH);
            rowWidget.setMaximumWidth(MAX_WIDTH);
            rowLayout.addStretch(1);
            rowWidget.layout = rowLayout;
            this.addWidget(rowWidget);
            const pair = {
                key,
                valueEdit,
                rowWidget,
                committedValue: value,
                allowed,
            };
            const commit = () => {
                const committed = valueOf(valueEdit);
                if (pair.committedValue === committed)
                    return;
                pair.committedValue = committed;
                this.onContentChangeEvent.invoke();
            };
            if (isComboBox(valueEdit)) {
                valueEdit.onCurrentTextChange.connect(commit);
            }
            else {
                valueEdit.onEditingFinished.connect(commit);
            }
            this.keyValueUis.push(pair);
        });
    }
    createValueField(rowWidget, allowed, value) {
        if (allowed.length === 0) {
            const edit = new Ui.LineEdit(rowWidget);
            edit.text = value;
            edit.setMaximumWidth(MAX_PARAMETER_VALUE_WIDTH);
            return edit;
        }
        const combo = new Ui.ComboBox(rowWidget);
        combo.setMinimumWidth(CHOICE_MIN_WIDTH);
        /* A stored value outside the declared set is kept rather than silently
           rewritten; an empty one would otherwise settle on the first option and
           be persisted as it. */
        setComboBoxItems(combo, allowed, value);
        combo.currentText = value;
        return combo;
    }
    clearKeyValueUis() {
        this.keyValueUis.forEach((pair) => {
            pair.rowWidget.deleteLater();
        });
        this.keyValueUis = [];
    }
}
