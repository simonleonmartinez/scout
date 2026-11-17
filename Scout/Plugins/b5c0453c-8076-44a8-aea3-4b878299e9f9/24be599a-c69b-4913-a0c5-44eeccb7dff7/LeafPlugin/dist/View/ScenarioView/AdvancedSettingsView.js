import * as Ui from "LensStudio:Ui";
import { createBoxLayout, createConfiguredWidget, setComboBoxItems, } from "../WidgetUtils.js";
import { allowedValues } from "../../Common/Typing.js";
import { Logger } from "../../Common/Logger.js";
import { SCENARIO_CONFIG_BACKGROUND_COLOR } from "../Ui/Colors.js";
import { LEAF_FALSE, LEAF_RESERVED_PARAM_KEYS, LEAF_RESERVED_PARAM_SPECS, LEAF_TRUE, unsupportedReservedKeys, } from "../../Common/ReservedParams.js";
const PANEL_TITLE = "Advanced Settings";
const CONTENT_MARGINS = [12, 8, 8, 8];
const CONTENT_SPACING = 6;
const ROW_MARGINS = [0, 0, 0, 0];
const ROW_SPACING = 6;
const LABEL_WIDTH = 90;
const LOG = new Logger("AdvancedSettingsView");
/** Warning slot for reserved keys the plugin has no editor for. */
const UNSUPPORTED_WARNING_KEY = "unsupported";
/** Decimal whole numbers only: `Number()` alone also takes hex and exponents. */
const INTEGER_PATTERN = /^[+-]?\d+$/;
function isInteger(value) {
    const trimmed = value.trim();
    return (INTEGER_PATTERN.test(trimmed) &&
        Math.abs(Number(trimmed)) <= Number.MAX_SAFE_INTEGER);
}
/** `"0600"`, `" +600 "` and `"-0"` all canonicalise to what LEAF computes. */
function toCanonicalInteger(value) {
    return String(Number(value.trim()));
}
/**
 * @returns The declared value `value` selects, case-insensitively when the
 * control says LEAF matches that way, or undefined when it selects none.
 */
function toCanonicalChoice(control, value) {
    const options = allowedValues(control.type);
    if (options.includes(value))
        return value;
    if (control.ignoreCase === undefined)
        return undefined;
    const upper = value.toUpperCase();
    return options.find((v) => v.toUpperCase() === upper);
}
/**
 * Collapsible "Advanced Settings" section shown per scenario. Houses the
 * LEAF-reserved settings so they don't clutter the main Parameters list.
 * One row per entry in {@link LEAF_RESERVED_PARAM_SPECS}.
 */
