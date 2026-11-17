import * as Ui from "LensStudio:Ui";
const HORIZONTAL_SIZE_POLICY = Ui.SizePolicy.Policy.Fixed;
const VERTICAL_SIZE_POLICY = Ui.SizePolicy.Policy.Preferred;
const ICON_SIZE = 14;
/**
 * Creates a box layout with specified direction, content margins, and spacing.
 * @param config Configuration object for the box layout
 * @returns Ui.BoxLayout
 */
export function createBoxLayout(config) {
    const layout = new Ui.BoxLayout();
    layout.setDirection(config.direction);
    layout.setContentsMargins(...config.contentMargins);
    layout.spacing = config.spacing;
    return layout;
}
/**
 * Creates a widget with optional background color and pre-set size policies.
 * @param config Configuration object for the widget
 * @returns Ui.Widget with specified properties
 */
export function createConfiguredWidget(config) {
    const widget = new Ui.Widget(config.parentWidget);
    widget.setSizePolicy(VERTICAL_SIZE_POLICY, HORIZONTAL_SIZE_POLICY);
    if (config.backgroundColorRole) {
        widget.backgroundRole = config.backgroundColorRole;
        widget.autoFillBackground = true;
    }
    return widget;
}
/**
 * Creates a push button widget with optional text, icon, and click handler.
 * Supports both legacy parameters and new config object approach.
 * @param config Configuration object for the push button
 */
export function createPushButton(parentWidget, config) {
    const button = new Ui.PushButton(parentWidget);
    button.text = config.text || "";
    button.setSizePolicy(VERTICAL_SIZE_POLICY, HORIZONTAL_SIZE_POLICY);
    if (config.icon) {
        const icon = Editor.Icon.fromSvgData(config.icon);
        button.setIcon(icon);
        button.setIconSize(ICON_SIZE, ICON_SIZE);
        button.setIconMode(Ui.IconMode.MonoChrome);
        button.setSizePolicy(Ui.SizePolicy.Policy.Fixed, Ui.SizePolicy.Policy.Fixed);
    }
    if (config.onClick) {
        button.onClick.connect(config.onClick);
    }
    if (config.tooltip) {
        button.toolTip = config.tooltip;
    }
    if (config.primary) {
        button.primary = true;
    }
    return button;
}
/**
 * Creates a spacer widget with fixed height to separate UI elements vertically.
 * @param parentWidget Parent widget for the spacer
 * @param height Height of the spacer
 * @returns Ui.Widget
 */
export function createHorizontalSpacer(parentWidget, height, colorRole) {
    const spacer = createConfiguredWidget({ parentWidget });
    spacer.setFixedHeight(height);
    if (colorRole) {
        spacer.backgroundRole = colorRole;
        spacer.autoFillBackground = true;
    }
    return spacer;
}
/**
 * Creates a spacer widget with fixed width to separate UI elements horizontally.
 * @param parentWidget Parent widget for the spacer
 * @param width Width of the spacer
 * @returns Ui.Widget
 */
export function createVerticalSpacer(parentWidget, width, colorRole) {
    const spacer = createConfiguredWidget({ parentWidget });
    spacer.setFixedWidth(width);
    if (colorRole) {
        spacer.backgroundRole = colorRole;
        spacer.autoFillBackground = true;
    }
    return spacer;
}
export function createLabel(parentWidget, text, fontRole) {
    const label = new Ui.Label(parentWidget);
    label.text = text;
    label.fontRole = fontRole;
    label.setSizePolicy(Ui.SizePolicy.Policy.Fixed, Ui.SizePolicy.Policy.Fixed);
    return label;
}
/**
 * Creates a visible divider line widget.
 * @param parentWidget - Parent widget for the divider
 * @param config - Configuration for the divider
 * @returns Ui.Widget configured as a divider line
 */
export function createDivider(parentWidget, config) {
    const divider = createConfiguredWidget({ parentWidget });
    const thickness = config.thickness || 1;
    divider.backgroundRole = config.colorRole;
    divider.autoFillBackground = true;
    if (config.orientation === "horizontal") {
        divider.setFixedHeight(thickness);
        divider.setSizePolicy(Ui.SizePolicy.Policy.Expanding, Ui.SizePolicy.Policy.Fixed);
    }
    else {
        divider.setFixedWidth(thickness);
        divider.setSizePolicy(Ui.SizePolicy.Policy.Fixed, Ui.SizePolicy.Policy.Expanding);
    }
    return divider;
}
/**
 * Replaces the items of `combo` with `options`, plus `extra` when it is not
 * one of them, so a stored value outside the set stays selectable. Signals
 * are blocked while it rebuilds.
 */
export function setComboBoxItems(combo, options, extra) {
    combo.blockSignals(true);
    combo.clear();
    for (const option of options) {
        combo.addItem(option);
    }
    if (extra !== undefined && !options.includes(extra)) {
        combo.addItem(extra);
    }
    combo.blockSignals(false);
}
