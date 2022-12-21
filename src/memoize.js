import { sym } from "./symbol";
import hasOwn from "./has-own";

const MEMOIZE_KEY = sym("memoize");

export default function memoize(func, ...args) {
	let key = "",
		argLen = args.length;

	while (argLen--) {
		const arg = args[argLen],
			type = typeof arg;

		switch (type) {
			case "function":
			case "symbol":
				return func(...args);
			default:
				if (arg !== null && type == "object")
					return func(...args);
				// only use the first character of the type to boost performance
				// the types that clash don't matter:
				// string - symbol: 	symbols can't be serialized reliably
				// boolean - bigint:	these have different serializations
				key += `${arg}@${type[0]}`;
		}
	}

	if (hasOwn(func, MEMOIZE_KEY)) {
		if (hasOwn(func[MEMOIZE_KEY], key))
			return func[MEMOIZE_KEY][key];
	} else
		func[MEMOIZE_KEY] = {};

	const val = func(...args);
	func[MEMOIZE_KEY][key] = val;
	return val;
}