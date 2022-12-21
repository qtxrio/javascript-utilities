import {
	composeOptionsTemplates,
	createOptionsObject
} from "./internal/options";
import equals from "./equals";

const OPTIONS_TEMPLATES = composeOptionsTemplates({
	plain: true,
	deepEquality: true
});

export default function matchValue(val, matcher, options) {
	options = createOptionsObject(options, OPTIONS_TEMPLATES);

	if (val == null)
		return false;

	if (options.plain)
		return plainMatch(val, matcher, options);

	switch (typeof matcher) {
		case "function":
			return Boolean(matcher(val, options));
	}

	switch (matcher && matcher.constructor) {
		case RegExp:
			if (typeof val == "string")
				return matcher.test(val);
			break;
	}

	return plainMatch(val, matcher, options);
}

function plainMatch(val, matcher, options) {
	if (!options.deepEquality)
		return val === matcher;

	return equals(val, matcher);
}