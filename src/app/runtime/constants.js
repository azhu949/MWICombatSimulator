const constants = {};

export function bindConstants(constantMap) {
    for (const [name, value] of Object.entries(constantMap)) {
        Object.defineProperty(constants, name, {
            configurable: true,
            enumerable: true,
            writable: false,
            value,
        });

        Object.defineProperty(globalThis, name, {
            configurable: true,
            enumerable: true,
            get() {
                return value;
            },
            set() {},
        });
    }

    return constants;
}

Object.defineProperty(globalThis, "constants", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: constants,
});

export default constants;
