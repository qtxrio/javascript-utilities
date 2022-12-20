import {
	optionize,
	composeOptionsTemplates,
	createOptionsObject
} from "./internal/options";
import {
	VOID_TAGS,
	BOOLEAN_ATTRS,
	DOM_NAMESPACES
} from "./data/lookups";
import { CSS_PROPERTY_UNITS } from "./data/constants";
import {
	isObj,
	isObject,
	isLoopable,
	isPrimitive,
	isEmptyString,
	isTaggedTemplateArgs
} from "./is";
import {
	uid,
	castStr,
	splitClean,
	mkStrMatcher,
	compileTaggedTemplate
} from "./string";
import {
	genTypeStr,
	genValueTypeStr
} from "./typed-str";
import {
	sym,
	setSymbol
} from "./symbol";
import { assign } from "./object";
import { splitPath } from "./path";
import { stickyExec } from "./regex";
import { isFiniteNum } from "./number";
import get from "./get";
import casing from "./casing";
import hasOwn from "./has-own";
import forEach from "./for-each";
import parseStr from "./parse-str";
import serialize from "./serialize";
import concatMut from "./concat-mut";
import filterMut from "./filter-mut";
import matchType from "./match-type";
import parseEntityStr from "./parse-entity-str";

const NS_LEN = DOM_NAMESPACES.length,
	DEF_NS = "http://www.w3.org/1999/xhtml",
	PROP_KEYS_SYM = sym("prop keys");

function hasAncestor(elem, clsOrElem, maxDepth = Infinity) {
	const searchByClass = typeof clsOrElem == "string";

	while (true) {
		if (!elem || elem == document.documentElement)
			return false;

		if (searchByClass) {
			if (elem.classList && elem.classList.contains(clsOrElem))
				return true;
		} else if (elem == clsOrElem)
			return true;

		if (--maxDepth < 0)
			return false;

		elem = elem.parentNode;
	}
}

function hasAncestorBySelector(elem, selectorOrElem, maxDepth = Infinity) {
	const searchBySelector = typeof selectorOrElem == "string";

	while (true) {
		if (!elem || elem == document.documentElement)
			return false;

		if (searchBySelector) {
			if (elem.nodeType == Node.ELEMENT_NODE && elem.matches(selectorOrElem))
				return true;
		} else if (elem == selectorOrElem)
			return true;

		if (--maxDepth < 0)
			return false;

		elem = elem.parentNode;
	}
}

// The following functions work on attribute objects, which are virtual representations
// of HTML tag data. Functions that parse, process, or otherwise leverage attributes are
// recommeded to follow this schema for attribute data:
// {
//		class: TokenList,
//		data: TokenList,
//		style: TokenList,
//		events: TokenList,
//		...attrs	// Any number of attributes
// }
//
// where TokenLists follow this interface:
// {
//		list: <ListItem[]>{
//			key: string,
//			value: string
//		},
//		lookup: {
//			ListItem
//		}
// }
//
// The lookup map is referentially bound to the list
// and is used to set/update values

function mkAttrRepresentationObj(withValue = true) {
	return {
		class: mkClassList(withValue),
		style: mkStyleList(withValue),
		data: mkDatasetList(),
		events: mkEventList()
	};
}

function mkClassList(withValue = true) {
	const list = mkTokenList();
	list.isParsedClass = true;
	if (withValue)
		list.value = "";
	return list;
}

function mkStyleList(withValue = true) {
	const list = mkTokenList();
	list.isParsedStyle = true;
	if (withValue)
		list.value = "";
	return list;
}

function mkDatasetList() {
	const list = mkTokenList();
	list.isParsedDataset = true;
	return list;
}

function mkEventList() {
	const list = mkTokenList();
	list.isParsedEvents = true;
	return list;
}

function mkTokenList() {
	return {
		list: [],
		lookup: {},
		keys: [],
		map: {},
		isTokenList: true
	};
}

function appendToken(list, token, clone = false) {
	if (!token)
		return null;

	if (typeof token == "string") {
		token = {
			key: token,
			value: token
		};
	} else if (clone) {
		token = {
			key: token.key,
			value: token.value
		};
	}

	token.value = normalizeResolvedValue(token.value);

	if (token.key && token.value != null) {
		if (hasOwn(list.lookup, token.key)) {
			list.lookup[token.key].value = token.value;
			list.map[token.key] = token.value;

			if (typeof list.value == "string" && list.isParsedStyle) {
				if (list.lookup[token.key] == token.value)
					return token;

				let val = `${list.list[0].key}: ${list.list[0].value}`;

				for (let i = 1, l = list.list.length; i < l; i++)
					val += `; ${list.list[i].key}: ${list.list[i].value}`;

				list.value = val;
			}
		} else {
			list.lookup[token.key] = token;
			list.map[token.key] = token.value;
			list.list.push(token);
			list.keys.push(token.key);

			if (typeof list.value == "string") {
				if (list.isParsedStyle) {
					list.value += list.value ?
						`; ${token.key}: ${token.value}` :
						`${token.key}: ${token.value}`;
				} else if (list.isParsedClass) {
					list.value += list.value ?
						` ${token.key}` :
						`${token.key}`;
				}
			}
		}

		return token;
	}

	return null;
}

function removeToken(list, keyOrToken) {
	const key = typeof keyOrToken == "string" ?
		keyOrToken :
		keyOrToken && keyOrToken.key;

	if (typeof key != "string" || !hasOwn(list.lookup, key))
		return false;

	const evalValue = typeof list.value == "string";
	let offs = 0;

	if (evalValue)
		list.value = "";

	for (let i = 0, l = list.list.length; i < l; i++) {
		const token = list.list[i];
		let removed = false;

		if (!offs) {
			if (list.list[i].key == key) {
				offs = 1;
				removed = true;
			}
		} else {
			list.list[i - offs] = token;
			list.keys[i - offs] = token.key;
		}

		if (evalValue && !removed) {
			if (list.isParsedStyle) {
				list.value += list.value ?
					`; ${token.key}: ${token.value}` :
					`${token.key}: ${token.value}`;
			} else if (list.isParsedClass) {
				list.value += list.value ?
					` ${token.key}` :
					`${token.key}`;
			}
		}
	}

	delete list.lookup[key];
	delete list.map[key];
	list.list.length--;
	list.keys.length--;
	return true;
}

// Style
function parseStyle(style, allowFallthrough = false, withValue = true) {
	if (allowFallthrough && style && style.isParsedStyle)
		return style;

	return joinStl(style, null, withValue);
}

const STYLE_REGEX = /([a-z-]+)\s*:\s*([^;]+)\s*(?:;|$)/gi;

function parseStyleStr(list, str) {
	if (typeof str != "string")
		return list;

	while (true) {
		const ex = STYLE_REGEX.exec(str);
		if (!ex)
			break;

		appendToken(list, {
			key: casing(ex[1]).to.kebab,
			value: ex[2].trim()
		});
	}

	return list;
}

function joinStyle(...styles) {
	return joinStl(styles, null);
}

function joinStyleWithArgs(...styles) {
	return (...args) => joinStl(styles, args);
}

function extendStyle(stl, ...styles) {
	const list = parseStyle(stl, true);
	return joinStlHelper(list, styles);
}

function extendStyleWithArgs(stl, ...styles) {
	return (...args) => {
		const list = parseStyle(stl, true);
		return joinStlHelper(list, styles, args);
	};
}

function joinStl(styles, callArgs, withValue = true) {
	if (!Array.isArray(callArgs))
		callArgs = null;

	const list = mkStyleList(withValue);
	return joinStlHelper(list, styles, callArgs);
}

function joinStlHelper(list, style, callArgs) {
	if (typeof style == "function") {
		if (callArgs)
			style = style(...callArgs);
		else
			style = style();
	}

	if (style && style.isParsedStyle) {
		if (!list.value && typeof style.value != "string")
			delete list.value;

		for (let i = 0, l = style.list.length; i < l; i++)
			appendToken(list, style.list[i], true);
	} else if (Array.isArray(style)) {
		for (let i = 0, l = style.length; i < l; i++)
			joinStlHelper(list, style[i], callArgs);
	} else if (typeof style == "string")
		parseStyleStr(list, style);
	else if (isObject(style)) {
		for (const k in style) {
			if (!hasOwn(style, k))
				continue;

			let value = style[k],
				key = null;

			if (typeof value == "function") {
				if (callArgs)
					value = value(...callArgs);
				else
					value = value();
			}

			if (typeof value == "number") {
				key = casing(k).to.kebab;
				value = normalizeStyleProperty(key, value);

				if (!value)
					continue;
			} else if (Array.isArray(value)) {
				key = casing(k).to.kebab;
				let tmpVal = "";

				for (let i = 0, l = value.length; i < l; i++) {
					const v = normalizeStyleProperty(key, value[i]);
					if (!v)
						continue;

					tmpVal += tmpVal ?
						` ${v}` :
						v;
				}

				if (!tmpVal)
					continue;

				value = tmpVal;
			} else if (typeof value == "string") {
				key = casing(k).to.kebab;
				value = value.trim();
			} else
				continue;

			appendToken(list, {
				key,
				value
			});
		}
	}

	return list;
}

function normalizeStyleProperty(key, value) {
	if (typeof value != "number") {
		if (typeof value == "string")
			return value.trim();

		return null;
	}

	if (isNaN(value) || !isFinite(value))
		return null;

	if (hasOwn(CSS_PROPERTY_UNITS, key)) {
		const unit = CSS_PROPERTY_UNITS[key];

		if (unit == "%")
			return (value * 100) + "%";

		if (unit == "s")
			return value + unit;
		
		return value ?
			value + unit :
			String(value);
	}

	return String(value);
}

// Classes
function parseClass(cls, allowFallthrough = false, withValue = true) {
	if (allowFallthrough && cls && cls.isParsedClass)
		return cls;

	return joinCls(cls, null, "object", withValue);
}

function parseClassAsTokenList(cls, allowFallthrough = false, withValue = true) {
	if (allowFallthrough && cls && cls.isParsedClass)
		return cls;

	return joinCls(cls, null, "tokenlist", withValue);
}

