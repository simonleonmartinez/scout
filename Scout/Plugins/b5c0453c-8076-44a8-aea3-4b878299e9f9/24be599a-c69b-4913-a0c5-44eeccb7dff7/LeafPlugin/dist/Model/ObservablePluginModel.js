import { ObservableProperty } from "../Common/ObservableProperty.js";
/**
 * Observable companion for PluginModel.
 * Views subscribe to these observables to react to changes.
 */
export class ObservablePluginModel {
    constructor() {
        this.sessions = new ObservableProperty();
        this.defaultConfigs = new ObservableProperty();
        this.availableParameterTypes = new ObservableProperty();
    }
}
