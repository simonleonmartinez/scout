import { createBoxLayout, createConfiguredWidget, createHorizontalSpacer, createLabel, createPushButton, createVerticalSpacer, createDivider, } from "./WidgetUtils.js";
/**
 * Handles the main widget creation and deletion.
 * Used as base class for other views.
 */
export class BaseView {
    /**
     * @param parentWidget - Parent widget for the new widget
     * @param layoutConfig - Layout configuration for the new widget
     * @param backgroundColorRole - Background color role for the new widget
     */
    constructor(parentWidget, layoutConfig, backgroundColorRole) {
        const widget = createConfiguredWidget({
            parentWidget,
            backgroundColorRole: backgroundColorRole,
        });
        this._widget = widget;
        this._layout = createBoxLayout(layoutConfig);
        widget.layout = this._layout;
    }
    /**
     * Main widget containing all UI elements.
     */
    get widget() {
        if (!this._widget) {
            throw new Error("Widget has been deleted. Please close and re-open the plugin.");
        }
        return this._widget;
    }
    /**
     * Delete the widget with all content.
     */
    delete() {
        var _a;
        (_a = this._widget) === null || _a === void 0 ? void 0 : _a.deleteLater();
        this._layout.deleteLater();
        // Clear the reference so the `widget` getter's guard fires on later access.
        this._widget = undefined;
    }
    /**
     * Add a widget to the layout.
     * @param widget - Widget to add to the layout.
     */
    addWidget(widget) {
        this._layout.addWidget(widget);
    }
    /**
     * Add a base view to the layout.
     * @param baseView - Base view to add to the layout.
     */
    addView(baseView) {
        this._layout.addWidget(baseView.widget);
    }
    /**
     * Add a stretch to the layout
     * addStretch(1) pushes the content to the beginning of the layout
     * (e.g. to the top for top to bottom layout)
     * @param stretch - Stretch to add to the layout.
     */
    addStretch(stretch) {
        this._layout.addStretch(stretch);
    }
    /**
     * Create and add a horizontal spacer widget.
     * @param widget - Widget to add to the layout.
     */
    addHorizontalSpacer(height, colorRole) {
        this._layout.addWidget(createHorizontalSpacer(this.widget, height, colorRole));
    }
    /**
     * Create and add a vertical spacer widget.
     * @param widget - Widget to add to the layout.
     */
    addVerticalSpacer(width, colorRole) {
        this._layout.addWidget(createVerticalSpacer(this.widget, width, colorRole));
    }
    /**
     * Create and add a push button widget.
     * @param widget - Widget to add to the layout.
     */
    addPushButton(config) {
        const button = createPushButton(this.widget, config);
        this._layout.addWidget(button);
        return button;
    }
    /**
     * Create and add a label widget.
     * @param text - Text for the label.
     * @param fontRole - Font role for the label.
     * @returns New label widget.
     */
    addLabel(text, fontRole) {
        const label = createLabel(this.widget, text, fontRole);
        this._layout.addWidget(label);
        return label;
    }
    /**
     * Create and add a divider line widget.
     * @param config - Configuration for the divider.
     * @returns New divider widget.
     */
    addDivider(config) {
        const divider = createDivider(this.widget, config);
        this._layout.addWidget(divider);
        return divider;
    }
}
