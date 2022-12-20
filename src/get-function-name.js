const FUNC_NAME_FIND_REGEX = /function[\s\n]+([^(\s\n]+)/;

export default function getFunctionName(func) {
	if (typeof func != "function")
		return null;

	let name = func.name;

	if (typeof name == "string")
		return name;

	const stringified = String(func);

	if (stringified[0] == "[")
		return stringified.slice(8, -1);
	else {
		const ex = FUNC_NAME_FIND_REGEX.exec(stringified);
		if (ex)
			return ex[1];
	}

	return "";
}