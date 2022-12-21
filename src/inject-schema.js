import hasOwn from "./has-own";
import inject from "./inject";
import parsePropStr from "./parse-prop-str";
import getPropStrCombinations from "./get-prop-str-combinations";

// Based on inject.js, but before a value is set, any keys with
// the same core value are removed from the object.
// For instance, if a target object has a strict field, "xyz!",
// and the extender contains a lazy field, "xyz?", the contents
// of the strict field will be removed and transferred to "xyz?"

export default function injectSchema(target, extender, options) {
	return inject(target, extender, [
		options,
		{
			preInject(val, key, targ) {
				const baseKey = parsePropStr(key).key,
					combinations = getPropStrCombinations(baseKey);

				targ[key] = reduceCombinations(targ, baseKey, key, combinations);
			}
		}
	]);
}

function reduceCombinations(target, baseKey, key, combinations) {
	let collectedKey = null,
		collectedValue;

	for (let i = 0, l = combinations.length; i < l; i++) {
		const combination = combinations[i];

		if (hasOwn(target, combination)) {
			if (collectedKey)
				throw new Error(`Key '${baseKey}' has already been declared on this object (as '${collectedKey}')`);

			collectedKey = combination;
			collectedValue = target[combination];
			delete target[combination];
		}
	}

	return collectedValue;
}