function joinClass(...classes) {
	return joinCls(classes);
}

function joinClassAsArray(...classes) {
	return joinCls(classes, null, "array");
}

function joinClassAsTokenList(...classes) {
	return joinCls(classes, null, "tokenlist");
}

function joinClassWithArgs(...classes) {
	return (...args) => joinCls(classes, args);
}

function joinClassAsArrayWithArgs(...classes) {
	return (...args) => joinCls(classes, args, "array");
}

function joinClassAsTokenListWithArgs(...classes) {
	return (...args) => joinCls(classes, args, "tokenlist");
}

function extendClass(cls, ...classes) {
	const list = parseClassAsTokenList(cls, true);
	return joinClsHelper(list, classes);
}

function extendClassWithArgs(cls, ...classes) {
	return (...args) => {
		const list = parseClassAsTokenList(cls, true);
		return joinClsHelper(list, classes, args);
	};
}

function joinCls(classes, callArgs, returnType = "object", withValue = true) {
	if (!Array.isArray(callArgs))
		callArgs = null;

	const list = mkClassList(withValue);
	joinClsHelper(list, classes, callArgs);

	switch (returnType) {
		case "array":
			return list.keys;

		case "object":
			return list.map;

		case "tokenlist":
		default:
			return list;
	}
}

function joinClsHelper(list, cls, callArgs) {
	if (typeof cls == "function") {
		if (callArgs)
			cls = cls(...callArgs);
		else
			cls = cls();
	}

	if (cls && cls.isParsedClass) {
		if (!list.value && typeof cls.value != "string")
			delete list.value;

		for (let i = 0, l = cls.list.length; i < l; i++)
			appendToken(list, cls.list[i], true);
	} else if (Array.isArray(cls)) {
		for (let i = 0, l = cls.length; i < l; i++)
			joinClsHelper(list, cls[i], callArgs);
	} else if (typeof cls == "string") {
		const split = splitClean(cls, /\s+|\./);

		for (let i = 0, l = split.length; i < l; i++) {
			appendToken(list, {
				key: split[i],
				value: true
			});
		}
	} else if (cls != null && isPrimitive(cls)) {
		appendToken(list, {
			key: String(cls),
			value: true
		});
	} else if (isObject(cls)) {
		for (const k in cls) {
			if (!hasOwn(cls, k))
				continue;

			let val = cls[k];

			if (typeof val == "function") {
				if (callArgs)
					val = val(...callArgs);
				else
					val = val();
			}

			if (!val)
				continue;

			appendToken(list, {
				key: k,
				value: true
			});
		}
	}

	return list;
}

// Datasets
function parseDataset(ds, allowFallthrough = false) {
	if (allowFallthrough && ds && ds.isParsedDataset)
		return ds;

	return joinDatasets(ds);
}

function joinDatasets(...data) {
	const list = mkDatasetList();
	return joinDatasetsHelper(list, data);
}

function extendDataset(ds, ...data) {
	const list = parseDataset(ds, true);
	return joinDatasetsHelper(list, data);
}

function joinDatasetsHelper(list, data) {
	for (let i = 0, l = data.length; i < l; i++) {
		let d = data[i];

		if (d && d.isParsedDataset) {
			for (let j = 0, l2 = d.list.length; j < l2; j++)
				appendToken(list, d.list[j], true);
		} else if (Array.isArray(d))
			joinDatasetsHelper(list, d);
		else if (isObject(d)) {
			for (const k in d) {
				if (d[k] == null || !hasOwn(d, k))
					continue;

				appendToken(list, {
					key: k,
					value: d[k]
				});
			}
		} else {
			const key = castStr(d);

			if (key === null)
				continue;

			appendToken(list, {
				key,
				value: data[++i]
			});
		}
	}

	return list;
}

// Events
function parseEvents(evts, allowFallthrough = false) {
	if (allowFallthrough && evts && evts.isParsedEvents)
		return evts;

	return joinEvents(evts);
}

function joinEvents(...events) {
	const list = mkEventList();
	return joinEventsHelper(list, events);
}

function extendEvents(evts, ...events) {
	const list = parseEvents(evts, true);
	return joinEventsHelper(list, events);
}

function joinEventsHelper(list, events) {
	for (let i = 0, l = events.length; i < l; i++) {
		let evts = events[i];

		if (evts && evts.isParsedEvents) {
			for (let j = 0, l2 = evts.list.length; j < l2; j++)
				appendToken(list, evts.list[j], true);
		} else if (Array.isArray(evts))
			joinDatasetsHelper(list, evts);
		else if (isObject(evts)) {
			for (const k in evts) {
				if (!evts[k] || !hasOwn(evts, k))
					continue;

				appendToken(list, {
					key: k,
					value: evts[k]
				});
			}
		}
	}

	return list;
}

// General attributes
function joinAttributes(...attrs) {
	const outAttrs = mkAttrRepresentationObj();

	for (let i = 0, l = attrs.length; i < l; i++) {
		const src = attrs[i];

		for (let k in src) {
			if (!hasOwn(src, k))
				continue;

			switch (k) {
				case "style":
					outAttrs.style = joinStyle(outAttrs.style, src.style);
					break;

				case "class":
					outAttrs.class = joinClassAsTokenList(outAttrs.class, src.class);
					break;

				case "data":
					outAttrs.data = joinDatasets(outAttrs.data, src.data);
					break;

				default:
					if (k.indexOf("data-") == 0) {
						appendToken(outAttrs.data, {
							key: casing(k).from.data.to.camel,
							value: src[k]
						});
					} else if (k.indexOf("on") == 0) {
						appendToken(outAttrs.events, {
							key: k.substring(2),
							value: src[k]
						});
					} else
						outAttrs[k] = src[k];
			}
		}
	}

	return outAttrs;
}

function applyAttributes(node, args, callback, options = {}, native = false) {
	const resolve = value => {
		if (value && value.isDynamicValue)
			return resolveDynamicValue(value, args);

		return value;
	};

	if (typeof options.processAttributes == "function") {
		applyProcessAttributes(
			node,
			args,
			(key, value) => callback(
				key,
				resolve(value),
				null
			),
			options,
			native
		);
	} else if (node && node.isNode) {
		if (node.type == "element") {
			forEachAttribute(node, (value, key) => {
				callback(key, value, null);
			}, args);
		} else {
			forEachNodeAttribute(node, (value, key) => {
				callback(key, value, null);
			}, args, options);
		}
	} else {
		forEach(node.attributes, (value, key) => {
			if (native) {
				key = value.name;
				value = value.nodeValue;
			}
	
			callback(
				key,
				resolve(value),
				null
			);
		});
	}
}

function applyProcessAttributes(node, args, callback, options = {}, native = false) {
	const attributes = [],
		attributesMap = {},
		indexMap = {};

	forEachAttribute(node, (value, key) => {
		if (native) {
			key = value.name;
			value = value.nodeValue;
		}

		indexMap[key] = attributes.length;
		attributes.push([key, value]);
		attributesMap[key] = value;
	}, args);

	const set = (key, value) => {
		if (isObject(key)) {
			for (const k in key) {
				if (hasOwn(key, k))
					set(k, key[k]);
			}

			return;
		}

		if (!hasOwn(indexMap, key))
			indexMap[key] = attributes.length;

		attributes[indexMap[key]] = [key, value];
	};

	options.processAttributes({
		attributes: attributesMap,
		set,
		node
	});

	if (!callback)
		return;

	for (let i = 0, l = attributes.length; i < l; i++)
		callback(attributes[i][0], attributes[i][1], null);
}

function applyNodeAttributes(node, stack, args, callback, options = {}, native = false) {
	const pIdx = getParentTemplateIndex(stack),
		onTemplateNode = node.type == "template";

	if (pIdx == -1 && !onTemplateNode && (!node.attributes || !hasOwn(node.attributes, "props"))) {
		applyAttributes(node, args, callback, options, native);
		return null;
	}

	const nodes = [node];
	let idx = pIdx == -1 ?
		stack.length - 2 :
		pIdx;

	while (idx >= 0) {
		const n = stack[idx--];

		if (n.type == "template")
			nodes.push(n);
		else if (n.type != "fragment")
			break;
	}

	const attrs = {},
		used = {},
		coerced = {},
		keys = [],
		withProps = onTemplateNode && options.withProps,
		props = withProps ?
			{} :
			null;
	let propKeys = keys,
		keyMismatch = false;

	for (let i = 0, l = nodes.length; i < l; i++) {
		const n = nodes[i];

		applyAttributes(n, args, (key, value) => {
			const meta = n.metaOverride || n.meta;
			let propagate = true,
				val;

			for (let j = 0; j <= i; j++) {
				const m = nodes[j].metaOverride || nodes[j].meta;

				if (hasOwn(m.propsMap, key)) {
					if (!withProps)
						return;

					checkPropType(nodes[j], key, value, options);

					propagate = false;
					break;
				} else if (meta.options.terminalProps)
					return;
			}

			let exists = hasOwn(attrs, key);

			if (!exists) {
				val = coerceAttribute(key, value);

				if (val != value)
					coerced[key] = true;
			} else if (used[key] === true) {
				if (withProps)
					val = extendAttribute(key, props[key], value);
				else
					val = extendAttribute(key, attrs[key], value);
			} else {
				if (withProps) {
					const copy = hasOwn(coerced, key) ?
						props[key] :
						copyAttribute(key, props[key]);

					val = extendAttribute(
						key,
						copy,
						value
					);
				} else {
					const copy = hasOwn(coerced, key) ?
						attrs[key] :
						copyAttribute(key, attrs[key]);

					val = extendAttribute(
						key,
						copy,
						value
					);
				}

				used[key] = true;
			}

			if (propagate) {
				if (!exists) {
					used[key] = false;
					keys.push(key);
				}

				attrs[key] = val;
			} else
				keyMismatch = true;

			if (withProps) {
				if (!exists && keyMismatch) {
					if (propKeys == keys) {
						propKeys = keys.slice();

						if (!propagate)
							propKeys.push(key);
					} else if (!hasOwn(props, key))
						propKeys.push(key);
				}

				props[key] = val;
			}
		}, options, native);
	}

	if (props)
		setSymbol(props, PROP_KEYS_SYM, propKeys);

	if (!callback)
		return props;

	for (let i = 0, l = keys.length; i < l; i++)
		callback(keys[i], attrs[keys[i]], props);

	return props;
}

