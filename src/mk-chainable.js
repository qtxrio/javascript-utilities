import {
	composeOptionsTemplates,
	createOptionsObject
} from "./internal/options";
import { isValidIdentifier } from "./is";
import { assign } from "./object";
import parseBranchedConfig from "./parse-branched-config";
import hasOwn from "./has-own";

// Utility for creating chainable functions
// Usage:
//
// NodeObject:
// init				function
// runtime			function
// access			function
// invoke			function
// branch			NodeObject | <string|NodeObject|function>[]
// branchPassive	NodeObject | <string|NodeObject|function>[]
// group			string
// name				string
// passive			boolean
// defer			boolean
// withContext		boolean
//
// init
// Creates a runtime object if and only if one is not already defined
//
// runtime
// Creates a new runtime object
// 
// access
// Performs an action when the corresponding step is accessed
// The return value is not returned from the chain unless the handler
// is located at a leaf step
//
// invoke
// Performs an action with the current runtime and passed arguments
// The return value is not returned from the chain unless the handler
// is located at a leaf step
//
// branch
// Defines chainable steps to be followed after the node is invoked
// If an object, all non-key property entries are added as chainable steps
//
// branchPassive
// Defines chainable steps available on the step without need for invocation
// If a step is defined as passive, branch and branchPassive are interchangeable
//
// group
// Marks a node object as a reusable group that can be referenced.
//
// name
// Marks a node object as a reusable step that can be referenced. As the current
// node object now has a name, it's defined as its own accessor namespace
//
// passive
// Marks a node as passive, meaning it cannot be invoked, only accessed
//
// defer
// Marks a node object as deferrable, meaning it resolves a step as either
// an access or an invocation. For example, in normal mode, a.b.c()
// would be run like this: access b, access c, invoke c
// In deferred mode, a.b.c() gets run as follows: access b, invoke c
// Local version of the global option and thus applies to one node and its
// direct descendants
//
// withContext
// Callbacks are called with a context object, namely the internal node corresponding to
// the current step. This node contains useful information such as the given name, which is
// useful when a node is referenced and reused
// Local version of the global option and thus applies to one node only
//
// -------
//
// Options:
// closed
// defer
// withContext
//
// closed
// The chainable object is a closed system, that is, at no point does the
// chain invoke iself. As such, runtime handling can be optimized
//
// defer
// Marks a node object as deferrable, meaning it resolves a step as either
// an access or an invocation. For example, in normal mode, a.b.c()
// would be run like this: access b, access c, invoke c
// In deferred mode, a.b.c() gets run as follows: access b, invoke c
// Global version of the node object option and thus applies to all nodes
//
// withContext
// Callbacks are called with a context object, namely the internal node corresponding to
// the current step. This node contains useful information such as the given name, which is
// useful when a node is referenced and reused. Global version of the node object option
// and thus applies to all nodes
//
// -------
//
// Node parsing:
// If an entry points at a string value, a lookup will be performed looking for
// a group with the given name, or a step defined at a location defined by an accessor
// If an array, the same will apply, but node objects defined within them must be named

const ACCESS_TOKEN = Object.freeze({ description: "tells pinger to access property" }),
	SKIP_SELF_ACCESS = Object.freeze({ description: "tells pinger to skip property access" }),
	ACCESS_TOKEN_ARGS = [ACCESS_TOKEN],
	CALLBACKS = ["init", "runtime", "invoke", "access"];

const OPTIONS_TEMPLATES = composeOptionsTemplates({
	closed: true,
	defer: true,
	withContext: true
});

