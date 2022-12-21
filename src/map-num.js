export default function mapNum(target, map, src, mapper) {
	if (typeof map == "string")
		map = mapNum.maps[map];

	if (!map || !target)
		return target;

	if (!Array.isArray(src))
		src = [src];

	if (typeof mapper == "function") {
		for (let i = 0, l = map.length; i < l; i++) {
			const num = src[i % src.length],
				key = map[i];

			if (typeof num == "number" && !isNaN(num))
				target[key] = mapper(num, target[key], key, target);
		}
	} else {
		for (let i = 0, l = map.length; i < l; i++) {
			const num = src[i % src.length];

			if (typeof num == "number" && !isNaN(num))
				target[map[i]] = num;
		}
	}

	return target;
}

mapNum.maps = {
	axes2d: ["x", "y"],
	axes3d: ["x", "y", "z"]
};