const COERCERS = {
	style: parseStyle,
	class: parseClassAsTokenList,
	data: parseDataset,
	events: parseEvents
};

function coerceAttribute(key, value) {
	switch (key) {
		case "style":
		case "class":
		case "data":
		case "events":
			return COERCERS[key](value, true);

		default:
			return value;
	}
}

const COPIERS = {
	style: joinStyle,
	class: joinClassAsTokenList,
	data: joinDatasets,
	events: joinEvents
};

function copyAttribute(key, value) {
	switch (key) {
		case "style":
		case "class":
		case "data":
		case "events":
			return COPIERS[key](value);

		default:
			return value;
	}
}

const EXTENDERS = {
	style: extendStyle,
	class: extendClass,
	data: extendDataset,
	events: extendEvents
};

function extendAttribute(key, target, extender) {
	switch (key) {
		case "style":
		case "class":
		case "data":
		case "events":
			return EXTENDERS[key](target, extender);

		default:
			return target;
	}
}

function forEachAttribute(node, callback, args = []) {
	const sAttrs = node.staticAttributes,
		dAttrs = node.dynamicAttributes;

	if (!sAttrs || !dAttrs || (!sAttrs.length && !dAttrs.length))
		return;

	if (hasOwn(node.attributes, "props")) {
		const props = resolveAttribute(node, "props", args);

		if (props && hasOwn(props, PROP_KEYS_SYM)) {
			const keys = props[PROP_KEYS_SYM];

			for (let i = 0, l = keys.length; i < l; i++)
				callback(props[keys[i]], keys[i], props);
		} else if (isObject(props)) {
			for (const k in props) {
				if (!hasOwn(props, k))
					continue;

				callback(
					normalizeValue(props[k]),
					k,
					props
				);
			}
		}
	}

	for (let i = 0, l = sAttrs.length; i < l; i++) {
		if (sAttrs[i] != "props")
			callback(node.attributes[sAttrs[i]], sAttrs[i], node.attributes);
	}

	for (let i = 0, l = dAttrs.length; i < l; i++) {
		if (dAttrs[i] == "props")
			continue;

		let value = node.attributes[dAttrs[i]];

		callback(
			normalizeValue(value, args),
			dAttrs[i],
			node.attributes
		);
	}
}

function forEachNodeAttribute(node, callback, args = [], options = {}) {
	const sigProps = (node.metaOverride || node.meta).sigProps;

	if (!sigProps.length)
		return forEachAttribute(node, callback, args);

	const used = {};

	forEachAttribute(node, (v, k, a) => {
		used[k] = true;
		callback(v, k, a);
	}, args);

	for (let i = 0, l = sigProps.length; i < l; i++) {
		const p = sigProps[i];

		if (hasOwn(used, p.key))
			continue;

		if (!p.hasDefault) {
			if (options.existenceErrorLevel == "warn")
				console.warn(`Existence check failed for prop '${p.key}': prop is not defined and does not provide a default value`);
			else if (options.existenceErrorLevel == "error")
				throw new TypeError(`Existence check failed for prop '${p.key}': prop is not defined and does not provide a default value`);
		}

		let def = p.default;

		if (typeof p.default == "function" && !p.matches(p.default))
			def = p.default(...args);

		if (!hasOwn(used, p.key))
			callback(def, p.key, node.attributes);
	}
}

function printClass(classes) {
	if (typeof classes == "string")
		return classes;

	let out = "";

	if (Array.isArray(classes))
		return classes.join(" ");
	else if (classes && classes.isParsedClass)
		out = classes.value || classes.keys.join(" ");
	else if (isObject(classes)) {
		let count = 0;

		for (const k in classes) {
			if (classes[k] && hasOwn(classes, k)) {
				if (count > 0)
					out += " ";

				out += k;
				count++;
			}
		}
	}

	return out;
}

function printStyle(style) {
	const parsed = parseStyle(style, true);

	if (typeof parsed.value == "string")
		return parsed.value;

	let out = "";

	for (let i = 0, l = style.list.length; i < l; i++) {
		const { key, value } = style.list[i];

		out += i > 0 ?
			`; ${key}: ${value}` :
			`${key}: ${value}`;
	}

	return out;
}

const GEN_OPTIONS_TEMPLATES = composeOptionsTemplates({
	raw: true,
	minified: true,
	comments: true,
	withProps: true,
	strictProps: true,
	// Error levels
	silent: {
		typeErrorLevel: "silent",
		existenceErrorLevel: "silent"
	},
	warn: {
		typeErrorLevel: "warn",
		existenceErrorLevel: "warn"
	},
	error: {
		typeErrorLevel: "error",
		existenceErrorLevel: "error"
	}
});

// Ugly but highly flexible DOM generator
// This utility supports the following inputs:
// 1.	object, object[]
//		Object representation of a node, as emitted by parsePugStr, etc
// 2.	Node, Node[]
//		Native Node DOM trees
function genDom(nodes, options = {}) {
	options = createOptionsObject(options, GEN_OPTIONS_TEMPLATES);

	let parserOptions;

	if (nodes instanceof Node && nodes.nodeType == Node.DOCUMENT_FRAGMENT_NODE)
		nodes = nodes.children;
	else if (nodes && nodes.isCompiledDomData) {
		parserOptions = nodes.options;
		nodes = [nodes.dom];
	} else if (!Array.isArray(nodes))
		nodes = [nodes];

	const raw = options.raw,
		root = raw ?
			"" :
			document.createDocumentFragment(),
		minified = typeof options.minified == "boolean" ?
			options.minified :
			false,
		comments = options.comments,
		withProps = options.withProps,
		indentStr = minified ?
			"" :
			(typeof options.indent == "string" ? options.indent : "\t"),
		processAttribute = typeof options.processAttribute == "function" ?
			options.processAttribute :
			null,
		processNode = typeof options.processNode == "function" ?
			options.processNode :
			null,
		processTag = typeof options.processTag == "function" ?
			options.processTag :
			null,
		processType = typeof options.processType == "function" ?
			options.processType :
			null,
		valueResolver = options.valueResolver || mkValueResolver();

	if (!nodes.length)
		return root;

	const useNativeNodes = nodes[0] instanceof Node;
	let str = "",
		args = options.args,
		stack = [];

	if (withProps) {
		if (Array.isArray(args))
			args = args.slice();
		else if (args == null)
			args = [];
		else
			args = [args];

		const props = {
			v: valueResolver
		};

		setSymbol(props, PROP_KEYS_SYM, []);
		args.push(props);
	}

	const getNodeData = precursor => {
		const node = precursor && precursor.isCompiledDomData ?
			precursor.dom :
			precursor;

		const tag = getTagName(node) || resolveTag(node, args);

		if (tag && tag.isCompiledDomData)
			return getNodeData(tag.dom);

		return {
			node,
			tag,
			type: getNodeType(node)
		};
	};

	const gen = (nds, parent, indent) => {
		if (!nds || !nds.length)
			return;

		stack.push(null);

		for (let i = 0, l = nds.length; i < l; i++) {
			if (!nds[i])
				continue;

			const breakStr = (!minified && str) ? "\n" : "";
			let { node, tag, type } = getNodeData(nds[i]);

			if (processNode) {
				node = processNode({
					node,
					sourceNode: node
				}) || node;
			}

			if (processTag) {
				tag = processTag({
					tag,
					sourceNode: node
				}) || tag;
			}

			if (processType) {
				type = processType({
					type,
					sourceNode: node
				}) || type;
			}

			if (type == "directive") {
				const childrenOrRunner = runDirective(node, args);
				stack.pop();

				if (Array.isArray(childrenOrRunner))
					gen(childrenOrRunner, parent, indent);
				else if (typeof childrenOrRunner == "function") {
					valueResolver.capture(node.label);

					childrenOrRunner((value, key) => {
						valueResolver.update(key, value);
						gen(node.children, parent, indent);
					});

					valueResolver.release(node.label);
				}

				stack.push(null);
				continue;
			}

			stack[stack.length - 1] = node;

			if (type == "fragment" || type == "template") {
				const children = useNativeNodes ?
					node.childNodes :
					resolveChildren(node, args);

				if (!children || !children.length) {
					if (node.type == "template")
						node.metaOverride = null;
					continue;
				}

				let currentStack,
					props,
					currentProps,
					childrenTemplate,
					currentChildrenTemplate;

				if (node.isChildrenTemplate) {
					currentStack = stack;
					stack = [currentStack[currentStack.length - 2]];
					props = node.cache.props || {};
				} else if (options.withProps && node.type == "template") {
					const resolved = resolveAttributesAndProps(
						node,
						stack,
						args,
						options,
						useNativeNodes
					);

					childrenTemplate = resolveChildrenTemplate(node, stack, resolved);
					props = resolved.props;
				}

				if (props) {
					props.v = valueResolver;
					currentChildrenTemplate = props.children;
					if (childrenTemplate)
						props.children = childrenTemplate;
					else
						delete props.children;

					currentProps = args[args.length - 1];
					args[args.length - 1] = props;
				}

				gen(children, parent, indent);

				if (currentStack)
					stack = currentStack;

				if (props) {
					if (currentChildrenTemplate)
						props.children = currentChildrenTemplate;
					else
						delete props.children;

					args[args.length - 1] = currentProps;

					if (node.type == "template")
						node.metaOverride = null;
				}

				continue;
			}

			if (type == "comment") {
				if (!comments || (raw && minified))
					continue;

				const content = useNativeNodes ?
					node.textContent :
					resolveTextContent(node, args).trim();

				if (raw)
					str += `${breakStr}${indent}<!-- ${content} -->`;
				else
					parent.appendChild(document.createComment(content));

				continue;
			}

			if (raw)
				str += breakStr;

			if (type == "text" || type == null) {
				let content;

				if (type == null) {
					if (typeof node == "string")
						content = node;
					else if (isPrimitive(node) && typeof node != "symbol")
						content = String(node);
					else
						content = serialize(node, parserOptions, args);

					if (!parserOptions || !parserOptions.preserveEntities)
						content = parseEntityStr(content);
				} else if (useNativeNodes)
					content = node.textContent;
				else if (node.content && node.content.isDynamicValue)
					content = resolveTextContent(node, args);
				else if (parserOptions && parserOptions.preserveEntities)
					content = node.content;
				else
					content = parseEntityStr(node.content);

				if (raw) {
					if (minified && i > 0 && getNodeType(nds[i - 1]) == "text")
						str += "\n";

					str += indent + content;
				} else
					parent.appendChild(document.createTextNode(content));

				continue;
			}

			const {
				attributes,
				props
			} = resolveAttributesAndProps(
				node,
				stack,
				args,
				options,
				useNativeNodes
			);

			let currentProps,
				targetNode;

			if (props) {
				currentProps = args[args.length - 1];
				args[args.length - 1] = props;
			}

			if (raw)
				str += `${indent}<${tag}`;
			else {
				if (useNativeNodes)
					targetNode = document.createElementNS(node.namespaceURI, tag);
				else
					targetNode = document.createElementNS(node.namespace || DEF_NS, tag);
			}

			for (let i = 0, l = attributes.length; i < l; i++) {
				const { key, value } = attributes[i];

				switch (key) {
					case "style":
						setAttr(key, printStyle(value) || null, value, node, targetNode);
						break;

					case "class":
						setAttr(key, printClass(value) || null, value, node, targetNode);
						break;

					case "data":
						if (value && value.isParsedDataset) {
							for (let j = 0, l2 = value.list.length; j < l2; j++) {
								const token = value.list[j];
								setAttr(casing(token.key).to.data, token.value, value, node, targetNode);
							}
						} else {
							for (const k2 in value) {
								if (hasOwn(value, k2))
									setAttr(casing(k2).to.data, value[k2], value, node, targetNode);
							}
						}
						break;

					case "events":
						break;

					default:
						setAttr(key, value, value, node, targetNode);
				}
			}

			if (raw)
				str += ">";

			if (!node.void && (!useNativeNodes || !getTagProperties(node).void)) {
				const children = useNativeNodes ?
					node.childNodes :
					node.children;

				if (children && children.length) {
					gen(children, targetNode, indent + indentStr);

					if (!minified && raw)
						str += `\n${indent}`;
				}

				if (raw)
					str += `</${tag}>`;
			}

			if (!raw)
				parent.appendChild(targetNode);

			if (props)
				args[args.length - 1] = currentProps;
		}

		stack.pop();
	};

	const setAttr = (key, value, rawValue, node, targetNode) => {
		if (value && value.isDynamicValue)
			value = resolveAttribute(node, key, args);

		if (processAttribute) {
			value = processAttribute({
				key,
				value,
				rawValue,
				node
			});
		}

		const isBooleanAttr = BOOLEAN_ATTRS.has(key);

		if (value == null || (isBooleanAttr && value == false))
			return;

		if (isBooleanAttr)
			value = "";
		else
			value = String(value);

		if (raw) {
			if (!value)
				str += ` ${key}`;
			else
				str += ` ${key}="${value}"`;
		} else
			targetNode.setAttribute(key, value);
	};

	gen(nodes, root, "");

	if (raw)
		return str;

	if (root.childNodes.length == 1)
		return root.firstChild;

	return root;
}