export default function mkChainable(name, struct, options) {
	if (name != "string") {
		options = struct;
		struct = name;
		name = null;
	}

	options = createOptionsObject(options, OPTIONS_TEMPLATES);
	struct = parseBranchedConfig(
		struct,
		{
			schema: {
				runtime: { type: "function", default: null },
				init: { type: "function", default: null },
				invoke: { type: "function", default: null },
				access: { type: "function", default: null },
				passive: { type: "boolean", default: false },
				defer: { type: "boolean", default: options.defer || false },
				withContext: { type: "boolean", default: options.withContext || false }
			},
			scopes: {
				branch: ["b"],
				branchPassive: ["bp", "p", "passive"],
				group: ["g"]
			},
			groupKey: "group",
			defaultScope: "branch",
			extensionKey: "extends",
			aliasKeys: ["alias", "aliases"],
			init: {
				step: decorateNode,
				leaf: (n, node, scope) => {
					if (typeof node != "function") {
						decorateNode(n);
						return;
					}

					n.invoke = scope.name == "branch" ? node : null;
					n.access = scope.name == "branch" ? null : node;

					decorateNode(n);
				}
			}
		},
		msg => `Cannot create chainable: ${msg}`
	);

	const getterQueue = [];
	let pingInit,
		pingStep,
		pingTerminate;

	if (options.closed) {
		const frame = {
			initialized: true,
			deferNode: null,
			runtime: {}
		};

		pingInit = (node, out) => (...args) => {
			frame.initialized = false;
			frame.deferNode = null;
			frame.runtime = {};

			if (args[0] != ACCESS_TOKEN || args[1] != SKIP_SELF_ACCESS)
				runPing(node, frame, true, ACCESS_TOKEN_ARGS);
			runPing(node, frame, true, args);
			return out;
		};

		pingStep = (node, out) => (...args) => {
			runPing(node, frame, false, args);
			return out;
		};

		pingTerminate = node => (...args) => {
			return runPing(node, frame, false, args);
		};
	} else {
		const stack = [];

		pingInit = (node, out) => (...args) => {
			const frame = {
				initialized: false,
				deferNode: null,
				runtime: {}
			};
			stack.push(frame);

			if (args[0] != ACCESS_TOKEN || args[1] != SKIP_SELF_ACCESS)
				runPing(node, frame, true, ACCESS_TOKEN_ARGS);
			runPing(node, frame, true, args);
			return out;
		};

		pingStep = (node, out) => (...args) => {
			const frame = stack[stack.length - 1];
			runPing(node, frame, false, args);
			return out;
		};

		pingTerminate = node => (...args) => {
			const frame = stack.pop();
			return runPing(node, frame, false, args);
		};
	}

	const runPing = (node, frame, init, args) => {
		const hasInitDefer = frame.deferNode && init;

		if (frame.deferNode) {
			if (node.uid != frame.deferNode.uid || args[0] == ACCESS_TOKEN) {
				const n = node.baseUid && node.baseUid == frame.deferNode.baseUid ?
					node :
					frame.deferNode;

				applyPingPre(n, frame, []);

				if (n.access)
					n.access(frame.runtime);
			}

			frame.deferNode = null;
		}

		if (node.defer && args[0] == ACCESS_TOKEN) {
			frame.deferNode = init && !hasInitDefer ?
				node :
				args[1] || node;
			return;
		}

		const n = args[1] == SKIP_SELF_ACCESS ?
			node :
			args[1] || node;

		applyPingPre(n, frame, args);

		if (args[0] == ACCESS_TOKEN) {
			if (n.access)
				return n.access(frame.runtime);
			return;
		}
		
		if (n.invoke)
			return n.invoke(frame.runtime, ...args);
	};

	const applyPingPre = (node, frame, args) => {
		if (node.runtime)
			frame.runtime = node.runtime(frame.runtime, ...args) || frame.runtime;

		if (node.init && !frame.initialized) {
			frame.initialized = true;
			frame.runtime = node.init(frame.runtime, ...args) || frame.runtime;
		}
	};

	const getPinger = node => {
		if (node.type == "leaf")
			return pingTerminate;

		return node.uid == struct.uid ?
			pingInit :
			pingStep;
	};

	const getPingerType = node => {
		if (node.type == "leaf")
			return "terminate";

		return node.uid == struct.uid ?
			"init" :
			"step";
	};

	const getName = node => {
		if (node.type == "wrapper")
			return node.referenceNode.name;

		return node.name;
	};

	const construct = node => {
		const sourceNode = node;
		let uNode,
			useCached = false;

		if (node.type == "wrapper") {
			uNode = assign({}, node.node);
			uNode.name = node.referenceNode.name;
			uNode.baseUid = uNode.uid;
			uNode.uid = node.referenceNode.uid;
			uNode.root = false;
			node = node.node;
		} else
			uNode = assign({}, node);

		if (options.withContext) {
			for (let i = 0, l = CALLBACKS.length; i < l; i++) {
				const callback = uNode[CALLBACKS[i]];

				uNode[CALLBACKS[i]] = callback ?
					callback.bind(uNode, uNode) :
					callback;
			}
		}

		let junction = {},
			getterPartition = {
				data: [],
				targets: []
			};

		if (hasOwn(node, "cache")) {
			useCached = true;
			junction = node.cache.junction;
			getterPartition = node.cache.getterPartition;
		} else
			getterQueue.push(getterPartition);
		
		const resolve = n => {
			let nodeName = name || n.name || "chain";
			if (!isValidIdentifier(nodeName))
				nodeName = `_${nodeName}`;

			return Function(
				"node",
				"ping",
				"out",
				`return function ${nodeName}() { return ping(node, out).apply(null, arguments); }`
			)(n, getPinger(n), junction);
		};

		node.resolve = resolve;
		node.cache = {
			junction,
			getterPartition
		};

		const resolved = resolve(uNode),
			coreData = node.passive ?
				junction :
				resolved;

		if (useCached) {
			getterPartition.targets.push({
				resolved,
				type: getPingerType(uNode),
				node: uNode
			});

			return {
				resolved,
				coreData,
				node: uNode,
				sourceNode
			};
		}

		if (node.type == "leaf") {
			return {
				resolved,
				coreData,
				node: uNode,
				sourceNode
			};
		}

		let branches,
			passiveBranches;
		const branchGetters = {};

		if (node.type == "reference") {
			if (node.refValue.target == "group")
				branches = node.refValue.value;
			else
				branches = [node.refValue.value];
	
			passiveBranches = [];
		} else if (node.passive) {
			branches = node.branch.concat(node.branchPassive);
			passiveBranches = [];
		} else {
			branches = node.branch;
			passiveBranches = node.branchPassive;
		}

		for (let i = 0, l = branches.length; i < l; i++) {
			const constructed = construct(branches[i]),
				descriptor = {
					enumerable: true,
					configurable: false,
				};

			if (hasOwn(branchGetters, constructed.node.name))
				throw new Error(`Cannot create chainable: duplicate branch '${constructed.node.name}' in passive node`);

			if (constructed.node.passive)
				descriptor.get = _ => constructed.resolved(ACCESS_TOKEN);
			else {
				descriptor.get = _ => {
					pingStep(constructed.node, constructed.resolved)(ACCESS_TOKEN);
					return constructed.resolved;
				};
				getterPartition.data.push(constructed);
			}

			branchGetters[constructed.node.name] = descriptor;
		}

		Object.defineProperties(junction, branchGetters);

		if (!node.passive) {
			for (let i = 0, l = passiveBranches.length; i < l; i++) {
				const constructed = construct(passiveBranches[i]);
				getterPartition.data.push(constructed);
			}

			if (passiveBranches.length) {
				getterPartition.targets.push({
					resolved,
					type: getPingerType(uNode),
					node: uNode
				});
			}
		}

		return {
			resolved,
			coreData,
			node: uNode,
			sourceNode
		};
	};

	const cnstr = construct(struct);

	for (let a = 0, l = getterQueue.length; a < l; a++) {
		const partition = getterQueue[a];

		if (!partition.data.length)
			continue;

		for (let b = 0, l2 = partition.targets.length; b < l2; b++) {
			const { resolved, type, node } = partition.targets[b],
				getters = {};

			for (let c = 0, l3 = partition.data.length; c < l3; c++) {
				const constructed = partition.data[c];
				let res = resolved;

				if (constructed.node.baseUid && constructed.node.baseUid == node.uid) {
					if (type == "init") {
						res = (token, skip) => {
							resolved(token, SKIP_SELF_ACCESS);
							constructed.resolved(token, skip);
						};
					} else
						res = constructed.resolved;
				}

				const name = constructed.node.name,
					descriptor = {
						enumerable: true,
						configurable: false,
						get: constructed.resolved
					};
	
				if (typeof resolved == "function") {
					if (!constructed.node.passive || typeof constructed.resolved != "function") {
						descriptor.get = _ => {
							res(ACCESS_TOKEN, constructed.node);
							return constructed.resolved;
						};
					} else if (type == "init") {
						descriptor.get = _ => {
							res(ACCESS_TOKEN, SKIP_SELF_ACCESS);
							return constructed.resolved(ACCESS_TOKEN);
						};
					} else
						descriptor.get = _ => constructed.resolved(ACCESS_TOKEN);
				}
	
				getters[name] = descriptor;
			}

			Object.defineProperties(resolved, getters);
		}
	}

	if (struct.passive) {
		const branches = struct.branch.concat(struct.branchPassive),
			getters = {};

		for (let i = 0, l = branches.length; i < l; i++) {
			const name = getName(branches[i]);
			getters[name] = {
				enumerable: true,
				configurable: false,
				get: _ => cnstr.resolved(ACCESS_TOKEN, SKIP_SELF_ACCESS)[name]
			};
		}

		return Object.defineProperties({}, getters);
	}

	return cnstr.resolved;
}

function decorateNode(node) {
	ensurePassive(node);
	ensureDeferrable(node);
}

function ensurePassive(node) {
	if (!node.invoke)
		node.passive = true;
	if (node.passive && node.invoke)
		node.passive = false;
}

function ensureDeferrable(node) {
	if (!node.defer)
		return;

	if (node.passive)
		node.defer = false;
}