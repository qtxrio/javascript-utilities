import getFunctionName from "./get-function-name";

export default function getConstructorName(obj) {
	if (obj == null)
		return null;

	return getFunctionName(obj.constructor);
}