export class AdvancedSettingsView {
    constructor(parentWidget, scenarioConfig, setConfig) {
        this.scenarioConfig = scenarioConfig;
        this.setConfig = setConfig;
        this.fields = new Map();
        /** Last value warned about per key, so a config edit does not repeat it. */
        this.warned = new Map();
        this.deleted = false;
        /**
         * Construction order and properties match the working pattern used by
         * Fiji-Plugins (BodyMorph, Tool-Bridge-Panel, CollapsibleGroup): the panel
         * needs an Expanding/Fixed size policy and zero contents margins so its
         * header sizeHint reaches the parent layout on first render. The content
         * widget is fully laid out before being attached, and `expand()` is the
         * last call.
         */
        this.panel = new Ui.CollapsiblePanel(Editor.Icon.fromFile(new Editor.Path("")), PANEL_TITLE, parentWidget);
        this.panel.setSizePolicy(Ui.SizePolicy.Policy.Expanding, Ui.SizePolicy.Policy.Fixed);
        this.panel.setContentsMargins(0, 0, 0, 0);
        this.panel.overrideBackgroundRole = false;
        this.panel.autoFillBackground = true;
        this.panel.backgroundRole = SCENARIO_CONFIG_BACKGROUND_COLOR;
        this.panel.fontRole = Ui.FontRole.DefaultBold;
        const content = createConfiguredWidget({
            parentWidget,
            backgroundColorRole: SCENARIO_CONFIG_BACKGROUND_COLOR,
        });
        content.layout = createBoxLayout({
            direction: Ui.Direction.TopToBottom,
            contentMargins: CONTENT_MARGINS,
            spacing: CONTENT_SPACING,
        });
        for (const key of LEAF_RESERVED_PARAM_KEYS) {
            this.fields.set(key, this.buildRow(content, key));
        }
        this.panel.setContentWidget(content);
        this.panel.expandable = true;
        this.panel.expand(false);
        this.syncWidgetsFromConfig(this.scenarioConfig.value());
        this.unsubscribeConfig = this.scenarioConfig.subscribe((config) => {
            this.syncWidgetsFromConfig(config);
        });
    }
    /**
     * The underlying widget, so callers can add it to their own layout.
     */
    get widget() {
        if (this.deleted) {
            throw new Error("Advanced Settings has been deleted. Please close and re-open the plugin.");
        }
        return this.panel;
    }
    delete() {
        this.deleted = true;
        this.unsubscribeConfig();
        /* Destruction is deferred, so a signal arriving afterwards would reach
           setConfig and throw out of findScenarioModel. */
        for (const field of this.fields.values()) {
            field.connection.disconnect();
        }
        this.panel.deleteLater();
    }
    buildRow(parent, key) {
        const spec = LEAF_RESERVED_PARAM_SPECS[key];
        const row = createConfiguredWidget({ parentWidget: parent });
        const layout = createBoxLayout({
            direction: Ui.Direction.LeftToRight,
            contentMargins: ROW_MARGINS,
            spacing: ROW_SPACING,
        });
        row.layout = layout;
        const label = new Ui.Label(row);
        label.text = spec.label;
        label.setFixedWidth(LABEL_WIDTH);
        label.toolTip = spec.tooltip;
        layout.addWidget(label);
        let field;
        switch (spec.control.kind) {
            case "choice":
                field = this.buildChoiceField(row, key, spec.control, spec);
                break;
            case "toggle":
                field = this.buildToggleField(row, key, spec);
                break;
            case "integer":
                field = this.buildIntegerField(row, key, spec);
                break;
        }
        layout.addWidget(field.widget);
        layout.addStretch(1);
        parent.layout.addWidget(row);
        return field;
    }
    buildChoiceField(row, key, control, spec) {
        const combo = new Ui.ComboBox(row);
        combo.toolTip = spec.tooltip;
        if (control.minWidth !== undefined) {
            combo.setMinimumWidth(control.minWidth);
        }
        /* Rebuilding is the only way to drop a stale extra: ComboBox exposes
           addItem and clear, but no removeItem. */
        let extra;
        const setItems = (withExtra) => {
            extra = withExtra;
            setComboBoxItems(combo, allowedValues(control.type), withExtra);
        };
        setItems();
        const connection = combo.onCurrentTextChange.connect((value) => {
            this.updateReservedKey(key, value);
        });
        return {
            widget: combo,
            connection,
            write: (value) => {
                if (combo.hasFocus)
                    return;
                const canonical = toCanonicalChoice(control, value);
                /* An unlisted value cannot be assigned to a non-editable combo, so
                   offer it as an extra item. The row then matches config and selecting
                   a declared value emits a real change, which showing the default
                   instead did not. */
                const shown = canonical !== null && canonical !== void 0 ? canonical : value;
                if (canonical === undefined) {
                    this.warnOnce(key, value, `${spec.label} is "${value}"; LEAF will use "${spec.defaultValue}".`);
                }
                else {
                    this.clearWarning(key);
                }
                const wantExtra = canonical === undefined ? value : undefined;
                if (extra !== wantExtra)
                    setItems(wantExtra);
                if (combo.currentText === shown)
                    return;
                combo.blockSignals(true);
                combo.currentText = shown;
                combo.blockSignals(false);
            },
        };
    }
    buildToggleField(row, key, spec) {
        const check = new Ui.CheckBox(row);
        /* Without this the host may build an unresponsive box, and nothing in a
           type check or a stubbed harness would show it. */
        check.checkable = true;
        check.text = "";
        check.toolTip = spec.tooltip;
        const connection = check.onToggle.connect((checked) => {
            this.updateReservedKey(key, checked ? LEAF_TRUE : LEAF_FALSE);
        });
        return {
            widget: check,
            connection,
            write: (value) => {
                if (check.hasFocus)
                    return;
                /* A checkbox has no third state, so an unparseable value shows the
                   default. LEAF's resolveDisableUserInput falls back the same way, so
                   the box really is showing what the run will do. */
                const parsed = value === LEAF_TRUE || value === LEAF_FALSE;
                if (parsed) {
                    this.clearWarning(key);
                }
                else {
                    this.warnOnce(key, value, `${spec.label} is "${value}"; LEAF will use "${spec.defaultValue}".`);
                }
                const checked = (parsed ? value : spec.defaultValue) === LEAF_TRUE;
                if (check.checked === checked)
                    return;
                check.blockSignals(true);
                check.checked = checked;
                check.blockSignals(false);
            },
        };
    }
    buildIntegerField(row, key, spec) {
        const edit = new Ui.LineEdit(row);
        edit.toolTip = spec.tooltip;
        const setText = (value) => {
            if (edit.text === value)
                return;
            edit.blockSignals(true);
            edit.text = value;
            edit.blockSignals(false);
        };
        const stored = () => { var _a; return (_a = this.scenarioConfig.value()[key]) !== null && _a !== void 0 ? _a : spec.defaultValue; };
        const connection = edit.onEditingFinished.connect(() => {
            const text = edit.text;
            if (!isInteger(text)) {
                /* Fires on every focus-out, so only report a value the user changed;
                   otherwise reading a field logs and reverts on the way out. */
                if (text !== stored()) {
                    LOG.warn(`Invalid ${spec.label} "${text}"; expected a whole number.`);
                }
                setText(stored());
                return;
            }
            const canonical = toCanonicalInteger(text);
            /* Always converge the display: updateReservedKey no-ops when the value is
               unchanged, so relying on the config echo left "0600" on screen. */
            setText(canonical);
            const current = stored();
            const unchanged = isInteger(current) && toCanonicalInteger(current) === canonical;
            if (!unchanged)
                this.updateReservedKey(key, canonical);
        });
        return {
            widget: edit,
            connection,
            write: (value) => {
                if (edit.hasFocus)
                    return;
                if (isInteger(value)) {
                    this.clearWarning(key);
                    setText(toCanonicalInteger(value));
                    return;
                }
                /* No fallback claim here: LEAF does not default an unparseable number.
                   getNumberOrThrow throws for the timeout, and getNumber yields
                   undefined for the report duration. */
                this.warnOnce(key, value, `${spec.label} is "${value}"; LEAF will not read it as a whole number.`);
                setText(value);
            },
        };
    }
    /** Logs `message` unless `value` was already the last one reported for `key`. */
    warnOnce(key, value, message) {
        if (this.warned.get(key) === value)
            return;
        this.warned.set(key, value);
        LOG.warn(message);
    }
    clearWarning(key) {
        this.warned.delete(key);
    }
    updateReservedKey(key, value) {
        const current = this.scenarioConfig.value();
        if (current[key] === value)
            return;
        this.setConfig({ ...current, [key]: value });
    }
    syncWidgetsFromConfig(config) {
        var _a;
        for (const key of LEAF_RESERVED_PARAM_KEYS) {
            const field = this.fields.get(key);
            if (field === undefined)
                continue;
            /* Fall back to defaults when a key is absent, so a previously bound
               config's values don't linger. */
            const value = (_a = config[key]) !== null && _a !== void 0 ? _a : LEAF_RESERVED_PARAM_SPECS[key].defaultValue;
            field.write(value);
        }
        const unsupported = unsupportedReservedKeys(config).join(", ");
        if (unsupported.length > 0) {
            this.warnOnce(UNSUPPORTED_WARNING_KEY, unsupported, `Reserved keys with no editor, unchanged: ${unsupported}`);
        }
        else {
            this.clearWarning(UNSUPPORTED_WARNING_KEY);
        }
    }
}