function serializeDom(nodes, options = {}) {
	return genDom(nodes, ["raw|minified", options]);
}

// A DOM capsule is an enclosed system comprised of a template parser
// and a DOM renderer which provides a runtime used for both parsing
// and rendering. Primarily, this is a one-time process, that is,
// it provides no reactivity for the rendered components
function mkDomCapsuleConstructor(parser, renderer, options = null) {
	// compile|lazy|eagerDynamic|eagerTemplates
	// args: {}, raw: true, withProps: true

	const getOptions = opts => {
		const po = opts && hasOwn(opts, "parseOptions") ?
			opts.parseOptions :
				null,
			ro = opts && hasOwn(opts, "renderOptions") ?
				opts.renderOptions :
				null;

		if (!po && !ro) {
			return {
				po: null,
				ro: opts
			};
		}

		return {
			po,
			ro
		};
	};

	const capsule = (...args) => {
		const opts = capsule.extractOptions(),
			{ po: pOptions, ro: rOptions } = getOptions(options),
			{ po: pOptions2, ro: rOptions2 } = getOptions(opts);

		/*const entry = 

		if (isTaggedTemplateArgs(args)) {
			
		}*/

		console.log(opts);
	};

	optionize(capsule);
	return capsule;
}

function runDirective(node, args) {
	switch (node.directiveType) {
		case "if": {
			const contents = node.contents;

			for (let i = 0, l = contents.length; i < l; i++) {
				const c = contents[i];
				
				if (!c.condition || resolveDomValue(c.condition, args))
					return c.children;
			}
			break;
		}

		case "switch": {
			const compareVal = resolveDomValue(node.expression, args),
				cases = node.cases;

			for (let i = 0, l = cases.length; i < l; i++) {
				const c = cases[i];

				if (c.hasDefault)
					return c.children;

				for (let j = 0, l2 = c.values.length; j < l2; j++) {
					if (resolveDomValue(c.values[j], args) === compareVal)
						return c.children;
				}
			}
			break;
		}

		case "range":
			return mkRangeRunner(node, args);

		case "iterator":
			return mkIteratorRunner(node, args);
	}

	return null;
}

function mkRangeRunner(node, args) {
	const from = resolveDomValue(node.range[0], args),
		to = resolveDomValue(node.range[1], args);

	if (!isFiniteNum(from) || !isFiniteNum(to))
		return _ => false;

	if (from == to) {
		return callback => {
			callback(from, 0);
			return true;
		};
	}

	if (from % 1 || to % 1) {
		return callback => {
			callback(from, 0);
			callback(to, 1);
			return true;
		};
	}

	const delta = from > to ?
		-1 :
		1;

	return callback => {
		let v = from,
			idx = 0;

		while (true) {
			callback(v, idx++);
			if (v == to)
				break;
			v += delta;
		}

		return true;
	};
}

function mkIteratorRunner(node, args) {
	const value = resolveDomValue(node.iterator, args);

	if (!isLoopable(value))
		return _ => false;

	return callback => {
		forEach(value, callback);
		return true;
	};
}

function mkValueResolver() {
	const resolver = (...args) => {
		const scope = resolver.currentScope;
		let accessor,
			def;

		if (isTaggedTemplateArgs(args))
			accessor = compileTaggedTemplate(...args);
		else if (typeof args[0] == "string" || Array.isArray(args[0])) {
			accessor = args[0];
			def = args[1];
		}

		if (!accessor) {
			if (scope.name)
				return resolver.values.scoped[scope.name];

			return resolver.values.default;
		}

		accessor = splitPath(accessor);

		if (hasOwn(resolver.values.scoped, accessor[0]))
			return get(resolver.values.scoped, accessor, def);

		return get(resolver.values.default, accessor, def);
	};

	resolver.clear = _ => {
		resolver.key = null;
		resolver.values = {
			scoped: {},
			default: null
		};
		resolver.cache = {
			scoped: {},
			default: []
		};
		resolver.currentScope = {
			name: null,
			key: null,
			value: null
		};
		resolver.stack = [];
		resolver.isValueResolver = true;
		return resolver;
	};

	resolver.update = (key, value) => {
		const scope = resolver.currentScope;

		if (scope.name)
			resolver.values.scoped[scope.name] = value;
		else
			resolver.values.default = value;

		resolver.key = key;
		scope.key = key;
		scope.value = value;
		return resolver;
	};

	resolver.capture = label => {
		const scope = {
			name: label,
			key: null,
			value: null
		};

		if (label) {
			if (!hasOwn(resolver.cache.scoped, label))
				resolver.cache.scoped[label] = [];

			resolver.cache.scoped[label].push(scope);
		} else
			resolver.cache.default.push(scope);

		resolver.key = null;
		resolver.value = null;
		resolver.currentScope = scope;
		resolver.stack.push(scope);
		return resolver;
	};

	resolver.release = label => {
		let scope = null;

		if (label) {
			if (hasOwn(resolver.cache.scoped, label))
				scope = resolver.cache.scoped[label].pop();
		} else
			scope = resolver.cache.default.pop();

		if (scope) {
			if (label)
				resolver.values.scoped[label] = scope.value;
			else
				resolver.values.default = scope.value;
		}

		resolver.stack.pop();
		const tail = resolver.stack[resolver.stack.length - 1];

		if (tail) {
			resolver.key = tail.key;
			resolver.currentScope = tail;
		} else {
			resolver.key = null;
			resolver.currentScope = {
				name: null,
				key: null,
				value: null
			};
		}

		return resolver;
	};

	resolver.clear();
	return resolver;
}

function getTagProperties(tag) {
	if (tag instanceof Node)
		tag = getTagName(tag);

	let props = {
		tag,
		void: VOID_TAGS.has(tag),
		namespace: DEF_NS
	};

	for (let i = 0; i < NS_LEN; i++) {
		let nsi = DOM_NAMESPACES[i];

		if (nsi.tags.has(tag)) {
			props.tag = nsi.tagGetter(tag);
			props.namespace = nsi.uri;
			break;
		}
	}

	return props;
}

