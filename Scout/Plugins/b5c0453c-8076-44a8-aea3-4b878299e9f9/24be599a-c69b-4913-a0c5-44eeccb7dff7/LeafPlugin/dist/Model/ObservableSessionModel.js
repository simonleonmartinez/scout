import { ObservableProperty } from "../Common/ObservableProperty.js";
/**
 * Observable companion for SessionModel.
 * Views subscribe to these observables to react to changes.
 */
export class ObservableSessionModel {
    constructor() {
        this.name = new ObservableProperty();
        this.scenarios = new ObservableProperty();
    }
}
