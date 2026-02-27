const state = {};

export function bindStateBindings(bindingMap) {
    for (const [name, binding] of Object.entries(bindingMap)) {
        const getter = binding?.get;
        const setter = binding?.set;
        if (typeof getter !== "function" || typeof setter !== "function") {
            continue;
        }

        Object.defineProperty(state, name, {
            configurable: true,
            enumerable: true,
            get: getter,
            set: setter,
        });

        Object.defineProperty(globalThis, name, {
            configurable: true,
            enumerable: true,
            get: getter,
            set: setter,
        });
    }

    return state;
}

Object.defineProperty(globalThis, "state", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: state,
});

export default state;
