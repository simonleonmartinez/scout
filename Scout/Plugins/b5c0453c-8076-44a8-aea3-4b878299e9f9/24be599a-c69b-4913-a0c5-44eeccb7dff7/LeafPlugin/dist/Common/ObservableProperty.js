/**
 * Create a property that can be observed.
 * @template T - The type of the property.
 */
export class ObservableProperty {
    constructor() {
        this.subscribers = new Set();
    }
    /**
     * Subscribe to the property.
     * @param subscribe - The subscriber to add.
     * @returns A function that unsubscribes the subscriber when called.
     */
    subscribe(subscribe) {
        this.subscribers.add(subscribe);
        return () => {
            this.subscribers.delete(subscribe);
        };
    }
    /**
     * @returns The value of the property.
     */
    value() {
        throw new Error("value() has not been overwritten. Ensure you have applied the bindProperty decorators.");
    }
}
/**
 * Bind a property to an ObservableProperty that has the same name, and notify observable's subscribers on change.
 * To use this decorator, you must have an "observable" object in the class that has a property with the same name as the property you want to bind.
 *
 * @param _ - undefined.
 * @param context - The class field decorator context.
 */
export function bindProperty(_, context) {
    const propKey = context.name.toString();
    context.addInitializer(function () {
        let currentValue = this[propKey];
        const observable = this["observable"];
        if (!observable) {
            throw Error(`Couldn't bind ${propKey}. Please add an "observable" object in the class ${this.constructor.name}.`);
        }
        const observableProp = observable[propKey];
        if (!observableProp || !(observableProp instanceof ObservableProperty)) {
            throw Error(`Couldn't bind ${propKey}. Either "${propKey}" doesn't exist in "observable", is not initialized, or is not of type ${ObservableProperty.name} in ${this.constructor.name}.`);
        }
        Object.defineProperty(observableProp, "value", {
            /**
             * @returns The value of the property, in the observable object.
             */
            get: () => {
                return () => {
                    return currentValue;
                };
            },
        });
        const subscribers = observableProp["subscribers"];
        Object.defineProperty(this, context.name, {
            /**
             * Set the value of the property, in the original object, and notify subscribers on change.
             * @param value - The new value of the property.
             */
            set: (value) => {
                currentValue = value;
                subscribers.forEach((subscriber) => {
                    subscriber(value);
                });
            },
            /**
             * @returns The value of the property, in the original object.
             */
            get: () => {
                return currentValue;
            },
        });
    });
}
