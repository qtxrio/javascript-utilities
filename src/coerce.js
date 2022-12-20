import {
	isObj,
	isArrayLike,
	isArrResolvable
} from "./is";

function coerceObj(val, source) {
	return isObj(val) ?
		val :
		(isArrayLike(source) ? [] : {});
}

function coerceObjArrResolvable(val, source) {
	return isObj(val) ?
		val :
		(isArrResolvable(source) ? [] : {});
}

function coerceNum(num, def) {
	return typeof num == "number" && !isNaN(num) ?
		num :
		def;
}

export {
	coerceObj,
	coerceObjArrResolvable,
	coerceNum
};