function getNodeType(node) {
	if (node instanceof Node) {
		switch (node.nodeType) {
			case Node.ELEMENT_NODE: return "element";
			case Node.TEXT_NODE: return "text";
			case Node.CDATA_SECTION_NODE: return "cdata";
			case Node.PROCESSING_INSTRUCTION_NODE: return "processing-instruction";
			case Node.COMMENT_NODE: return "comment";
			case Node.DOCUMENT_NODE: return "document";
			case Node.DOCUMENT_TYPE_NODE: return "doctype";
			case Node.DOCUMENT_FRAGMENT_NODE: return "fragment";
			default: return null;
		}
	} else if (node && typeof node.type == "string")
		return node.type;

	return null;
}

function getTagName(node) {
	if (node instanceof Element) {
		if (node.namespaceURI == DEF_NS)
			return node.tagName.toLowerCase();

		return node.tagName;
	} else if (node && typeof node.tag == "string")
		return node.tag;

	return null;
}

function getParentTemplate(stack) {
	let idx = stack.length - 1;

	while (--idx >= 0) {
		const n = stack[idx];

		if (n.type == "template")
			return n;
		if (n.type != "fragment" && n.type != "directive")
			return null;
	}

	return null;
}

function getParentTemplateIndex(stack) {
	let idx = stack.length - 1;

	while (--idx >= 0) {
		const n = stack[idx];

		if (n.type == "template")
			return idx;
		if (n.type != "fragment" && n.type != "directive")
			return -1;
	}

	return -1;
}

function getEnclosingParentTemplate(stack) {
	let idx = stack.length - 1;

	while (--idx >= 0) {
		if (stack[idx].type == "template")
			return stack[idx];
	}

	return null;
}

function getEnclosingParentTemplateIndex(stack) {
	let idx = stack.length - 1;

	while (--idx >= 0) {
		if (stack[idx].type == "template")
			return idx;
	}

	return -1;
}

function hasInheritableData(node, parent) {
	if (!parent || !parent.cache)
		return false;

	return Boolean(
		parent.cache.props &&
		!node.staticAttributes.length &&
		!node.dynamicAttributes.length &&
		(
			node.meta == parent.metaOverride ||
			node.metaOverride == parent.metaOverride ||
			node.meta == parent.meta
		)
	);
}

