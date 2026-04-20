import { command } from "../builder.js";

export const exportCmd = command("export")
	.description("Set export attribute for shell variables")
	.flag("-p, --print", "Print all exported variables")
	.flag("-n, --remove", "Remove the export property from variables")
	.allowUnknownFlags()
	.argument("[names...]", "Variable names or NAME=VALUE pairs")
	.action((ctx, { args, flags }) => {
		if (args.length === 0 || flags.print) {
			for (const [key, value] of ctx.env.all()) {
				if (ctx.env.isExported(key)) {
					ctx.stdout.writeln(`declare -x ${key}="${escapeValue(value)}"`);
				}
			}
			return 0;
		}

		for (const arg of args) {
			const eqIdx = arg.indexOf("=");

			if (flags.remove) {
				const name = eqIdx >= 0 ? arg.slice(0, eqIdx) : arg;
				ctx.env.unexport(name);
			} else if (eqIdx >= 0) {
				const name = arg.slice(0, eqIdx);
				const value = arg.slice(eqIdx + 1);
				ctx.env.set(name, value);
				ctx.env.export(name);
			} else {
				ctx.env.export(arg);
			}
		}

		return 0;
	})
	.toHandler();

export const unset = command("unset")
	.description("Unset shell variables or functions")
	.flag("-f, --functions", "Unset functions only")
	.flag("-v, --vars", "Unset variables only")
	.argument("[names...]", "Names to unset")
	.action((ctx, { args, flags }) => {
		const unsetFunctions = flags.functions as boolean;
		const unsetVars = !unsetFunctions || (flags.vars as boolean);

		for (const name of args) {
			if (unsetFunctions) {
				ctx.env.removeFunction(name);
			}
			if (unsetVars) {
				ctx.env.unset(name);
			}
		}

		return 0;
	})
	.toHandler();

export const readonly = command("readonly")
	.description("Mark shell variables as read-only")
	.flag("-p, --print", "Print all readonly variables")
	.argument("[names...]", "Variable names or NAME=VALUE pairs")
	.action((ctx, { args, flags }) => {
		if (args.length === 0 || flags.print) {
			for (const [key, value] of ctx.env.all()) {
				if (ctx.env.isReadonly(key)) {
					ctx.stdout.writeln(`declare -r ${key}="${escapeValue(value)}"`);
				}
			}
			return 0;
		}

		for (const arg of args) {
			const eqIdx = arg.indexOf("=");
			if (eqIdx >= 0) {
				const name = arg.slice(0, eqIdx);
				const value = arg.slice(eqIdx + 1);
				ctx.env.set(name, value);
				ctx.env.markReadonly(name);
			} else {
				ctx.env.markReadonly(arg);
			}
		}

		return 0;
	})
	.toHandler();

export const declareCmd = command("declare")
	.description("Declare variables and set attributes")
	.flag("-x, --export", "Mark for export")
	.flag("-r, --readonly", "Mark as readonly")
	.flag("-l, --local", "Local scope")
	.flag("-g, --global", "Global scope")
	.flag("-i, --integer", "Integer attribute")
	.flag("-p, --print", "Print variable declarations")
	.flag("-a, --array", "Indexed array")
	.flag("-A, --assoc", "Associative array")
	.allowUnknownFlags()
	.argument("[names...]", "Variable names or NAME=VALUE pairs")
	.action((ctx, { args, flags }) => {
		if (args.length === 0) {
			for (const [key, value] of ctx.env.all()) {
				ctx.stdout.writeln(`${key}=${escapeValue(value)}`);
			}
			return 0;
		}

		if (flags.print) {
			for (const name of args) {
				const value = ctx.env.get(name);
				if (value !== undefined) {
					let prefix = "declare";
					if (ctx.env.isExported(name)) prefix += " -x";
					if (ctx.env.isReadonly(name)) prefix += " -r";
					if (flags.integer) prefix += " -i";
					ctx.stdout.writeln(`${prefix} ${name}="${escapeValue(value)}"`);
				}
			}
			return 0;
		}

		for (const arg of args) {
			const eqIdx = arg.indexOf("=");
			let name: string;
			let value: string;

			if (eqIdx >= 0) {
				name = arg.slice(0, eqIdx);
				value = arg.slice(eqIdx + 1);
			} else {
				name = arg;
				value = "";
			}

			if (flags.integer) {
				const num = Number.parseInt(value, 10);
				value = Number.isNaN(num) ? "0" : num.toString();
			}

			ctx.env.set(name, value);
			if (flags.export) ctx.env.export(name);
			if (flags.readonly) ctx.env.markReadonly(name);
		}

		return 0;
	})
	.toHandler();

export const local = command("local")
	.description("Define local variables")
	.allowUnknownFlags()
	.argument("[names...]", "Variable names or NAME=VALUE pairs")
	.action((ctx, { args }) => {
		for (const arg of args) {
			const eqIdx = arg.indexOf("=");
			if (eqIdx >= 0) {
				const name = arg.slice(0, eqIdx);
				const value = arg.slice(eqIdx + 1);
				ctx.env.set(name, value);
			} else {
				ctx.env.set(arg, "");
			}
		}
		return 0;
	})
	.toHandler();

function escapeValue(v: string): string {
	return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
}
