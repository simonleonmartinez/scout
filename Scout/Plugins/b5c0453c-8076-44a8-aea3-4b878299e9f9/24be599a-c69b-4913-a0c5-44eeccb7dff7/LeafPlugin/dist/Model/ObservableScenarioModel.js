import { ObservableProperty } from "../Common/ObservableProperty.js";
/**
 * Observable companion for ScenarioModel.
 * Views subscribe to these observables to react to changes.
 */
export class ObservableScenarioModel {
    constructor() {
        this.id = new ObservableProperty();
        this.config = new ObservableProperty();
    }
}