// VDOM utilities
// Capturing groups:
// 1: key
// 2: value
// 3: string quote character
const ATTR_SPLIT_REGEX = /([^\s=]+)(?:\s*=\s*((["'`])(?:[^\\]|\\.)*?\3|[^"'`\s]+))?/g,
	REF_REGEX = /ref_[a-zA-Z0-9]{15}/g,
	DEFAULT_TAGS = {
		comment: "#comment",
		text: "#text",
		fragment: "#document-fragment",
		element: "div"
	},
	DEF_ATTR_PREFIX_MATCHER = mkStrMatcher({
		on: key => [
			"event-item",
			key.substring(2)
		],
		"data-": key => [
			"data-item",
			casing(key).from.data.to.camel
		]
	});

function mkVNode(type, data) {
	const nodeData = {
		id: uid(),
		type,
		raw: "",
		tag: null,
		parent: null,
		isNode: true
	};

	if (type == "element") {
		nodeData.namespace = DEF_NS;
		nodeData.void = false;
	}

	const node = assign(nodeData, data);
	node.tag = node.tag || DEFAULT_TAGS[type];
	return node;
}

function addAttributeData(node) {
	node.attributes = mkAttrRepresentationObj();
	node.staticAttributes = [];
	node.dynamicAttributes = [];
	node.dynamicAttributesMap = {};
	return node;
}

// Extend dynamic value with data
const DV_EXTENDERS = {
	default: (dv, data) => dv,
	literal: (dv, data) => dv.data = data,
	stringbuilder: (dv, data) => concatMut(dv.data, data),
	entitystringbuilder: (dv, data) => {
		for (let i = 0, l = data.length; i < l; i++) {
			if (typeof data[i] == "string")
				dv.data.push(parseEntityStr(data[i]));
			else
				dv.data.push(data[i]);
		}
	},
	ordered: (dv, data) => {
		concatMut(dv.data, data);
		return dv;
	},
	partitioned: (dv, data) => {
		const d = Array.isArray(data) ?
			data :
			[data];

		for (let i = 0, l = d.length; i < l; i++) {
			const item = d[i];

			if (item && item.isDynamicValue)
				dv.dynamic.push(item);
			else
				dv.static.push(item);
		}

		return dv;
	},
	tokenlist: (dv, data) => {
		const jn = dv.joiner || dv.merger;
		let staticTokens = [],
			dynamicTokens = [];

		if (Array.isArray(data)) {
			for (let i = 0, l = data.length; i < l; i++) {
				if (typeof data[i] == "function")
					dynamicTokens.push(data[i]);
				else
					staticTokens.push(data[i]);
			}
		} else if (data && data.isTokenList)
			staticTokens.push(data);
		else if (isObject(data) && (data.static || data.dynamic)) {
			staticTokens = data.static || staticTokens;
			dynamicTokens = data.dynamic || dynamicTokens;
		} else if (typeof data == "function")
			dynamicTokens.push(data);
		else
			staticTokens.push(data);

		if (staticTokens.length)
			dv.staticTokens = jn(dv.staticTokens, ...staticTokens);
		if (dynamicTokens.length)
			concatMut(dv.dynamicTokens, dynamicTokens);
	}
};

// Merge dynamic value with other dynamic value
const DV_MERGERS = {
	default: (dv, dv2) => dv,
	literal: (dv, dv2) => dv.data = dv2.data,
	stringbuilder: (dv, dv2) => concatMut(dv.data, dv2.data),
	entitystringbuilder: (dv, dv2) => {
		for (let i = 0, l = dv2.data.length; i < l; i++) {
			const d = dv2.data[i];
			if (typeof d == "string")
				dv.data.push(parseEntityStr(d));
			else
				dv.data.push(d);
		}
	},
	ordered: (dv, dv2) => {
		concatMut(dv.data, dv2.data);
		return dv;
	},
	partitioned: (dv, dv2) => {
		concatMut(dv.dynamic, dv2.dynamic);
		concatMut(dv.static, dv2.static);
		return dv;
	},
	tokenlist: (dv, dv2) => {
		const mrg = dv.merger || dv.joiner;
		dv.staticTokens = mrg(dv.staticTokens, dv2.staticTokens);
		concatMut(dv.dynamicTokens, dv2.dynamicTokens);
		return dv;
	}
};

// Extract data from dynamic value
const DV_EXTRACTORS = {
	default: dv => dv,
	literal: (dv, args) => {
		if (typeof dv.data == "function")
			return dv.data(...args);

		return dv.data;
	},
	stringbuilder: (dv, args) => {
		const d = dv.data;
		let out = "";

		for (let i = 0, l = d.length; i < l; i++) {
			let val = d[i];

			if (typeof val == "function")
				val = val(...args);

			if (typeof val == "string")
				out += val;
			else if (isPrimitive(val) && typeof val != "symbol")
				out += String(val);
			else
				out += serialize(val, dv.meta.options, args);
		}

		return out;
	},
	entitystringbuilder: (dv, args) => {
		const d = dv.data;
		let out = "";

		for (let i = 0, l = d.length; i < l; i++) {
			let val = d[i];

			if (typeof val == "string") {
				out += val;
				continue;
			}

			if (typeof val == "function")
				val = val(...args);

			if (typeof val == "string")
				out += parseEntityStr(val);
			else if (isPrimitive(val) && typeof val != "symbol")
				out += String(val);
			else
				out += parseEntityStr(serialize(val, dv.meta.options, args));
		}

		return out;
	},
	ordered: dv => dv.data,
	partitioned: dv => dv.dynamic.concat(dv.static),
	tokenlist: (dv, args) => {
		const extr = dv.extractor || dv.joiner || dv.merger,
			resolvedTokens = [];

		for (let i = 0, l = dv.dynamicTokens.length; i < l; i++) {
			const val = normalizeValue(
				dv.dynamicTokens[i](...args),
				args
			);

			if (Array.isArray(val)) {
				for (let j = 0, l2 = val.length; j < l2; j++)
					resolvedTokens.push(normalizeValue(val[j], args));
			} else if (val != null)
				resolvedTokens.push(val);
		}

		return extr(dv.staticTokens, ...resolvedTokens);
	}
};

// Create dynamic value resolver object with associated helper methods
// Takes an optional "value" field, which is fed into the assigned
// extender method on init
function mkDynamicValue(dv, meta = null) {
	dv.type = dv.type || "partitioned";
	dv.extend = dv.extend || DV_EXTENDERS[dv.type] || DV_EXTENDERS.default;
	dv.merge = dv.merge || DV_MERGERS[dv.type] || DV_MERGERS.default;
	dv.extract = dv.extract || DV_EXTRACTORS[dv.type] || DV_EXTRACTORS.default;
	dv.meta = meta || {
		options: null
	};
	dv.isDynamicValue = true;

	switch (dv.type) {
		case "literal":
			dv.data = dv.data || null;
			break;

		case "stringbuilder":
		case "entitystringbuilder":
		case "ordered":
			dv.data = dv.data || [];
			break;

		case "partitioned":
			dv.dynamic = dv.dynamic || [];
			dv.static = dv.static || [];
			break;

		case "tokenlist":
			dv.staticTokens = dv.staticTokens || mkTokenList();
			dv.dynamicTokens = dv.dynamicTokens || [];
			break;
	}

	if (dv.value) {
		extendDynamicValue(dv, dv.value);
		delete dv.value;
	}

	return dv;
}

function extendDynamicValue(dv, data) {
	return dv.extend(dv, data);
}

function mergeDynamicValue(dv, dv2) {
	return dv.merge(dv, dv2);
}

function normalizeValue(value, args) {
	let val = value;

	if (val && val.isDynamicValue)
		val = val.extract(val, args);
	else if (typeof val == "function") {
		if (val.isValueResolver)
			return val();
		
		val = val(...args);
	}

	if (typeof val == "function" && val.isValueResolver)
		return val();

	return val;
}

function normalizeResolvedValue(value, args) {
	if (typeof value == "function" && value.isValueResolver)
		return value();

	return value;
}

function resolveDynamicValue(dv, args = []) {
	if (!Array.isArray(args))
		args = [args];

	return normalizeValue(dv, args);
}

function resolveDomValue(value, args) {
	if (typeof value == "string")
		return parseStr(value);
	if (typeof value == "function") {
		if (!args)
			return value();
		if (!Array.isArray(args))
			return value(args);
		return value(...args);
	}

	if (value && value.isDynamicValue)
		return resolveDynamicValue(value, args);

	return value;
}

function resolveAttribute(node, key, args = []) {
	if (!Array.isArray(args))
		args = [args];

	return normalizeValue(node.attributes[key], args);
}

function resolveAttributes(node, args = []) {
	if (!Array.isArray(args))
		args = [args];

	const out = {
			attributes: {},
			staticAttributes: [],
			dynamicAttributes: []
		},
		sAttrs = node.staticAttributes,
		dAttrs = node.dynamicAttributes;

	for (let i = 0, l = sAttrs.length; i < l; i++) {
		const attr = normalizeValue(node.attributes[sAttrs[i]], args);
		out.attributes[sAttrs[i]] = attr;
		out.staticAttributes.push(sAttrs[i]);
	}

	for (let i = 0, l = dAttrs.length; i < l; i++) {
		const attr = normalizeValue(node.attributes[dAttrs[i]], args);
		out.attributes[dAttrs[i]] = attr;
		out.dynamicAttributes.push(dAttrs[i]);
	}

	return out;
}

function resolveTextContent(node, args = []) {
	if (!Array.isArray(args))
		args = [args];

	switch (node && node.type) {
		case "text":
		case "comment":
			return normalizeValue(node.content, args);

		case "element": {
			let out = "";

			for (let i = 0, l = node.children.length; i < l; i++)
				out += resolveTextContent(node.children[i], args);

			return out;
		}
	}

	return "";
}

function resolveTag(node, args = []) {
	if (!Array.isArray(args))
		args = [args];

	return normalizeValue(node.tag, args);
}

function resolveChildren(node, args = []) {
	if (!Array.isArray(args))
		args = [args];

	let children = node.children;

	if (children && children.isDynamicValue) {
		children = resolveDynamicValue(children, args);

		if (children && children.isCompiledDomData) {
			if (node.type == "template")
				node.metaOverride = children.meta;

			children = children.dom;
		}
	}

	if (children == null)
		return [];

	if (!Array.isArray(children))
		children = [children];

	return children;
}

function resolveChildrenTemplate(node, stack) {
	if (!node.commonChildren || !node.commonChildren.length)
		return null;

	const mk = node.meta.options.mkVNode || mkVNode,
		parent = getEnclosingParentTemplate(stack);

	const template = mk("template", {
		meta: node.meta,
		raw: "",
		parent: node,
		children: mkDynamicValue({
			type: "literal",
			data: _ => node.commonChildren
		}, ctx(node, "children")("literal")),
		commonChildren: [],
		tag: "#template",
		static: false,
		tagData: null,
		attrData: null,
		cache: (parent && parent.cache) || {},
		metaOverride: null,
		isChildrenTemplate: true
	});

	addAttributeData(template);

	return template;
}

function resolveAttributesAndProps(node, stack, args, options, native = false) {
	const parent = getParentTemplate(stack);

	if (hasInheritableData(node, parent)) {
		if (node.type == "template" && node.cache) {
			node.cache.attributes = parent.cache.attributes;
			node.cache.props = parent.cache.props;
		}

		return {
			attributes: parent.cache.attributes,
			props: parent.cache.props
		};
	}

	const out = {
		attributes: [],
		props: null
	};

	out.props = applyNodeAttributes(node, stack, args, (key, value) => {
		out.attributes.push({
			key,
			value
		});
	}, options, native);

	if (node.type == "template" && node.cache) {
		node.cache.attributes = out.attributes;
		node.cache.props = out.props;
	}

	return out;
}

function resolveProps(node, args, strict = false) {
	const nodeProps = node.meta.props,
		nodePropsMap = node.meta.propsMap,
		props = {};

	const append = (key, value) => {
		const attr = normalizeValue(value, args);

		if (hasOwn(nodePropsMap, key)) {
			const extracted = extractProp(nodePropsMap[key], attr, args);

			if (!extracted.valid && strict)
				console.error(`Invalid type for prop '${key}': expected ${genTypeStr(nodePropsMap[key].type)}`);

			props[key] = extracted.value;
		} else
			props[key] = value;
	};

	forEachAttribute(
		node,
		(value, key) => append(key, value),
		args
	);

	for (let i = 0, l = nodeProps.length; i < l; i++) {
		const p = nodeProps[i];
		if (hasOwn(props, p.key))
			continue;

		if (typeof p.default == "function" && !p.matches(p.default))
			props[p.key] = p.default(...args);
		else
			props[p.key] = p.default;
	}

	return props;
}

function extractProp(propData, value, args) {
	if (propData.matches(value)) {
		return {
			valid: true,
			value
		};
	}

	let def = propData.default;

	if (typeof def == "function" && !propData.matches(def))
		def = def(...args);

	if (propData.matches(def)) {
		return {
			valid: true,
			value: def
		};
	}

	return {
		valid: !propData.required,
		value: def
	};
}

function checkPropType(node, key, value, options = {}) {
	const meta = node.metaOverride || node.meta;

	if (!hasOwn(meta.propsMap, key))
		return true;

	const propData = meta.propsMap[key];

	if (propData.matches(value))
		return true;

	if (options.typeErrorLevel == "warn")
		console.warn(`Type check failed for prop '${key}': expected ${genTypeStr(propData.type)}; got ${genValueTypeStr(value)}`);
	else if (options.typeErrorLevel == "error")
		throw new TypeError(`Type check failed for prop '${key}': expected ${genTypeStr(propData.type)}; got ${genValueTypeStr(value)}`);

	return false;
}

function isDynamicValueCandidate(value, meta = null) {
	switch (typeof value) {
		case "object":
			return value !== null && !meta.options.lazyDynamic;

		case "function":
			return true;
	}

	return false;
}

function setAttribute(node, key, value) {
	const attrs = node.attributes,
		attr = attrs[key];

	if (BOOLEAN_ATTRS.has(key) && value === false)
		return;

	if (value && value.isDynamicValue) {
		if (hasOwn(node.dynamicAttributesMap, key))
			mergeDynamicValue(attr, value);
		else {
			node.static = false;
			node.dynamicAttributes.push(key);
			node.dynamicAttributesMap[key] = value;
			if (hasOwn(attrs, key))
				extendDynamicValue(value, attr);
			attrs[key] = value;
		}
	} else if (attr && attr.isDynamicValue)
		extendDynamicValue(attr, value);
	else {
		const listLen = attr && attr.isTokenList && attr.list.length;
		if (!hasOwn(attrs, key))
			node.staticAttributes.push(key);

		if (Array.isArray(attr))
			concatMut(attr, value);
		else if (attr && attr.isTokenList) {
			if (attr.isParsedStyle)
				extendStyle(attr, value);
			else if (attr.isParsedClass)
				extendClass(attr, value);
			else if (attr.isParsedDataset)
				extendDataset(attr, value);
			else if (attr.isParsedEvents)
				extendEvents(attr, value);
		} else if (isObject(attr) && isObject(value))
			assign(attr, value);
		else
			attrs[key] = value;

		if (listLen == 0 && attrs[key] && attrs[key].isTokenList && attrs[key].list.length)
			node.staticAttributes.push(key);
	}
}

function setTextContent(node, text, meta = null) {
	text = text || "";
	const options = (meta && meta.options) || {};
	let content;

	if (!options.preserveNewlines)
		text = text.replace(/^[\n\r]+|[\n\r]+$/g, "");

	if (!meta || !meta.refKeys || !meta.refKeys.length) {
		content = options.preserveEntities ?
			text :
			parseEntityStr(text);
	} else {
		const textType = options.preserveEntities ? "string" : "entitystring";
		content = resolveInlineRefs(text, meta, ctx(node, "content")(textType));
	}

	node.content = content;
	node.static = !content || !content.isDynamicValue;
}

function parseAttributes(node, meta = null) {
	if (!node.attrData)
		return;

	while (true) {
		const ex = ATTR_SPLIT_REGEX.exec(node.attrData);
		if (!ex)
			break;

		const value = ex[2] === undefined ?
			true :
			parseStr(ex[2]);

		const {
			type,
			key,
			matched,
			context
		} = resolveAttributeMeta(ex[1], meta);

		if (type == "style") {
			setAttribute(
				node,
				"style",
				resolveInlineRefs(value, meta, ctx(node, "attribute", "style"))
			);
		} else if (type == "class") {
			setAttribute(
				node,
				"class",
				meta ?
					resolveInlineRefs(value, meta, ctx(node, "attribute", "class")) :
					String(value).terms(/\s+/g)
			);
		} else if (type == "data") {
			if (meta) {
				const obj = resolveInlineRefs(value, meta, ctx(node, "attribute", "data"));
				if (isObject(obj))
					setAttribute(node, "data", obj);
			} else
				setAttribute(node, key, value);
		} else if (type == "data-item" && matched) {
			const ref = resolveInlineRefs(value, meta, ctx(node, "attribute", "data")("data-item"));

			if (ref && ref.isDynamicValue) {
				const value = ref.data;
				let resolver;

				if (typeof value == "function") {
					resolver = (...args) => ({
						[key]: value(...args)
					});
				} else {
					resolver = _ => ({
						[key]: value
					});
				}

				setAttribute(node, "data", mkDynamicValue({
					type: "tokenlist",
					joiner: joinDatasets,
					merger: extendDataset,
					staticTokens: mkDatasetList(),
					dynamicTokens: [resolver]
				}, meta));
			} else {
				setAttribute(node, "data", {
					[key]: ref
				});
			}
		} else if (type == "events") {
			if (meta) {
				const obj = resolveInlineRefs(value, meta, ctx(node, "attribute", "events"));
				if (isObject(obj))
					setAttribute(node, "events", obj);
			} else
				setAttribute(node, key, value);
		} else if (type == "event-item" && matched) {
			const ref = resolveInlineRefs(value, meta, ctx(node, "attribute", "events")("event-item"));

			if (ref && ref.isDynamicValue) {
				const value = ref.data;
				let resolver;

				if (typeof value == "function") {
					resolver = (...args) => ({
						[key]: value(...args)
					});
				} else {
					resolver = _ => ({
						[key]: value
					});
				}

				setAttribute(node, "events", mkDynamicValue({
					type: "tokenlist",
					joiner: joinEvents,
					merger: extendEvents,
					staticTokens: mkEventList(),
					dynamicTokens: [resolver]
				}, meta));
			} else {
				setAttribute(node, "events", {
					[key]: ref
				});
			}
		} else if (meta.refs && hasOwn(meta.refs, type)) {
			setAttribute(
				node,
				"props",
				resolveInlineRefs(type, meta, ctx(node, "attribute", "props")("literal"))
			);
		} else {
			let c = context;
			if (typeof c == "string")
				c = ctx(node, "attribute", key)(c);
			else if (!c)
				c = ctx(node, "attribute", key)("literal");

			setAttribute(node, key, resolveInlineRefs(value, meta, c));
		}
	}

	return node;
}

function sanitizeAttributes(node) {
	if (node.dynamicAttributes.length)
		filterMut(node.staticAttributes, key => !hasOwn(node.dynamicAttributesMap, key));

	return node;
}

function resolveAttributeMeta(key, meta = null) {
	const prefixes = meta && meta.options && meta.options.attributePrefixes;
	let matcher = DEF_ATTR_PREFIX_MATCHER;

	if (prefixes) {
		if (typeof prefixes == "function")
			matcher = prefixes;
		else
			matcher = mkStrMatcher(prefixes);
	}

	let match = matcher(key),
		resolved = false;

	if (match && typeof match.value == "function") {
		match = match.value(key, match);
		resolved = true;
	}
	
	if (typeof match == "string") {
		return {
			type: match,
			key,
			matched: true
		};
	}

	if (Array.isArray(match)) {
		return {
			type: match[0],
			key: match[1],
			matched: true
		};
	}

	if (!isObject(match)) {
		return {
			type: key,
			key,
			matched: false
		};
	}

	return {
		type: resolved ?
			match.type || match.value :
			match.value,
		key: resolved ?
			match.key || key :
			key,
		matched: true
	};
}

function resolveInlineRefs(str, meta = null, context = null) {
	if (!meta || !meta.refKeys || !meta.refKeys.length || typeof str != "string")
		return str;

	if (typeof context == "function")
		context = context(null);
	if (!context)
		context = ctx(null, null, null)("raw");

	const ct = context.type,
		refRegex = meta.options.refRegex || REF_REGEX,
		terms = [],
		staticTerms = [],
		dynamicTerms = [];

	let out = "",
		ptr = 0,
		hasDynamicTerms = false;

	// Flags
	const preserveWhitespace = ct == "raw" || ct == "string" || ct == "entitystring",
		useTerms = ct != "raw" || (meta.options.compile && !meta.options.resolve),
		wrapDynamic = ct == "class" || ct == "style" || ct == "data" || ct == "event-item" || ct == "data-item",
		rawResolve = meta.options.rawResolve || ct == "event-item" || (ct == "literal" && !meta.options.eagerDynamic);

	const push = (term, ref) => {
		if (ref && meta.options.eagerDynamic) {
			const argRef = {
				ref,
				value: term,
				changed: false,
				context
			};

			meta.argRefs[meta.refIndices[ref]] = argRef;
			if (rawResolve)
				term = _ => argRef.value;
			else {
				term = (...args) => {
					if (typeof argRef.value == "function")
						return argRef.value(...args);

					return argRef.value;
				};
			}

			terms.push(term);
			dynamicTerms.push(term);
			hasDynamicTerms = true;
		} else if (meta.options.compile) {
			if (meta.options.resolve || !isDynamicValueCandidate(term, meta)) {
				pushTerm(terms, term);
				pushTerm(staticTerms, term);
				if (!rawResolve || typeof term != "function")
					out += serialize(term, meta.options);
			} else {
				if (rawResolve || (wrapDynamic && typeof term != "function")) {
					const rawTerm = term;
					term = _ => rawTerm;
				}

				terms.push(term);
				dynamicTerms.push(term);
				hasDynamicTerms = true;
			}
		} else if (typeof term == "string")
			out += term;
		else
			out += serialize(term, meta.options);
	};

	const pushTerm = (target, term) => {
		if (!useTerms || !term || (!preserveWhitespace && isEmptyString(term)))
			return;

		if (target.length && typeof term == "string" && typeof target[target.length - 1] == "string")
			target[target.length - 1] += term;
		else
			target.push(term);
	};

	while (true) {
		const ex = refRegex.exec(str);
		let chunk = "";

		if (ex && ex.index > ptr)
			chunk = str.substring(ptr, ex.index);
		else if (!ex && ptr < str.length)
			chunk = str.substring(ptr, str.length);

		push(chunk, null);

		if (!ex)
			break;

		const match = ex[0];

		if (!hasOwn(meta.refs, match))
			push(match, match);
		else
			push(meta.refs[match], match);

		ptr = ex.index + match.length;
	}

	switch (ct) {
		case "raw":
			if (!hasDynamicTerms)
				return useTerms ? terms[0] : out;

			return mkDynamicValue({
				type: "ordered",
				value: terms
			}, meta);

		case "string":
			if (!hasDynamicTerms)
				return useTerms ? terms[0] : out;

			return mkDynamicValue({
				type: "stringbuilder",
				value: terms
			}, meta);

		case "entitystring":
			if (!hasDynamicTerms)
				return parseEntityStr(out);

			return mkDynamicValue({
				type: "entitystringbuilder",
				value: terms
			}, meta);

		case "literal":
		case "data-item":
		case "event-item":
			if (!hasDynamicTerms)
				return useTerms ? terms[0] : out;

			return mkDynamicValue({
				type: "literal",
				data: terms[0]
			}, meta);

		case "class":
			if (!hasDynamicTerms)
				return joinClassAsTokenList(...terms);

			return mkDynamicValue({
				type: "tokenlist",
				joiner: joinClassAsTokenList,
				merger: extendClass,
				staticTokens: joinClassAsTokenList(...staticTerms),
				dynamicTokens: dynamicTerms
			}, meta);

		case "style":
			if (!hasDynamicTerms)
				return joinStyle(...terms);

			return mkDynamicValue({
				type: "tokenlist",
				joiner: joinStyle,
				merger: extendStyle,
				staticTokens: joinStyle(...staticTerms),
				dynamicTokens: dynamicTerms
			}, meta);

		case "data":
			if (!hasDynamicTerms)
				return joinDatasets(...terms);

			return mkDynamicValue({
				type: "tokenlist",
				joiner: joinDatasets,
				merger: extendDataset,
				staticTokens: joinDatasets(...staticTerms),
				dynamicTokens: dynamicTerms
			}, meta);

		case "events":
			if (!hasDynamicTerms)
				return joinEvents(...terms);

			return mkDynamicValue({
				type: "tokenlist",
				joiner: joinEvents,
				merger: extendEvents,
				staticTokens: joinEvents(...staticTerms),
				dynamicTokens: dynamicTerms
			}, meta);
	}

	return out;
}

function ctx(node, target, key = null) {
	return (type = null) => ({
		node,
		target,
		key,
		type: type || key
	});
}

resolveInlineRefs.ctx = ctx;

const PARSE_OPTIONS_TEMPLATES = {
	compile: true,				// Compile inline values (${xyz}) as part of the template 
	resolve: true,				// Resolve getters at parse time
	render: {					// Compile and resolve, producing a static asset
		compile: true,
		resolve: true
	},
	lazy: true,					// cache templates (returns compiled object)
	compact: true,				// Serialize resolved values in compact mode (serializer hint)
	lazyDynamic: true,			// treat all inline values except functions as constants
	eagerDynamic: true,			// treat every inline value as a getter (caches, returns compiled object)
	rawResolve: true,			// resolve every inline value in raw form
	terminalProps: true,		// Don't pass undeclared props from parent to child
	functionalTags: true,		// Treat tags as entry points for functional components
	singleContextArg: true,		// Use single context arguments in callbacks (serializer hint)
	preserveEntities: true,		// Preserve entity strings in their original form
	preserveNewlines: true		// Preserve newlines surrounding text blocks
};
let templateCache = null;

// Generic DOM parsing utility/router
function parseDom(parser, source, options) {
	const isTagged = isTaggedTemplateArgs(source);

	if (isObj(source[0]) && !isTagged)
		return source[0];

	options = assign(
		{},
		createOptionsObject(options, PARSE_OPTIONS_TEMPLATES)
	);

	if (options.attributePrefixes)
		options.attributePrefixes = mkStrMatcher(options.attributePrefixes);

	const compile = (wrap = false) => {
		const meta = compileTaggedTemplate.with(options)(...source);
		meta.argRefs = [];
		meta.props = [];
		meta.sigProps = [];
		meta.propsMap = {};

		if (Array.isArray(options.props)) {
			for (let i = 0, l = options.props.length; i < l; i++)
				addProp(meta, options.props[i], null);
		} else if (isObject(options.props)) {
			for (const k in options.props) {
				if (hasOwn(options.props, k))
					addProp(meta, k, options.props[k]);
			}
		}

		if (!wrap)
			return meta;
	
		return {
			meta,
			argRefs: meta.argRefs,
			dom: parser(meta.compiled, meta),
			isCompiledDomData: true
		};
	};

	const addProp = (meta, key, type) => {
		if (typeof key != "string")
			return;

		const propData = {
			key,
			type,
			required: false,
			default: undefined,
			hasDefault: false
		};

		if (type === null)
			propData.matches = _ => true;
		else if (isObject(type) && hasOwn(type, "type")) {
			propData.matches = value => matchType(value, type.type);
			let significant = false;

			propData.required = hasOwn(type, "required") ?
				Boolean(type.required) :
				propData.required;

			if (propData.required) {
				significant = true;
				propData.required = Boolean(type.required);
			}

			if (hasOwn(type, "default")) {
				significant = true;
				propData.default = type.default;
				propData.hasDefault = true;
			}

			propData.type = type.type;

			if (significant)
				meta.sigProps.push(propData);
		} else
			propData.matches = value => matchType(value, type);

		meta.props.push(propData);
		meta.propsMap[key] = propData;
		return propData;
	};

	if (options.compile) {
		assign(options, {
			ref: 15,
			refPrefix: "ref_",
			refSuffix: "",
			refRegex: /ref_[a-zA-Z0-9]{15}/g,
			resolveFunctions: true
		});

		if (options.lazy) {
			// This works because tagged template args are singletons
			// defined at parse time, effectively producing a unique ID
			// for every unique template
			if (!templateCache && typeof Map != "undefined")
				templateCache = new Map();

			if (isTagged && templateCache && templateCache.has(source[0])) {
				const d = templateCache.get(source[0]);

				for (let i = 0, l = d.argRefs.length; i < l; i++)
					d.argRefs[i].value = source[i + 1];

				return d;
			}

			const data = compile(true);

			if (templateCache && isTagged)
				templateCache.set(source[0], data);

			return data;
		}

		if (options.eagerDynamic)
			return compile(true);

		const meta = compile(false);
		return parser(meta.compiled, meta);
	}

	return parser(
		compileTaggedTemplate.with(options)(...source),
		{ options }
	);
}

parseDom.options = PARSE_OPTIONS_TEMPLATES;

const DIRECTIVE_HEAD_REGEX = /^(?:(?:((?:el|else\s+)?if|switch|case|each)\s+)([^\s:{]+)(?:\s+through\s+([^\s:{]+)?)?(?:\s+as\s+([^\s:{]+))?|else|default)$/,
	INLINE_DIRECTIVE_HEAD_REGEX = /(?:(?:((?:el|else\s+)?if|switch|case|each)\s+)([^\s:{]+)(?:\s+through\s+([^\s:{]+)?)?(?:\s+as\s+([^\s:{]+))?|else|default)/;

function parseDirectiveHead(str) {
	const parsed = {
		type: null
	};

	const ex = DIRECTIVE_HEAD_REGEX.exec(str.trim());
	if (!ex)
		return parsed;

	switch (ex[1]) {
		case "if":
		case "elif":
		case "else if":
		case "switch":
		case "case":
			if (ex[3] || ex[4])
				return parsed;

			parsed.type = ex[1] == "else if" ?
				"elif" :
				ex[1];

			parsed.expression = ex[2];
			break;

		case "each":
			parsed.type = ex[3] ?
				"range" :
				"iterator";
			parsed.label = ex[4] || null;

			if (ex[3])
				parsed.expressions = [ex[2], ex[3]];
			else
				parsed.expression = ex[2];
			break;

		default:
			parsed.type = ex[0];
	}

	return parsed;
}

const DIRECTIVE_MATCHER = mkStrMatcher(
	"if",
	"elif",
	"else",
	"switch",
	"case",
	"default",
	"each"
);

function matchDirective(str, offset = 0) {
	const match = DIRECTIVE_MATCHER(str, offset);
	if (!match)
		return null;

	const ex = stickyExec(INLINE_DIRECTIVE_HEAD_REGEX, str, offset);
	if (!ex)
		return null;

	return ex[0];
}

function applyDirective(head, maker, node, meta, err = m => m) {
	let directive = null;

	if (typeof head == "string")
		head = parseDirectiveHead(head);

	if (!head || !head.type)
		throw new SyntaxError(err("Malformed directive"));

	const assertValidIfBlock = head => {
		if (!node || node.type != "directive" || node.directiveType != "if")
			throw new SyntaxError(err(`Unmatched ${head.type} directive`));
		if (!node.contents.length || node.contents[node.contents.length - 1].condition == null)
			throw new SyntaxError(err(`Illegal ${head.type} directive on`));
	};

	switch (head.type) {
		case "if":
			directive = maker("directive", {
				meta,
				directiveType: head.type,
				static: false,
				contents: [],
				tag: "#directive"
			});
			directive.contents.push({
				condition: resolveInlineRefs(head.expression, meta, ctx(directive, "condition")("literal")),
				children: []
			});
			break;

		case "elif":
			assertValidIfBlock(head);
			node.contents.push({
				condition: resolveInlineRefs(head.expression, meta, ctx(directive, "condition")("literal")),
				children: []
			});
			break;

		case "else":
			assertValidIfBlock(head);
			node.contents.push({
				condition: null,
				children: []
			});
			break;

		case "switch":
			directive = maker("directive", {
				meta,
				directiveType: head.type,
				static: false,
				expression: null,
				cases: [],
				tag: "#directive"
			});
			directive.expression = resolveInlineRefs(head.expression, meta, ctx(directive, "expression")("literal"));
			break;

		case "case": {
			if (!node || node.type != "directive" || node.directiveType != "switch")
				throw new SyntaxError(err("Disassociated case directive"));

			const value = resolveInlineRefs(head.expression, meta, ctx(directive, "value")("literal")),
				tail = node.cases[node.cases.length - 1];

			if (!tail || tail.children.length) {
				node.cases.push({
					values: [value],
					children: [],
					hasDefault: false
				});
			} else
				tail.values.push(value);
			break;
		}

		case "default": {
			if (!node || node.type != "directive" || node.directiveType != "switch")
				throw new SyntaxError(err("Disassociated default directive"));

			const tail = node.cases[node.cases.length - 1];

			if (!tail || tail.children.length) {
				node.cases.push({
					values: [],
					children: [],
					hasDefault: true
				});
			} else
				tail.hasDefault = true;
			break;
		}

		case "range":
			directive = maker("directive", {
				meta,
				directiveType: head.type,
				static: false,
				range: [
					resolveInlineRefs(head.expressions[0], meta, ctx(directive, "from")("literal")),
					resolveInlineRefs(head.expressions[1], meta, ctx(directive, "to")("literal"))
				],
				children: [],
				label: head.label,
				tag: "#directive"
			});
			break;

		case "iterator":
			directive = maker("directive", {
				meta,
				directiveType: head.type,
				static: false,
				iterator: resolveInlineRefs(head.expression, meta, ctx(directive, "iterator")("literal")),
				children: [],
				label: head.label,
				tag: "#directive"
			});
			break;
	}

	return directive;
}

function getNodeTarget(parent) {
	switch (parent.type) {
		case "template":
			return parent.commonChildren;

		case "directive":
			return getDirectiveTarget(parent);

		default:
			return parent.children;
	}
}

function getDirectiveTarget(parent) {
	switch (parent.directiveType) {
		case "if":
			return parent.contents[parent.contents.length - 1].children;

		case "switch":
			if (!parent.cases.length)
				return null;

			return parent.cases[parent.cases.length - 1].children;

		case "range":
		case "iterator":
			return parent.children;
	}
}

// Legacy
function overrideAttributes(attrs, ...overriders) {
	for (let i = 0, l = overriders.length; i < l; i++) {
		const overriderAttrs = overriders[i];

		for (const k in overriderAttrs) {
			if (!hasOwn(overriderAttrs, k))
				continue;

			switch (k) {
				case "style":
					attrs.style = joinStyle(attrs.style, overriderAttrs.style);
					break;

				case "class":
					attrs.class = joinClass(attrs.class, overriderAttrs.class);
					break;

				case "data":
					attrs.data = joinDatasets(attrs.data, overriderAttrs.data);
					break;

				default:
					attrs[k] = overriderAttrs[k];
			}
		}
	}

	cleanAttributes(attrs);
	return attrs;
}

// This is applied on object representations
// and not on actual DOM nodes
function cleanAttributes(attrs) {
	attrs.class = parseClass(attrs.class, true);
}

export {
	// General
	hasAncestor,
	hasAncestorBySelector,
	mkAttrRepresentationObj,
	mkStyleList,
	mkDatasetList,
	mkTokenList,
	appendToken,
	removeToken,
	// Style
	parseStyle,
	parseStyleStr,
	joinStyle,
	joinStyleWithArgs,
	extendStyle,
	extendStyleWithArgs,
	// Classes
	parseClass,
	joinClass,
	joinClassAsArray,
	joinClassAsTokenList,
	joinClassWithArgs,
	joinClassAsArrayWithArgs,
	joinClassAsTokenListWithArgs,
	extendClass,
	extendClassWithArgs,
	// Datasets
	parseDataset,
	joinDatasets,
	extendDataset,
	// Events
	parseEvents,
	joinEvents,
	extendEvents,
	// Attribute processing
	joinAttributes,
	applyAttributes,
	applyNodeAttributes,
	coerceAttribute,
	copyAttribute,
	extendAttribute,
	forEachAttribute,
	// Printing / rendering
	printClass,
	printStyle,
	genDom,
	serializeDom,
	mkDomCapsuleConstructor,
	runDirective,
	mkRangeRunner,
	mkIteratorRunner,
	mkValueResolver,
	// Information
	getTagProperties,
	getNodeType,
	getTagName,
	getParentTemplate,
	getParentTemplateIndex,
	getEnclosingParentTemplate,
	getEnclosingParentTemplateIndex,
	// VDOM
	mkVNode,
	addAttributeData,
	mkDynamicValue,
	extendDynamicValue,
	mergeDynamicValue,
	resolveDynamicValue,
	resolveAttribute,
	resolveAttributes,
	resolveTextContent,
	resolveTag,
	resolveChildren,
	resolveChildrenTemplate,
	resolveAttributesAndProps,
	resolveProps,
	extractProp,
	setAttribute,
	setTextContent,
	parseAttributes,
	sanitizeAttributes,
	resolveInlineRefs,
	parseDom,
	parseDirectiveHead,
	matchDirective,
	applyDirective,
	getNodeTarget,
	getDirectiveTarget,
	// Legacy
	overrideAttributes,
	cleanAttributes
};